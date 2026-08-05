import { describe, it, expect } from 'vitest';
import {
  calculateAll,
  calculateSimple,
  calculateAllForBill,
  toGrosze,
  fromGrosze,
  ceilGrosze,
} from './calc.js';

// ======================================================================
// Testy Fazy 1 — fundament zaufania: zaokrąglanie W GÓRĘ + kontrola sumy.
// ======================================================================

// --- helpery budujące rachunki ---
const simple = (totalAmount, statuses) => ({
  type: 'simple',
  totalAmount,
  participants: Object.fromEntries(
    statuses.map((st, i) => [`p${i}`, { id: `p${i}`, status: st }]),
  ),
});

const adv = (totalAmount, people, sharedCosts = [], globalCosts = []) => ({
  type: 'advanced',
  totalAmount,
  participants: Object.fromEntries(
    people.map((p, i) => {
      const id = p.id || `p${i}`;
      return [id, { id, status: p.status || 'unpaid', individualAmount: p.ind || 0 }];
    }),
  ),
  sharedCosts,
  globalCosts,
});

const pt = (res, id) => res.participantTotals.find((x) => x.participant.id === id);
const sumExact = (res) => res.participantTotals.reduce((s, p) => s + (p.exactTotal || 0), 0);
const activeCount = (res) => res.participantTotals.filter((p) => p.total > 0 || p.exactTotal > 0).length;

// Niezmienniki, które MUSZĄ zachodzić zawsze — sedno zaufania.
function expectTrustInvariants(res) {
  const exactSum = sumExact(res);
  const n = activeCount(res);

  // 1) Każdy udział zaokrąglony w górę: total >= exact, ale nie więcej niż o 1 grosz.
  res.participantTotals.forEach((p) => {
    expect(p.total).toBeGreaterThanOrEqual(p.exactTotal - 1e-9);
    expect(p.total).toBeLessThanOrEqual(p.exactTotal + 0.01 + 1e-9);
  });

  // 2) Suma zebrana >= suma dokładna.
  expect(res.controlSum).toBeGreaterThanOrEqual(exactSum - 1e-9);

  // 3) Nadwyżka nie większa niż (liczba aktywnych) groszy.
  expect(res.controlSum - exactSum).toBeLessThanOrEqual(n * 0.01 + 1e-9);

  // 4) PŁATNIK NIGDY STRATNY: dla dowolnego wyboru płatnika kwota, którą zbierze
  //    (controlSum - jego udział), >= tego, co dłużnicy są mu winni dokładnie.
  res.participantTotals.forEach((payer) => {
    const receives = res.controlSum - payer.total;
    const owedByDebtors = exactSum - (payer.exactTotal || 0);
    expect(receives).toBeGreaterThanOrEqual(owedByDebtors - 1e-9);
  });
}

describe('helpery groszowe', () => {
  it('toGrosze zamienia złote na grosze (round do grosza)', () => {
    expect(toGrosze(33.33)).toBe(3333);
    expect(toGrosze(0.1)).toBe(10);
    expect(toGrosze(100)).toBe(10000);
    expect(toGrosze(undefined)).toBe(0);
  });

  it('fromGrosze zamienia grosze na złote', () => {
    expect(fromGrosze(3334)).toBeCloseTo(33.34, 2);
    expect(fromGrosze(0)).toBe(0);
  });

  it('ceilGrosze zaokrągla W GÓRĘ do pełnego grosza', () => {
    expect(ceilGrosze(3333.33)).toBe(3334);
    expect(ceilGrosze(3333.01)).toBe(3334);
    expect(ceilGrosze(5000)).toBe(5000); // pełny grosz nie jest podbijany
    expect(ceilGrosze(0)).toBe(0);
  });

  it('ceilGrosze nie podbija wartości z szumem float', () => {
    expect(ceilGrosze(4850.0000001)).toBe(4850);
    expect(ceilGrosze(2850.0000000001)).toBe(2850);
  });
});

