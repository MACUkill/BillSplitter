// AUDYT MATMY — niezmienniki na losowych danych + przypadki brzegowe ledgera.
//
// Istniejące testy sprawdzają konkretne scenariusze i zaokrąglanie. Ten zestaw atakuje
// obietnicę, na której stoi cała aplikacja: „płatnik nigdy nie jest stratny, a kwoty
// schodzą się co do grosza" — na tysiącach losowych rachunków, w tym z pozycjami
// paragonu, kosztami procentowymi, częściowymi wpłatami i mieszanymi walutami.
//
// Losowanie jest DETERMINISTYCZNE (własny generator z ziarnem): test, który raz złapie
// błąd, złapie go ponownie. Losowość bez powtarzalności byłaby bezużyteczna w audycie.
import { describe, it, expect } from 'vitest';
import {
  calculateAll,
  calculateSimple,
  calculateAllForBill,
  computeBillDebts,
  buildLedger,
  simplifyDebts,
  toGrosze,
} from './calc.js';
import { splitItemByUnits, itemQuantity } from './items.js';

// --- deterministyczny generator (xorshift32) ---
const makeRng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

const randomBill = (rng, { forceItemsAssigned = true } = {}) => {
  const n = 2 + Math.floor(rng() * 5); // 2..6 uczestników
  const ids = Array.from({ length: n }, (_, i) => `m${i}`);
  const participants = {};
  ids.forEach((id) => {
    const inactive = rng() < 0.15;
    participants[id] = {
      id,
      name: `Osoba ${id}`,
      status: inactive ? 'not_applicable' : (rng() < 0.5 ? 'incomplete' : 'completed'),
      individualAmount: inactive ? 0 : Math.round(rng() * 8000) / 100, // 0..80 zł
    };
  });
  const active = ids.filter((id) => participants[id].status !== 'not_applicable');
  if (active.length === 0) participants[ids[0]].status = 'incomplete';
  const activeIds = ids.filter((id) => participants[id].status !== 'not_applicable');

  // Pozycje paragonu (kafelki).
  const sharedCosts = [];
  const itemCount = Math.floor(rng() * 5);
  for (let i = 0; i < itemCount; i++) {
    const pickers = activeIds.filter(() => rng() < 0.6);
    sharedCosts.push({
      id: `it${i}`,
      description: `Pozycja ${i}`,
      amount: Math.round((1 + rng() * 9000)) / 100, // 0,01..90 zł
      quantity: 1 + Math.floor(rng() * 3),
      // Pozycja bez wybierających wypada z podziału — to osobny, świadomy przypadek,
      // więc w podstawowym scenariuszu gwarantujemy komuś przypisanie.
      sharedBy: pickers.length || !forceItemsAssigned ? pickers : [activeIds[0]],
    });
  }

  // Koszty ogólne: kwotowe i procentowe (procenty dają ułamki grosza — najgorszy przypadek).
  const globalCosts = [];
  const gcCount = Math.floor(rng() * 3);
  for (let i = 0; i < gcCount; i++) {
    globalCosts.push(rng() < 0.5
      ? { id: `gc${i}`, description: 'Napiwek', type: 'amount', value: Math.round(rng() * 3000) / 100 }
      : { id: `gc${i}`, description: 'Serwis', type: 'percent', value: Math.round(rng() * 20) });
  }

  const bill = {
    id: `b${Math.floor(rng() * 1e6)}`,
    billName: 'Rachunek',
    type: 'advanced',
    currency: ['PLN', 'EUR', 'USD'][Math.floor(rng() * 3)],
    participants,
    sharedCosts,
    globalCosts,
    payerId: activeIds[Math.floor(rng() * activeIds.length)],
    payerConfirmed: true,
    totalAmount: 0,
  };
  // Kwota rachunku = dokładnie to, co wyszło z pozycji (przypadek „suma się zgadza").
  bill.totalAmount = calculateAll(bill).control.enteredSubtotal;
  return bill;
};

