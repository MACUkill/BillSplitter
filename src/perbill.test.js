import { describe, it, expect } from 'vitest';
import {
  billLedger,
  myBillsToPay,
  billSettledBy,
  myUnassigned,
  reconcileToPay,
  currenciesToPay,
  netFromBills,
  ledgerVisibleBills,
} from './perbill.js';
import { buildLedger } from './calc.js';
import { myNetByCurrency } from './plan.js';

// Rachunek dzielony po równo: sam totalAmount, zero pozycji. To najczęstszy kształt
// w realnym pokoju i najkrótszy do zapisania w teście.
const bill = (id, totalAmount, payerId, people, { currency = 'PLN', at = 0, name = id } = {}) => ({
  id,
  billName: name,
  totalAmount,
  currency,
  payerId,
  payerConfirmed: true,
  createdAtMs: at,
  participants: Object.fromEntries(people.map((pid) => [pid, { id: pid, status: 'unpaid' }])),
});

const pay = (id, from, to, amount, { currency = 'PLN', at = 0, billId = null, billIds = null } = {}) => ({
  id, from, to, amount, currency, createdAtMs: at,
  ...(billId ? { billId } : {}),
  ...(billIds ? { billIds } : {}),
});

const key = (r) => `${r.billId}:${r.debtor}->${r.payer}=${r.openG}`;

describe('billLedger — długi rozpisane na rachunki', () => {
  it('bez wpłat: udział z rachunku jest w całości otwarty', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], []);
    expect(res.rows.map(key).sort()).toEqual(['r1:b->a=3000', 'r1:c->a=3000']);
    expect(res.unassigned).toEqual([]);
  });

  it('rachunek bez potwierdzonego płatnika nie tworzy ani jednego wiersza', () => {
    const b = { ...bill('r1', 90, 'a', ['a', 'b']), payerConfirmed: false };
    expect(billLedger([b], []).rows).toEqual([]);
  });

  it('wpłata gasi dług w całości', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 30)]);
    const b = res.rows.find((r) => r.debtor === 'b');
    expect([b.paidG, b.openG]).toEqual([3000, 0]);
    expect(res.unassigned).toEqual([]);
  });

  it('wpłata częściowa zostawia resztę na tym samym rachunku', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 10)]);
    const b = res.rows.find((r) => r.debtor === 'b');
    expect([b.paidG, b.openG]).toEqual([1000, 2000]);
    expect(res.unassigned).toEqual([]);
  });
});

