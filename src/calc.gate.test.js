import { describe, it, expect } from 'vitest';
import { calculateAll, billSettleGate, billCountsInLedger, billSplitMode } from './calc.js';

// BRAMA ROZLICZEŃ. Pilnuje PIENIĘDZY, nie ludzi: rachunek wolno regulować dopiero wtedy,
// gdy żadna złotówka nie wisi bez właściciela. Testy trzymają dwie obietnice naraz —
// sumienny nie dopłaca za spóźnialskiego, a stare rachunki działają jak działały.

const osoba = (id, extra = {}) => ({ id, name: id, status: 'in', individualAmount: 0, ...extra });

const rachunek = (extra = {}) => ({
  totalAmount: 300,
  currency: 'PLN',
  payerId: 'michal',
  payerConfirmed: true,
  splitMode: 'own',
  gated: true,
  participants: {
    michal: osoba('michal'), ania: osoba('ania'), kuba: osoba('kuba'),
    ola: osoba('ola'), piotr: osoba('piotr'), zosia: osoba('zosia'),
  },
  // 6 dań po 40 + wino 40 = 280 pozycji, serwis 20 jako koszt ogólny.
  sharedCosts: [
    { id: 'd1', description: 'Danie', amount: 40, sharedBy: ['michal'] },
    { id: 'd2', description: 'Danie', amount: 40, sharedBy: ['ania'] },
    { id: 'd3', description: 'Danie', amount: 40, sharedBy: ['piotr'] },
    { id: 'd4', description: 'Danie', amount: 40, sharedBy: ['zosia'] },
    { id: 'd5', description: 'Danie', amount: 40, sharedBy: [] },  // Kuba nie stuknął
    { id: 'd6', description: 'Danie', amount: 40, sharedBy: [] },  // Ola nie stuknęła
    { id: 'w1', description: 'Wino', amount: 40, sharedBy: [] },   // wspólne, nikt nie wziął
  ],
  globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 20 }],
  ...extra,
});

const udzial = (wynik, id) => wynik.participantTotals.find((pt) => pt.participant.id === id).total;

describe('billSettleGate — kiedy wolno się rozliczać', () => {
  it('rachunek z kwotą wiszącą bez właściciela jest zamknięty', () => {
    const gate = billSettleGate(rachunek());
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('rest');
    expect(gate.needsDecision).toBe(true);
    expect(gate.unallocatedG).toBe(12000); // 2 dania + wino
  });

  it('rachunek rozpisany co do grosza otwiera się SAM, bez niczyjego zatwierdzenia', () => {
    const b = rachunek();
    b.sharedCosts = b.sharedCosts.map((it) => (
      it.sharedBy.length ? it : { ...it, sharedBy: ['kuba'] }
    ));
    const gate = billSettleGate(b);
    expect(gate.open).toBe(true);
    expect(gate.reason).toBe('exact');
  });

  it('tryb „po równo" nie ma bramy — scena przy stole zostaje nietknięta', () => {
    const b = rachunek({ splitMode: 'even', sharedCosts: [], globalCosts: [] });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('even');
  });

  it('stary rachunek bez pola `gated` działa jak dawniej', () => {
    const b = rachunek();
    delete b.gated;
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('legacy');
  });

  it('nadwyżka pozycji nad kwotą rachunku BLOKUJE zamknięcie', () => {
    // Bez tego warunku `unallocated` wynosi zero i brama otwierałaby się na rachunku,
    // na którym wszyscy przepłacają.
    const b = rachunek({ totalAmount: 100 });
    const gate = billSettleGate(b);
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('over');
  });

  it('po zamknięciu ręcznym brama stoi otworem', () => {
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('closed');
  });

  it('pozycja dopisana PO zamknięciu zamyka bramę z powrotem', () => {
    // Inaczej nieodklikana nowość rozdzieliłaby się po cichu — czyli ten sam błąd
    // tylnymi drzwiami.
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    b.totalAmount = 350;
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    const gate = billSettleGate(b);
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('changed');
  });

  it('grosz różnicy z procentowego kosztu ogólnego nie zamyka bramy', () => {
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 11999 });
    expect(billSettleGate(b).open).toBe(true);
  });
});