describe('niezmiennik: płatnik nigdy nie jest stratny (rachunek zaawansowany, 2000 losowań)', () => {
  it('to, co płatnik zbierze od reszty, pokrywa wszystko poza jego własnym udziałem', () => {
    const rng = makeRng(20260727);
    const failures = [];

    for (let iter = 0; iter < 2000; iter++) {
      const bill = randomBill(rng);
      const { participantTotals, control } = calculateAll(bill);
      if (control.status !== 'ok' || toGrosze(bill.totalAmount) <= 0) continue;

      const payerRow = participantTotals.find((pt) => pt.participant.id === bill.payerId);
      const collectedG = participantTotals
        .filter((pt) => pt.participant.id !== bill.payerId)
        .reduce((s, pt) => s + toGrosze(pt.total), 0);

      // Ile płatnik realnie zostaje z własnej kieszeni po zebraniu od reszty.
      const payerCostG = toGrosze(bill.totalAmount) - collectedG;
      const payerExactG = toGrosze(payerRow.exactTotal);

      // Płatnik może dopłacić NAJWYŻEJ swój dokładny udział — nigdy więcej.
      if (payerCostG > payerExactG + 1) {
        failures.push({ iter, payerCostG, payerExactG, bill });
      }
    }

    expect(failures.length, `Płatnik stratny w ${failures.length} przypadkach; pierwszy: ${JSON.stringify(failures[0]?.bill)}`).toBe(0);
  });
});

describe('niezmiennik: płatnik nigdy nie jest stratny (rachunek prosty, 2000 losowań)', () => {
  it('kwota na osobę zaokrąglona w górę zawsze pokrywa udział', () => {
    const rng = makeRng(777);
    for (let iter = 0; iter < 2000; iter++) {
      const n = 2 + Math.floor(rng() * 8);
      const participants = {};
      for (let i = 0; i < n; i++) {
        participants[`m${i}`] = { id: `m${i}`, name: `O${i}`, status: rng() < 0.2 ? 'not_applicable' : 'unpaid' };
      }
      const activeIds = Object.keys(participants).filter((id) => participants[id].status !== 'not_applicable');
      if (activeIds.length < 2) continue;
      const bill = {
        type: 'simple',
        currency: 'PLN',
        totalAmount: Math.round(rng() * 100000) / 100,
        participants,
        payerId: activeIds[0],
        payerConfirmed: true,
      };
      const { amountPerPerson } = calculateSimple(bill);
      const collectedG = toGrosze(amountPerPerson) * (activeIds.length - 1);
      const payerCostG = toGrosze(bill.totalAmount) - collectedG;
      const exactShareG = toGrosze(bill.totalAmount) / activeIds.length;
      expect(payerCostG).toBeLessThanOrEqual(Math.ceil(exactShareG) + 1);
    }
  });
});

describe('niezmiennik: rozbicie pozycji na sztuki nie zmienia ani grosza', () => {
  it('suma sztuk = kwota pozycji, a udziały uczestników pozostają te same', () => {
    const rng = makeRng(4242);
    for (let iter = 0; iter < 500; iter++) {
      const qty = 2 + Math.floor(rng() * 6);
      const item = {
        id: 'x',
        description: 'Wino',
        amount: Math.round((1 + rng() * 20000)) / 100,
        quantity: qty,
        sharedBy: ['m0', 'm1'],
      };
      const parts = splitItemByUnits(item, (() => { let k = 0; return () => `x-${k++}`; })());
      expect(parts).toHaveLength(qty);
      const sumG = parts.reduce((s, p) => s + toGrosze(p.amount), 0);
      expect(sumG).toBe(toGrosze(item.amount));
      parts.forEach((p) => expect(itemQuantity(p)).toBe(1));

      // Udziały liczone przed i po rozbiciu muszą się zgadzać (rozbicie to operacja
      // porządkowa, nie finansowa — inaczej „podziel na sztuki" po cichu zmieniałby rachunek).
      const base = {
        type: 'advanced', currency: 'PLN', globalCosts: [], payerId: 'm0', payerConfirmed: true,
        participants: {
          m0: { id: 'm0', name: 'A', status: 'completed', individualAmount: 0 },
          m1: { id: 'm1', name: 'B', status: 'completed', individualAmount: 0 },
        },
      };
      const before = calculateAll({ ...base, sharedCosts: [item], totalAmount: item.amount });
      const after = calculateAll({ ...base, sharedCosts: parts, totalAmount: item.amount });
      before.participantTotals.forEach((pt, i) => {
        expect(toGrosze(after.participantTotals[i].total)).toBe(toGrosze(pt.total));
      });
    }
  });
});