describe('kolejność gaszenia: OD NAJSTARSZEGO rachunku', () => {
  const bills = [
    bill('nowy', 20, 'a', ['a', 'b'], { at: 2000 }),
    bill('stary', 40, 'a', ['a', 'b'], { at: 1000 }),
  ];

  it('wpłata idzie najpierw na najstarszy dług, niezależnie od kolejności na liście', () => {
    // b winien: stary 20,00 · nowy 10,00. Wpłata 20,00 gasi stary w całości.
    const res = billLedger(bills, [pay('w1', 'b', 'a', 20)]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.stary.openG).toBe(0);
    expect(byId.nowy.openG).toBe(1000);
  });

  it('nadwyżka przelewa się na kolejny rachunek tej samej pary', () => {
    const res = billLedger(bills, [pay('w1', 'b', 'a', 25)]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.stary.openG).toBe(0);
    expect(byId.nowy.openG).toBe(500);
    expect(res.unassigned).toEqual([]);
  });

  it('wpłata ze wskazanym rachunkiem gasi WSKAZANY, nie najstarszy', () => {
    const res = billLedger(bills, [pay('w1', 'b', 'a', 10, { billId: 'nowy' })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.nowy.openG).toBe(0);
    expect(byId.stary.openG).toBe(2000);
  });

  it('nadwyżka ponad wskazany rachunek schodzi na resztę pary, nie do bloku bez przypisania', () => {
    const res = billLedger(bills, [pay('w1', 'b', 'a', 15, { billId: 'nowy' })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.nowy.openG).toBe(0);
    expect(byId.stary.openG).toBe(1500);
    expect(res.unassigned).toEqual([]);
  });
});

describe('WYBRANE RACHUNKI (arkusz „Za co płacisz")', () => {
  // Trzy rachunki tej samej pary. Jeden przelew pokrywa DWA z nich — ten wybór musi
  // przeżyć w danych, bo reguła „od najstarszego" zgasiłaby inne niż wskazane.
  const bills = [
    bill('a1', 40, 'ala', ['ala', 'bartek'], { at: 1, name: 'Kolacja' }),
    bill('a2', 40, 'ala', ['ala', 'bartek'], { at: 2, name: 'Taxi' }),
    bill('a3', 40, 'ala', ['ala', 'bartek'], { at: 3, name: 'Hotel' }),
  ];

  it('gasi DOKŁADNIE wskazane rachunki, także gdy pomijają najstarszy', () => {
    const res = billLedger(bills, [pay('w1', 'bartek', 'ala', 40, { billIds: ['a2', 'a3'] })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.a1.openG).toBe(2000); // najstarszy NIETKNIĘTY
    expect(byId.a2.openG).toBe(0);
    expect(byId.a3.openG).toBe(0);
    expect(res.unassigned).toEqual([]);
  });

  it('nadwyżka ponad wybrane schodzi na resztę pary, zanim uzna się ją za nieprzypisaną', () => {
    // Udział w każdym rachunku to 20,00. Wpłata 50,00 ze wskazaniem „Hotel":
    // 20,00 gasi Hotel, a 30,00 nadwyżki idzie po parze od najstarszego —
    // 20,00 na Kolację i 10,00 na Taxi.
    const res = billLedger(bills, [pay('w1', 'bartek', 'ala', 50, { billIds: ['a3'] })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.a3.openG).toBe(0);
    expect(byId.a1.openG).toBe(0);
    expect(byId.a2.openG).toBe(1000);
    expect(res.unassigned).toEqual([]);
  });

  it('kwota mniejsza niż wybrane rachunki gasi je po kolei, od najstarszego z WYBRANYCH', () => {
    const res = billLedger(bills, [pay('w1', 'bartek', 'ala', 25, { billIds: ['a2', 'a3'] })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.a2.openG).toBe(0);
    expect(byId.a3.openG).toBe(1500);
    expect(byId.a1.openG).toBe(2000);
  });

  it('stare pole `billId` działa dalej, obok nowego `billIds`', () => {
    const res = billLedger(bills, [pay('w1', 'bartek', 'ala', 20, { billId: 'a3' })]);
    expect(res.rows.find((r) => r.billId === 'a3').openG).toBe(0);
    expect(res.rows.find((r) => r.billId === 'a1').openG).toBe(2000);
  });

  it('niezmiennik trzyma się także przy wyborze rachunków', () => {
    const settlements = [pay('w1', 'bartek', 'ala', 40, { billIds: ['a2', 'a3'] })];
    const ledger = buildLedger(bills, settlements);
    const perBill = billLedger(bills, settlements);
    ['ala', 'bartek'].forEach((id) => {
      expect(netFromBills(perBill, id)).toEqual(myNetByCurrency(ledger, id));
    });
  });
});

describe('PRZYPISANIE TYLKO W OBRĘBIE PARY', () => {
  // Kuba winien Markowi (rachunek Marka) i Oli (rachunek Oli). Wpłata do Oli NIE MOŻE
  // zgasić rachunku Marka — inaczej ekran twierdziłby, że Marek dostał pieniądze,
  // które poszły do Oli.
  const bills = [
    bill('marek', 100, 'marek', ['marek', 'kuba'], { at: 1000, name: 'Kolacja' }),
    bill('ola', 100, 'ola', ['ola', 'kuba'], { at: 2000, name: 'Taxi' }),
  ];

  it('wpłata do Oli nie rusza długu wobec Marka', () => {
    const res = billLedger(bills, [pay('w1', 'kuba', 'ola', 50)]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.ola.openG).toBe(0);
    expect(byId.marek.openG).toBe(5000);
    expect(res.unassigned).toEqual([]);
  });

  it('wskazanie cudzego rachunku nie przenosi wpłaty na inną parę', () => {
    // billId wskazuje rachunek Marka, ale wpłata idzie do Oli — wskazanie jest ignorowane,
    // bo poza parą nie ma czego gasić.
    const res = billLedger(bills, [pay('w1', 'kuba', 'ola', 50, { billId: 'marek' })]);
    const byId = Object.fromEntries(res.rows.map((r) => [r.billId, r]));
    expect(byId.marek.openG).toBe(5000);
    expect(byId.ola.openG).toBe(0);
  });

  it('waluty się nie mieszają: wpłata w EUR nie gasi długu w PLN', () => {
    const b = [bill('r1', 90, 'a', ['a', 'b'], { currency: 'PLN' })];
    const res = billLedger(b, [pay('w1', 'b', 'a', 45, { currency: 'EUR' })]);
    expect(res.rows[0].openG).toBe(4500);
    expect(res.unassigned).toHaveLength(1);
    expect(res.unassigned[0].currency).toBe('EUR');
  });
});

describe('WPŁATY BEZ PRZYPISANIA', () => {
  it('wpłata do kogoś, komu nic nie jestem winien, ląduje w bloku bez przypisania', () => {
    // Klasyczny ślad planu minimalnego: Kuba winien Markowi, ale przelał Oli.
    const bills = [bill('r1', 100, 'marek', ['marek', 'kuba'])];
    const res = billLedger(bills, [pay('w1', 'kuba', 'ola', 50)]);
    expect(res.rows[0].openG).toBe(5000);
    expect(res.unassigned).toEqual([
      { settlementId: 'w1', from: 'kuba', to: 'ola', currency: 'PLN', amountG: 5000, leftG: 5000, at: 0 },
    ]);
  });

  it('nadpłata: przypisuje się tyle, ile było długu, reszta idzie do bloku', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 50)]);
    expect(res.rows.find((r) => r.debtor === 'b').openG).toBe(0);
    expect(res.unassigned).toHaveLength(1);
    expect(res.unassigned[0].leftG).toBe(2000); // 50,00 − 30,00 udziału
    expect(res.unassigned[0].amountG).toBe(5000);
  });

  it('myUnassigned dzieli blok na wysłane i otrzymane', () => {
    const res = billLedger([], [pay('w1', 'kuba', 'ola', 30), pay('w2', 'marek', 'kuba', 10)]);
    const mine = myUnassigned(res, 'kuba');
    expect(mine.sent.map((u) => u.settlementId)).toEqual(['w1']);
    expect(mine.received.map((u) => u.settlementId)).toEqual(['w2']);
  });
});

describe('myBillsToPay — moje rachunki do oddania, BEZ zwijania', () => {
  it('zwraca wiersz na każdy rachunek, w kolejności dodawania', () => {
    const bills = [
      bill('r2', 20, 'a', ['a', 'b'], { at: 2000, name: 'Taxi' }),
      bill('r1', 40, 'a', ['a', 'b'], { at: 1000, name: 'Kolacja' }),
      bill('r3', 60, 'c', ['c', 'b'], { at: 3000, name: 'Hotel' }),
    ];
    const res = billLedger(bills, []);
    // Trzy wiersze mimo dwóch rachunków od tej samej osoby — sumowania po osobie
    // ma nie być, bo od tego jest tryb „Kto komu".
    expect(myBillsToPay(res, 'b').map((r) => r.billName)).toEqual(['Kolacja', 'Taxi', 'Hotel']);
  });

  it('rachunek spłacony w całości znika z listy do oddania', () => {
    const res = billLedger([bill('r1', 40, 'a', ['a', 'b'])], [pay('w1', 'b', 'a', 20)]);
    expect(myBillsToPay(res, 'b')).toEqual([]);
  });
});

describe('billSettledBy — „kto już oddał" na ekranie rachunku', () => {
  it('rozdziela tych, którzy oddali, od tych, którzy nie', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 30)]);
    const who = billSettledBy(res, 'r1');
    expect(who.find((x) => x.debtor === 'b')).toMatchObject({ settled: true, paidG: 3000, openG: 0 });
    expect(who.find((x) => x.debtor === 'c')).toMatchObject({ settled: false, paidG: 0, openG: 3000 });
  });

  it('płatnik nie występuje na własnej liście', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], []);
    expect(billSettledBy(res, 'r1').map((x) => x.debtor).sort()).toEqual(['b', 'c']);
  });

  it('wpłata częściowa: nie oddał, ale widać ile wpłacił', () => {
    const res = billLedger([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 10)]);
    expect(billSettledBy(res, 'r1').find((x) => x.debtor === 'b'))
      .toMatchObject({ settled: false, paidG: 1000, openG: 2000 });
  });
});