describe('rachunek prosty — podział i zaokrąglanie w górę', () => {
  it('100 / 2 = po 50, suma 100', () => {
    const res = calculateSimple(simple(100, ['unpaid', 'unpaid']));
    expect(pt(res, 'p0').total).toBeCloseTo(50, 2);
    expect(res.controlSum).toBeCloseTo(100, 2);
  });

  it('100 / 3 = po 33,34 (w górę), suma 100,02', () => {
    const res = calculateSimple(simple(100, ['unpaid', 'unpaid', 'unpaid']));
    res.participantTotals.forEach((p) => expect(p.total).toBeCloseTo(33.34, 2));
    expect(res.controlSum).toBeCloseTo(100.02, 2);
    expect(res.amountPerPerson).toBeCloseTo(33.34, 2);
  });

  it('płatnik przy 100 / 3 nie jest stratny (zbiera 66,68 od dwóch dłużników)', () => {
    const res = calculateSimple(simple(100, ['unpaid', 'unpaid', 'unpaid']));
    const receives = res.controlSum - pt(res, 'p0').total; // 100,02 - 33,34
    expect(receives).toBeCloseTo(66.68, 2);
    expect(receives).toBeGreaterThanOrEqual(100 - res.exactAmountPerPerson - 1e-9);
  });

  it('10 / 3 = po 3,34, suma 10,02', () => {
    const res = calculateSimple(simple(10, ['unpaid', 'unpaid', 'unpaid']));
    res.participantTotals.forEach((p) => expect(p.total).toBeCloseTo(3.34, 2));
    expect(res.controlSum).toBeCloseTo(10.02, 2);
  });

  it('not_applicable wypada z podziału: 90 / 2 aktywnych = 45', () => {
    const res = calculateSimple(simple(90, ['unpaid', 'unpaid', 'not_applicable']));
    expect(pt(res, 'p0').total).toBeCloseTo(45, 2);
    expect(pt(res, 'p2').total).toBe(0);
    expect(res.controlSum).toBeCloseTo(90, 2);
  });

  it('kwota 0 → wszyscy 0, kontrola pusta', () => {
    const res = calculateSimple(simple(0, ['unpaid', 'unpaid']));
    expect(res.controlSum).toBe(0);
    expect(res.control.status).toBe('empty');
  });

  it('niezmienniki dla różnych podziałów prostych', () => {
    [7, 100, 33.33, 1, 999.99, 12.5].forEach((total) => {
      [2, 3, 4, 5, 7].forEach((n) => {
        const res = calculateSimple(simple(total, Array(n).fill('unpaid')));
        expectTrustInvariants(res);
      });
    });
  });
});

describe('rachunek zaawansowany — składowe', () => {
  it('same koszty indywidualne', () => {
    const res = calculateAll(adv(60, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }]));
    expect(pt(res, 'a').total).toBeCloseTo(40, 2);
    expect(pt(res, 'b').total).toBeCloseTo(20, 2);
    expect(res.controlSum).toBeCloseTo(60, 2);
  });

  it('koszt dzielony po równo (10 na 2 = po 5)', () => {
    const bill = adv(10, [{ id: 'a' }, { id: 'b' }], [{ id: 's1', amount: 10, sharedBy: ['a', 'b'] }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').sharedAmount).toBeCloseTo(5, 2);
    expect(pt(res, 'a').total).toBeCloseTo(5, 2);
    expect(res.controlSum).toBeCloseTo(10, 2);
  });

  it('koszt dzielony niepodzielny (10 na 3 → po 3,34)', () => {
    const bill = adv(10, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 's1', amount: 10, sharedBy: ['a', 'b', 'c'] }]);
    const res = calculateAll(bill);
    res.participantTotals.forEach((p) => expect(p.total).toBeCloseTo(3.34, 2));
    expect(res.controlSum).toBeCloseTo(10.02, 2);
    expectTrustInvariants(res);
  });

  it('koszt dzielony tylko przez część osób', () => {
    const bill = adv(10, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 's1', amount: 10, sharedBy: ['a', 'b'] }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(5, 2);
    expect(pt(res, 'b').total).toBeCloseTo(5, 2);
    expect(pt(res, 'c').total).toBe(0);
  });

  it('koszt ogólny kwotowy (12 na 2 = po 6)', () => {
    const bill = adv(72, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }], [], [{ id: 'g1', type: 'fixed', value: 12 }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(46, 2);
    expect(pt(res, 'b').total).toBeCloseTo(26, 2);
    expect(res.controlSum).toBeCloseTo(72, 2);
  });

  it('koszt ogólny procentowy (10% z 60 = 6, po 3)', () => {
    const bill = adv(66, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }], [], [{ id: 'g1', type: 'percent', value: 10 }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(43, 2);
    expect(pt(res, 'b').total).toBeCloseTo(23, 2);
    expect(res.controlSum).toBeCloseTo(66, 2);
  });

  it('napiwek % niepodzielny (7 zł na 3 → nadwyżka groszy, płatnik nie stratny)', () => {
    const bill = adv(77, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }, { id: 'c', ind: 10 }], [], [{ id: 'g1', type: 'percent', value: 10 }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(42.34, 2);
    expect(pt(res, 'b').total).toBeCloseTo(22.34, 2);
    expect(pt(res, 'c').total).toBeCloseTo(12.34, 2);
    expect(res.controlSum).toBeCloseTo(77.02, 2);
    expectTrustInvariants(res);
  });

  it('indywidualne + dzielone + napiwek % (48,50 / 28,50)', () => {
    const bill = adv(
      77,
      [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }],
      [{ id: 's1', amount: 10, sharedBy: ['a', 'b'] }],
      [{ id: 'g1', type: 'percent', value: 10 }],
    );
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(48.5, 2);
    expect(pt(res, 'b').total).toBeCloseTo(28.5, 2);
    expect(res.controlSum).toBeCloseTo(77, 2);
  });

  it('not_applicable powiększa udział pozostałych (napiwek dzielony na mniej osób)', () => {
    const bill = adv(
      20,
      [{ id: 'a', ind: 10 }, { id: 'b', ind: 10, status: 'not_applicable' }],
      [],
      [{ id: 'g1', type: 'fixed', value: 4 }],
    );
    const res = calculateAll(bill);
    // Aktywny jest tylko 'a': 10 (koszt własny) + 4 (cały napiwek) = 14 rozpisane,
    // a pozostałe 6 z dwudziestu to kwota nierozpisana, która przy jednym aktywnym
    // uczestniku trafia w całości do niego. Rachunek na 20 rozchodzi się w całości —
    // dawniej ta szóstka zostawała po cichu na płatniku.
    expect(pt(res, 'a').total).toBeCloseTo(20, 2);
    expect(pt(res, 'a').restAmount).toBeCloseTo(6, 2);
    expect(pt(res, 'b').total).toBe(0);
  });
});