describe('ledger: bilans się domyka', () => {
  it('w każdej walucie suma należności równa się sumie zobowiązań (500 losowych grup)', () => {
    const rng = makeRng(31337);
    for (let iter = 0; iter < 500; iter++) {
      const bills = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => randomBill(rng));
      // Wpłaty częściowe pomiędzy losowymi osobami z rachunków.
      const settlements = [];
      const someIds = [...new Set(bills.flatMap((b) => Object.keys(b.participants)))];
      const settleCount = Math.floor(rng() * 4);
      for (let i = 0; i < settleCount; i++) {
        const from = someIds[Math.floor(rng() * someIds.length)];
        const to = someIds[Math.floor(rng() * someIds.length)];
        if (from === to) continue;
        settlements.push({
          id: `s${i}`, from, to,
          amount: Math.round(rng() * 5000) / 100,
          currency: bills[Math.floor(rng() * bills.length)].currency,
        });
      }

      const ledger = buildLedger(bills, settlements);
      for (const [cur, { net }] of Object.entries(ledger)) {
        const balance = new Map();
        net.forEach((t) => {
          balance.set(t.from, (balance.get(t.from) || 0) - t.amountG);
          balance.set(t.to, (balance.get(t.to) || 0) + t.amountG);
        });
        const sum = [...balance.values()].reduce((a, b) => a + b, 0);
        expect(sum, `Bilans nie domyka się w walucie ${cur}`).toBe(0);

        // „Najmniej przelewów" musi dawać DOKŁADNIE te same salda, tylko innymi krawędziami.
        const simplified = simplifyDebts(ledger[cur].directed);
        const simpBalance = new Map();
        simplified.forEach((t) => {
          simpBalance.set(t.from, (simpBalance.get(t.from) || 0) - t.amountG);
          simpBalance.set(t.to, (simpBalance.get(t.to) || 0) + t.amountG);
        });
        for (const [id, v] of balance) {
          if (v !== 0) expect(simpBalance.get(id) || 0, `Saldo ${id} rozjeżdża się między trybami`).toBe(v);
        }
        // I nigdy więcej przelewów niż uczestników − 1.
        const people = new Set([...simplified.flatMap((t) => [t.from, t.to])]);
        if (people.size > 0) expect(simplified.length).toBeLessThanOrEqual(Math.max(0, people.size - 1));
      }
    }
  });
});

describe('ledger: waluty nie mieszają się', () => {
  it('dług w EUR nie kompensuje się wpłatą w PLN', () => {
    const bill = {
      id: 'b1', billName: 'Kolacja', type: 'simple', currency: 'EUR', totalAmount: 100,
      payerId: 'ala', payerConfirmed: true,
      participants: {
        ala: { id: 'ala', name: 'Ala', status: 'unpaid' },
        bob: { id: 'bob', name: 'Bob', status: 'unpaid' },
      },
    };
    const ledger = buildLedger([bill], [{ id: 's1', from: 'bob', to: 'ala', amount: 50, currency: 'PLN' }]);
    // Bob wciąż winien 50 EUR…
    expect(ledger.EUR.net).toEqual([{ from: 'bob', to: 'ala', amountG: 5000 }]);
    // …a wpłata w PLN tworzy osobne, własne saldo (Ala ma u Boba 50 PLN „na plus").
    expect(ledger.PLN.net).toEqual([{ from: 'ala', to: 'bob', amountG: 5000 }]);
  });
});