describe('linia uzgadniająca', () => {
  it('rachunki minus wpłata bez przypisania daje to, co zostaje', () => {
    // 5 rachunków po 26,00 = 130,00; wpłata 30,00 poprowadzona w bok.
    const bills = [1, 2, 3, 4, 5].map((i) => bill(`r${i}`, 52, 'a', ['a', 'b'], { at: i }));
    const res = billLedger(bills, [pay('w1', 'b', 'ola', 30)]);
    expect(reconcileToPay(res, 'b', 'PLN')).toEqual({
      currency: 'PLN', billCount: 5, billsG: 13000, unassignedG: 3000, restG: 10000,
    });
  });

  it('bez wpłat bez przypisania linia mówi samą sumę rachunków', () => {
    const res = billLedger([bill('r1', 40, 'a', ['a', 'b'])], []);
    expect(reconcileToPay(res, 'b', 'PLN')).toMatchObject({ billCount: 1, unassignedG: 0, restG: 2000 });
  });

  it('nadpłata nie robi ujemnego długu', () => {
    const res = billLedger([], [pay('w1', 'b', 'ola', 30)]);
    expect(reconcileToPay(res, 'b', 'PLN').restG).toBe(0);
  });

  it('currenciesToPay widzi też waluty samych wpłat bez przypisania', () => {
    const res = billLedger(
      [bill('r1', 40, 'a', ['a', 'b'], { currency: 'PLN' })],
      [pay('w1', 'b', 'ola', 30, { currency: 'EUR' })],
    );
    expect(currenciesToPay(res, 'b').sort()).toEqual(['EUR', 'PLN']);
  });
});