describe('restTo — komu przypada kwota nierozpisana', () => {
  it('bez `restTo` reszta idzie po równo na wszystkich aktywnych', () => {
    const w = calculateAll(rachunek());
    // 120 / 6 = 20 na osobę; Ania: danie 40 + reszta 20 + serwis 3,34 (w górę)
    expect(udzial(w, 'ania')).toBeCloseTo(63.34, 2);
    expect(udzial(w, 'kuba')).toBeCloseTo(23.34, 2);
    expect(w.restToEveryone).toBe(true);
  });

  it('`restTo` przerzuca resztę na wskazanych — sumienny przestaje dopłacać', () => {
    const w = calculateAll(rachunek({ restTo: ['kuba', 'ola'] }));
    // 120 / 2 = 60 dla Kuby i Oli; Ania płaci już tylko swoje danie + serwis.
    expect(udzial(w, 'ania')).toBeCloseTo(43.34, 2);
    expect(udzial(w, 'kuba')).toBeCloseTo(63.34, 2);
    expect(w.restToEveryone).toBe(false);
    expect(w.restToIds).toEqual(['kuba', 'ola']);
  });

  it('suma udziałów zawsze pokrywa rachunek — płatnik nigdy stratny', () => {
    [undefined, ['kuba', 'ola'], ['kuba']].forEach((restTo) => {
      const w = calculateAll(rachunek({ restTo }));
      expect(w.controlSum).toBeGreaterThanOrEqual(300);
    });
  });

  it('osoba wypisana z rachunku wypada z listy niosącej resztę', () => {
    const b = rachunek({ restTo: ['kuba', 'ola'] });
    b.participants.ola.status = 'not_applicable';
    const w = calculateAll(b);
    expect(w.restToIds).toEqual(['kuba']);
    expect(udzial(w, 'ola')).toBe(0);
  });

  it('gdy po odsianiu nie zostaje NIKT, reszta wraca do wszystkich aktywnych', () => {
    // Pieniądze nie mogą wyparować dlatego, że wskazana osoba odeszła z rachunku.
    const b = rachunek({ restTo: ['ktos-kogo-nie-ma'] });
    const w = calculateAll(b);
    expect(w.restToEveryone).toBe(true);
    expect(w.controlSum).toBeGreaterThanOrEqual(300);
  });
});

describe('billCountsInLedger — co wchodzi do księgi długów', () => {
  it('rachunek przed pierwszym otwarciem bramy NIE wchodzi', () => {
    expect(billCountsInLedger(rachunek())).toBe(false);
  });

  it('rachunek raz otwarty zostaje w księdze, nawet gdy brama się zamknie', () => {
    // Ktoś mógł już zapłacić. Wypadnięcie z księgi zostawiłoby wpłatę bez długu,
    // czyli fałszywy dług w drugą stronę.
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    b.totalAmount = 350;
    expect(billSettleGate(b).open).toBe(false);
    expect(billCountsInLedger(b)).toBe(true);
  });

  it('stary rachunek wchodzi zawsze', () => {
    const b = rachunek();
    delete b.gated;
    expect(billCountsInLedger(b)).toBe(true);
  });
});

describe('billSplitMode — jedno źródło prawdy', () => {
  it('czyta pole, gdy jest', () => {
    expect(billSplitMode({ splitMode: 'own' })).toBe('own');
    expect(billSplitMode({ splitMode: 'even' })).toBe('even');
  });

  it('bez pola wnioskuje z zawartości', () => {
    expect(billSplitMode({ sharedCosts: [{ id: 'a', amount: 10 }] })).toBe('own');
    expect(billSplitMode({ participants: { a: { individualAmount: 5 } } })).toBe('own');
    expect(billSplitMode({})).toBe('even');
  });
});

// NAJDROŻSZA POMYŁKA, JAKĄ TA ZMIANA MOGŁABY WPROWADZIĆ: wpłata bez długu po drugiej
// stronie. `buildLedger` dokłada wtedy krawędź ODWROTNĄ, czyli pokazuje dług w drugą
// stronę — ktoś mógłby w dobrej wierze upomnieć się o pieniądze, których nie jest winien.
// To ta sama rodzina usterek, co „wiersz widmo" opisany w src/plan.js.
describe('rachunek wypadający z księgi nie może osierocić wpłaty', () => {
  const zamkniety = () => rachunek({
    id: 'b1', settleOpen: true, everOpened: true, restSettledG: 12000,
  });

  it('wpłata za zamknięty rachunek gasi dług, a nie tworzy długu w drugą stronę', async () => {
    const { buildLedger } = await import('./calc.js');
    const bill = zamkniety();
    const wynik = calculateAll(bill);
    const udzialKuby = wynik.participantTotals.find((pt) => pt.participant.id === 'kuba').total;
    const ledger = buildLedger([bill], [
      { from: 'kuba', to: 'michal', amount: udzialKuby, currency: 'PLN' },
    ]);
    const net = (ledger.PLN && ledger.PLN.net) || [];
    const kubaMichal = net.filter((t) => (t.from === 'kuba' && t.to === 'michal') || (t.from === 'michal' && t.to === 'kuba'));
    expect(kubaMichal).toEqual([]);
  });

  it('rachunek zamknięty, potem znów otwarty, NADAL liczy się w księdze', async () => {
    const { buildLedger } = await import('./calc.js');
    const bill = zamkniety();
    bill.totalAmount = 350;
    bill.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    expect(billSettleGate(bill).open).toBe(false);
    // Gdyby wypadł, sama wpłata zostawiłaby Michała „winnego" Kubie.
    const bills = [bill].filter(billCountsInLedger);
    const ledger = buildLedger(bills, [{ from: 'kuba', to: 'michal', amount: 20, currency: 'PLN' }]);
    const odwrotny = ((ledger.PLN && ledger.PLN.net) || []).find((t) => t.from === 'michal' && t.to === 'kuba');
    expect(odwrotny).toBeUndefined();
  });
});