describe('ledger: przypadki brzegowe modelu wpłat', () => {
  const twoPersonBill = (total = 100) => ({
    id: 'b1', billName: 'Obiad', type: 'simple', currency: 'PLN', totalAmount: total,
    payerId: 'ala', payerConfirmed: true,
    participants: {
      ala: { id: 'ala', name: 'Ala', status: 'unpaid' },
      bob: { id: 'bob', name: 'Bob', status: 'unpaid' },
    },
  });

  it('częściowa wpłata zmniejsza dług dokładnie o wpłaconą kwotę', () => {
    const ledger = buildLedger([twoPersonBill()], [{ id: 's1', from: 'bob', to: 'ala', amount: 20, currency: 'PLN' }]);
    expect(ledger.PLN.net).toEqual([{ from: 'bob', to: 'ala', amountG: 3000 }]);
  });

  it('nadpłata odwraca kierunek długu (Ala oddaje nadwyżkę)', () => {
    const ledger = buildLedger([twoPersonBill()], [{ id: 's1', from: 'bob', to: 'ala', amount: 70, currency: 'PLN' }]);
    expect(ledger.PLN.net).toEqual([{ from: 'ala', to: 'bob', amountG: 2000 }]);
  });

  it('rachunek bez potwierdzonego płatnika nie tworzy długu (a wpłata do niego — owszem)', () => {
    const unconfirmed = { ...twoPersonBill(), payerConfirmed: false };
    expect(computeBillDebts(unconfirmed)).toEqual([]);
    // ⚠️ Wniosek z audytu: wpłata żyje niezależnie od rachunków. Jeśli rachunek zostanie
    // usunięty (albo płatnik cofnie potwierdzenie), zapisana wcześniej wpłata zostaje
    // i pokazuje się jako dług W DRUGĄ STRONĘ. To nie błąd matmy — to skutek modelu
    // (wpłata = zdarzenie), ale użytkownik musi rozumieć, że kasując rachunek nie kasuje wpłat.
    const ledger = buildLedger([unconfirmed], [{ id: 's1', from: 'bob', to: 'ala', amount: 50, currency: 'PLN' }]);
    expect(ledger.PLN.net).toEqual([{ from: 'ala', to: 'bob', amountG: 5000 }]);
  });

  it('wpłata do samego siebie jest ignorowana', () => {
    const ledger = buildLedger([twoPersonBill()], [{ id: 's1', from: 'bob', to: 'bob', amount: 50, currency: 'PLN' }]);
    expect(ledger.PLN.net).toEqual([{ from: 'bob', to: 'ala', amountG: 5000 }]);
  });

  it('uczestnik „mnie nie dotyczy" nie ma udziału ani długu', () => {
    const bill = twoPersonBill();
    bill.participants.bob.status = 'not_applicable';
    expect(computeBillDebts(bill)).toEqual([]);
  });
});

describe('pozycja, której nikt nie wybrał — udokumentowany skutek finansowy', () => {
  it('koszt takiej pozycji spada na płatnika (dlatego kafelek świeci na czerwono)', () => {
    const bill = {
      id: 'b1', billName: 'Restauracja', type: 'advanced', currency: 'PLN', totalAmount: 100,
      payerId: 'ala', payerConfirmed: true, globalCosts: [],
      participants: {
        ala: { id: 'ala', name: 'Ala', status: 'completed', individualAmount: 0 },
        bob: { id: 'bob', name: 'Bob', status: 'completed', individualAmount: 0 },
      },
      sharedCosts: [
        { id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] },
        { id: 'i2', description: 'Wino', amount: 40, sharedBy: [] }, // nikt nie wziął
      ],
    };
    const { participantTotals } = calculateAll(bill);
    const bob = participantTotals.find((pt) => pt.participant.id === 'bob');
    expect(toGrosze(bob.total)).toBe(3000); // tylko połowa pizzy

    // Ala wyłożyła 100, zbiera 30 → z własnej kieszeni 70, choć jej udział to 30.
    // To JEDYNY przypadek, w którym płatnik dopłaca ponad swój udział — i wynika
    // wprost z tego, że za wino nikt się nie zapisał.
    const collectedG = toGrosze(bob.total);
    expect(toGrosze(bill.totalAmount) - collectedG).toBe(7000);
  });
});