// ======================================================================
// NIEZMIENNIK TRZECH TRYBÓW.
//
// Saldo na czysto każdej osoby jest IDENTYCZNE we wszystkich trzech trybach. Tryb
// zmienia wyłącznie trasę pieniędzy i grubość ziarna, nigdy wynik. To jedyna rzecz,
// która broni przed tym, żeby trzy tryby stały się trzema księgowościami — i dlatego
// ma własny test, a nie przypis w komentarzu.
// ======================================================================
describe('NIEZMIENNIK: saldo na czysto identyczne we wszystkich trybach', () => {
  const sprawdz = (bills, settlements, ludzie) => {
    const ledger = buildLedger(bills, settlements);
    const perBill = billLedger(bills, settlements);
    ludzie.forEach((id) => {
      expect(netFromBills(perBill, id), `saldo ${id} rozjechało się między trybami`)
        .toEqual(myNetByCurrency(ledger, id));
    });
  };

  it('proste długi bez wpłat', () => {
    sprawdz([bill('r1', 90, 'a', ['a', 'b', 'c'])], [], ['a', 'b', 'c']);
  });

  it('wpłata w obrębie pary', () => {
    sprawdz([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 30)], ['a', 'b', 'c']);
  });

  it('wpłata częściowa', () => {
    sprawdz([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 12.34)], ['a', 'b', 'c']);
  });

  it('nadpłata (wpłata większa niż dług)', () => {
    sprawdz([bill('r1', 90, 'a', ['a', 'b', 'c'])], [pay('w1', 'b', 'a', 50)], ['a', 'b', 'c']);
  });

  it('KÓŁKO DŁUGÓW ZAMKNIĘTE PLANEM MINIMALNYM — wpłata poza parą', () => {
    // Kuba winien Markowi 50, Marek Oli 50. Plan minimalny: Kuba płaci Oli 50.
    // W trybie rachunkowym ta wpłata nie gasi ani jednego rachunku (Kuba nie ma
    // rachunku z Olą), więc siedzi w bloku bez przypisania — a saldo na czysto
    // MUSI mimo to wyjść identyczne jak w pozostałych dwóch trybach.
    const bills = [
      bill('r1', 100, 'marek', ['marek', 'kuba'], { at: 1 }),
      bill('r2', 100, 'ola', ['ola', 'marek'], { at: 2 }),
    ];
    sprawdz(bills, [pay('w1', 'kuba', 'ola', 50, { at: 3 })], ['kuba', 'marek', 'ola']);
  });

  it('kilka walut naraz', () => {
    const bills = [
      bill('r1', 90, 'a', ['a', 'b', 'c'], { currency: 'PLN' }),
      bill('r2', 60, 'b', ['a', 'b'], { currency: 'EUR' }),
    ];
    sprawdz(bills, [pay('w1', 'b', 'a', 10, { currency: 'PLN' })], ['a', 'b', 'c']);
  });

  it('losowe układy: sto pokoi po pięć osób', () => {
    // Deterministyczny generator — powtarzalna porażka jest warunkiem naprawy.
    let seed = 20260826;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const ludzie = ['a', 'b', 'c', 'd', 'e'];
    for (let iter = 0; iter < 100; iter++) {
      const bills = [];
      for (let i = 0; i < 1 + rnd(4); i++) {
        const payer = ludzie[rnd(5)];
        const skl = ludzie.filter((x) => x === payer || rnd(2) === 0);
        bills.push(bill(`r${i}`, 10 + rnd(200), payer, skl, { at: i }));
      }
      const settlements = [];
      for (let i = 0; i < rnd(4); i++) {
        const from = ludzie[rnd(5)];
        const to = ludzie[(ludzie.indexOf(from) + 1 + rnd(4)) % 5];
        settlements.push(pay(`w${i}`, from, to, 5 + rnd(150), { at: 100 + i }));
      }
      sprawdz(bills, settlements, ludzie);
    }
  });
});