describe('jeden rachunek, który rośnie: kwota nierozpisana idzie po równo', () => {
  it('rachunek bez ani jednej pozycji dzieli się po równo', () => {
    const bill = adv(90, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(30, 2);
    expect(pt(res, 'b').total).toBeCloseTo(30, 2);
    expect(pt(res, 'c').total).toBeCloseTo(30, 2);
    expect(res.unallocated).toBeCloseTo(90, 2);
  });

  it('część rozpisana imiennie, reszta po równo', () => {
    // 100 na rachunku, 40 wzięte imiennie przez 'a' → 60 nierozpisane, po 30 na osobę.
    const bill = adv(100, [{ id: 'a', ind: 40 }, { id: 'b' }]);
    const res = calculateAll(bill);
    expect(res.unallocated).toBeCloseTo(60, 2);
    expect(res.perPersonUnallocated).toBeCloseTo(30, 2);
    expect(pt(res, 'a').total).toBeCloseTo(70, 2);
    expect(pt(res, 'b').total).toBeCloseTo(30, 2);
  });

  it('rachunek rozpisany co do grosza nie dokłada nikomu reszty', () => {
    const bill = adv(100, [{ id: 'a', ind: 60 }, { id: 'b', ind: 40 }]);
    const res = calculateAll(bill);
    expect(res.unallocated).toBe(0);
    expect(pt(res, 'a').total).toBeCloseTo(60, 2);
    expect(pt(res, 'b').total).toBeCloseTo(40, 2);
  });

  it('pozycje ponad kwotę rachunku nie tworzą ujemnej reszty (to błąd wpisu, nie rabat)', () => {
    const bill = adv(50, [{ id: 'a', ind: 40 }, { id: 'b', ind: 30 }]);
    const res = calculateAll(bill);
    expect(res.unallocated).toBe(0);
    expect(res.control.status).toBe('over');
    expect(pt(res, 'a').total).toBeCloseTo(40, 2);
    expect(pt(res, 'b').total).toBeCloseTo(30, 2);
  });

  it('bez kwoty rachunku nie ma czego dzielić', () => {
    const bill = adv(0, [{ id: 'a' }, { id: 'b' }]);
    const res = calculateAll(bill);
    expect(res.unallocated).toBe(0);
    expect(pt(res, 'a').total).toBe(0);
    expect(res.control.status).toBe('empty');
  });

  it('„nie dotyczy" nie dostaje udziału w kwocie nierozpisanej', () => {
    const bill = adv(60, [{ id: 'a' }, { id: 'b' }, { id: 'c', status: 'not_applicable' }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(30, 2);
    expect(pt(res, 'b').total).toBeCloseTo(30, 2);
    expect(pt(res, 'c').total).toBe(0);
  });
});

describe('kontrola: suma pozycji vs kwota rachunku', () => {
  it('zgadza się co do grosza → ok', () => {
    const bill = adv(100, [{ id: 'a', ind: 60 }, { id: 'b', ind: 40 }]);
    expect(calculateAll(bill).control.status).toBe('ok');
  });

  it('pozycje 550, rachunek 500 → over, różnica 50', () => {
    const bill = adv(500, [{ id: 'a', ind: 200 }, { id: 'b', ind: 200 }, { id: 'c', ind: 150 }]);
    const { control } = calculateAll(bill);
    expect(control.status).toBe('over');
    expect(control.diff).toBeCloseTo(50, 2);
  });

  it('pozycje 80, rachunek 100 → under, różnica 20', () => {
    const bill = adv(100, [{ id: 'a', ind: 50 }, { id: 'b', ind: 30 }]);
    const { control } = calculateAll(bill);
    expect(control.status).toBe('under');
    expect(control.diff).toBeCloseTo(20, 2);
  });

  it('kwota 0 → empty', () => {
    const bill = adv(0, [{ id: 'a', ind: 50 }, { id: 'b', ind: 30 }]);
    expect(calculateAll(bill).control.status).toBe('empty');
  });

  it('napiwek % wliczony do sumy pozycji (66 = 60 + 10%)', () => {
    const bill = adv(66, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }], [], [{ id: 'g1', type: 'percent', value: 10 }]);
    expect(calculateAll(bill).control.status).toBe('ok');
  });

  it('drobny błąd 1 grosz mieści się w tolerancji (ok)', () => {
    const bill = adv(100.01, [{ id: 'a', ind: 60 }, { id: 'b', ind: 40 }]);
    expect(calculateAll(bill).control.status).toBe('ok');
  });

  it('błąd 2 grosze już łapie (over)', () => {
    const bill = adv(100, [{ id: 'a', ind: 60.02 }, { id: 'b', ind: 40 }]);
    const { control } = calculateAll(bill);
    expect(control.status).toBe('over');
    expect(control.diff).toBeCloseTo(0.02, 2);
  });
});

describe('niezmienniki zaufania — losowe rachunki', () => {
  it('setki losowych rachunków zaawansowanych spełniają niezmienniki', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rnd() * 5); // 2..6 osób
      const people = Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        ind: Math.round(rnd() * 10000) / 100, // 0..100 zł
        status: rnd() < 0.15 ? 'not_applicable' : 'unpaid',
      }));
      const shared = rnd() < 0.5
        ? [{ id: 's1', amount: Math.round(rnd() * 5000) / 100, sharedBy: people.slice(0, Math.max(1, Math.floor(rnd() * n))).map((p) => p.id) }]
        : [];
      const global = rnd() < 0.5
        ? [{ id: 'g1', type: rnd() < 0.5 ? 'percent' : 'fixed', value: rnd() < 0.5 ? 10 : Math.round(rnd() * 2000) / 100 }]
        : [];
      const res = calculateAll(adv(0, people, shared, global));
      expectTrustInvariants(res);
    }
  });

  it('setki losowych rachunków prostych spełniają niezmienniki', () => {
    let seed = 999;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rnd() * 6);
      const statuses = Array.from({ length: n }, () => (rnd() < 0.2 ? 'not_applicable' : 'unpaid'));
      const total = Math.round(rnd() * 100000) / 100;
      expectTrustInvariants(calculateSimple(simple(total, statuses)));
    }
  });
});