// ====================================================================================
// RACHUNEK, KTÓRY SIĘ NIE SPINA, ZNIKA Z EKRANÓW O PIENIĄDZACH (decyzja właściciela
// 2026-08-27). Suma pozycji kłóci się z kwotą, którą płatnik wyłożył — aplikacja nie wie,
// która liczba jest prawdziwa, więc udziały z takiego rachunku są zmyślone i nie mają czego
// szukać na Bilansie ani w Rozliczeniach. Wraca sam, gdy płatnik poprawi wpis.
// ====================================================================================

const zepsuty = (id, { everOpened = true, payerId = 'a', at = 0 } = {}) => ({
  id,
  billName: id,
  gated: true,
  splitMode: 'own',
  settleOpen: false,
  everOpened,
  totalAmount: 33,
  currency: 'PLN',
  payerId,
  payerConfirmed: true,
  createdAtMs: at,
  participants: {
    a: { id: 'a', status: 'in' }, b: { id: 'b', status: 'in' }, c: { id: 'c', status: 'in' },
  },
  sharedCosts: [
    { id: 'i1', description: 'Pizza', amount: 10, sharedBy: ['a'] },
    { id: 'i2', description: 'Pizza', amount: 10, sharedBy: ['b'] },
    { id: 'i3', description: 'Pizza', amount: 10, sharedBy: ['c'] },
  ],
  // Napiwek wpisany jako 30 zamiast 3: pozycje dają 60 przy rachunku na 33.
  globalCosts: [{ id: 'g1', description: 'Napiwek', type: 'amount', value: 30 }],
});