describe('przypadki brzegowe i bezpieczeństwo float', () => {
  it('brak uczestników nie wywala', () => {
    const res = calculateAll({ type: 'advanced', participants: {} });
    expect(res.participantTotals).toEqual([]);
    expect(res.controlSum).toBe(0);
  });

  it('wszyscy not_applicable → same zera', () => {
    const res = calculateSimple(simple(100, ['not_applicable', 'not_applicable']));
    expect(res.controlSum).toBe(0);
    expect(res.amountPerPerson).toBe(0);
  });

  it('0,10 + 0,20 = 0,30 (bez szumu float)', () => {
    const bill = adv(0.3, [{ id: 'a', ind: 0.1 }, { id: 'b', ind: 0.2 }]);
    const res = calculateAll(bill);
    expect(pt(res, 'a').total).toBeCloseTo(0.1, 2);
    expect(pt(res, 'b').total).toBeCloseTo(0.2, 2);
    expect(res.controlSum).toBeCloseTo(0.3, 2);
    expect(res.control.status).toBe('ok');
  });

  it('zerowe kwoty → zerowe udziały', () => {
    const res = calculateAll(adv(0, [{ id: 'a', ind: 0 }, { id: 'b', ind: 0 }]));
    expect(res.controlSum).toBe(0);
  });

  it('duża kwota nie traci grosza (12345,67 / 7)', () => {
    const res = calculateSimple(simple(12345.67, Array(7).fill('unpaid')));
    expectTrustInvariants(res);
    expect(res.controlSum).toBeGreaterThanOrEqual(12345.67 - 1e-9);
  });
});

describe('calculateAllForBill dobiera właściwą funkcję', () => {
  it('typ simple → podział prosty', () => {
    const res = calculateAllForBill(simple(100, ['unpaid', 'unpaid', 'unpaid']));
    expect(res.participantTotals[0].total).toBeCloseTo(33.34, 2);
  });

  it('typ advanced → koszty indywidualne', () => {
    const res = calculateAllForBill(adv(60, [{ id: 'a', ind: 40 }, { id: 'b', ind: 20 }]));
    expect(pt(res, 'a').total).toBeCloseTo(40, 2);
  });
});