const naprawiony = (b) => ({ ...b, globalCosts: [{ id: 'g1', description: 'Napiwek', type: 'amount', value: 3 }] });

describe('ledgerVisibleBills — co dociera do Bilansu i Rozliczeń', () => {
  it('rachunek, który się spina, przechodzi bez zmian', () => {
    const ok = naprawiony(zepsuty('r1'));
    expect(ledgerVisibleBills([ok], []).map((b) => b.id)).toEqual(['r1']);
  });

  it('rachunek z nadwyżką znika, gdy nikt jeszcze nic za niego nie oddał', () => {
    const zly = zepsuty('r1');
    const dobry = bill('r2', 90, 'a', ['a', 'b', 'c']);
    expect(ledgerVisibleBills([zly, dobry], []).map((b) => b.id)).toEqual(['r2']);
  });

  it('zniknięcie NIE rusza długów z pozostałych rachunków', () => {
    const zly = zepsuty('r1');
    const dobry = bill('r2', 90, 'a', ['a', 'b', 'c']);
    const net = buildLedger(ledgerVisibleBills([zly, dobry], []), []).PLN.net;
    expect(net).toEqual([
      { from: 'b', to: 'a', amountG: 3000 },
      { from: 'c', to: 'a', amountG: 3000 },
    ]);
  });

  it('wraca sam, gdy płatnik poprawi wpis — bez żadnego zapisu w bazie', () => {
    const zly = zepsuty('r1');
    expect(ledgerVisibleBills([zly], []).map((b) => b.id)).toEqual([]);
    expect(ledgerVisibleBills([naprawiony(zly)], []).map((b) => b.id)).toEqual(['r1']);
  });

  it('WYJĄTEK: rachunek, do którego ktoś już dopłacił, ZOSTAJE', () => {
    // Inaczej jego wpłata zawisłaby w powietrzu, a `buildLedger` zrobiłby z niej dług
    // płatnika wobec tego, kto mu właśnie zapłacił.
    const zly = zepsuty('r1');
    const wplata = [pay('s1', 'c', 'a', 11, { at: 5 })];
    expect(ledgerVisibleBills([zly], wplata).map((b) => b.id)).toEqual(['r1']);
  });

  it('i dzięki temu kierunek długu się NIE odwraca', () => {
    const zly = zepsuty('r1');
    const wplata = [pay('s1', 'c', 'a', 11, { at: 5 })];
    const net = buildLedger(ledgerVisibleBills([zly], wplata), wplata).PLN.net;
    // Płatnik (a) nie jest nikomu nic winien — żadnej krawędzi wychodzącej z „a".
    expect(net.filter((t) => t.from === 'a')).toEqual([]);
  });

  it('gdyby jednak wypadł mimo wpłaty, dług szedłby w drugą stronę (test-świadek)', () => {
    // Trzyma opisany stan błędu, żeby nikt nie „uprościł" wyjątku.
    const wplata = [pay('s1', 'c', 'a', 11, { at: 5 })];
    const net = buildLedger([], wplata).PLN.net;
    expect(net).toEqual([{ from: 'a', to: 'c', amountG: 1100 }]);
  });

  it('rachunek z nadwyżką, ale zapłacony przez KOGO INNEGO w tej samej parze, też zostaje', () => {
    // Wpłaty przypisują się w obrębie pary od najstarszego rachunku, więc wystarczy,
    // że cokolwiek na ten rachunek spadło.
    const zly = zepsuty('r1');
    const wplata = [pay('s1', 'b', 'a', 5, { at: 5 })];
    expect(ledgerVisibleBills([zly], wplata).map((b) => b.id)).toEqual(['r1']);
  });

  it('pusta lista i brak wpłat nie wywracają funkcji', () => {
    expect(ledgerVisibleBills([], [])).toEqual([]);
    expect(ledgerVisibleBills(null, null)).toEqual([]);
  });
});
