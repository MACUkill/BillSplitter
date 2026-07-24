import { describe, it, expect } from 'vitest';
import {
  computeBillDebts,
  buildLedger,
  simplifyDebts,
  toGrosze,
} from './calc.js';

// ======================================================================
// Testy Fazy 5 — LEDGER (kto komu ile) + minimalizacja przelewów.
// Rdzeń zaufania: dług = zaokrąglony udział (pt.total), per-waluta, netowanie,
// zachowanie sald przy uproszczeniu (min. przelewów).
// ======================================================================

// --- helpery budujące rachunki ---
const simple = (totalAmount, currency, payerId, payerConfirmed, statuses) => ({
  type: 'simple',
  totalAmount,
  currency,
  payerId,
  payerConfirmed,
  participants: Object.fromEntries(statuses.map(([pid, st]) => [pid, { id: pid, status: st }])),
});

const adv = (totalAmount, currency, payerId, payerConfirmed, people) => ({
  type: 'advanced',
  totalAmount,
  currency,
  payerId,
  payerConfirmed,
  participants: Object.fromEntries(
    people.map(([pid, ind, st]) => [pid, { id: pid, status: st || 'unpaid', individualAmount: ind }]),
  ),
  sharedCosts: [],
  globalCosts: [],
});

const debtKey = (d) => `${d.from}->${d.to}:${d.amountG}`;

describe('computeBillDebts — długi z jednego rachunku', () => {
  it('prosty 100/3, płatnik a potwierdzony → b i c winni po 33,34', () => {
    const b = simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid'], ['c', 'unpaid']]);
    const debts = computeBillDebts(b).map(debtKey).sort();
    // ceil(10000/3) = 3334
    expect(debts).toEqual(['b->a:3334', 'c->a:3334']);
  });

  it('płatnik NIEpotwierdzony → brak długów', () => {
    const b = simple(100, 'PLN', 'a', false, [['a', 'unpaid'], ['b', 'unpaid']]);
    expect(computeBillDebts(b)).toEqual([]);
  });

  it('kwota 0 → brak długów', () => {
    const b = simple(0, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]);
    expect(computeBillDebts(b)).toEqual([]);
  });

  it('MODEL WPŁAT: status „paid" na rachunku NIE zeruje długu (spłata jest w rejestrze wpłat)', () => {
    // b oznaczony „paid" wciąż ma udział — rozliczenie robi rejestr wpłat, nie flaga na rachunku
    const b = simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'paid'], ['c', 'unpaid']]);
    const debts = computeBillDebts(b).map(debtKey).sort();
    expect(debts).toEqual(['b->a:3334', 'c->a:3334']);
  });

  it('not_applicable wykluczony (i nie zmienia liczby aktywnych po zapłacie)', () => {
    // a płaci, c nie dotyczy → aktywni a,b → 90/2 = 45 każdy; b winien 45
    const b = simple(90, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid'], ['c', 'not_applicable']]);
    const debts = computeBillDebts(b).map(debtKey).sort();
    expect(debts).toEqual(['b->a:4500']);
  });

  it('płatnik nigdy nie jest sam sobie winien', () => {
    const b = simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]);
    const debts = computeBillDebts(b);
    expect(debts.every((d) => d.from !== d.to)).toBe(true);
    expect(debts.every((d) => d.from !== 'a')).toBe(true);
  });

  it('rachunek zaawansowany — udziały indywidualne', () => {
    // a płaci 60; a=40, b=20; b winien a 20
    const b = adv(60, 'PLN', 'a', true, [['a', 40], ['b', 20]]);
    const debts = computeBillDebts(b).map(debtKey);
    expect(debts).toEqual(['b->a:2000']);
  });
});

describe('buildLedger — agregacja i netowanie', () => {
  it('netuje przeciwne kierunki (b→a 30, a→b 10 ⇒ b→a 20)', () => {
    const bills = [
      simple(60, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), // b winien a 30,00
      simple(20, 'PLN', 'b', true, [['a', 'unpaid'], ['b', 'unpaid']]), // a winien b 10,00
    ];
    const ledger = buildLedger(bills);
    expect(ledger.PLN.net).toEqual([{ from: 'b', to: 'a', amountG: 2000 }]);
  });

  it('pełne wzajemne wyrównanie → brak długu netto', () => {
    const bills = [
      simple(20, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), // b winien a 10
      simple(20, 'PLN', 'b', true, [['a', 'unpaid'], ['b', 'unpaid']]), // a winien b 10
    ];
    const ledger = buildLedger(bills);
    expect(ledger.PLN.net).toEqual([]);
  });

  it('rozdziela waluty (PLN i EUR osobno)', () => {
    const bills = [
      simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]),
      simple(50, 'EUR', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]),
    ];
    const ledger = buildLedger(bills);
    expect(ledger.PLN.net).toEqual([{ from: 'b', to: 'a', amountG: 5000 }]);
    expect(ledger.EUR.net).toEqual([{ from: 'b', to: 'a', amountG: 2500 }]);
  });

  it('detal (contributions) zachowuje wkład każdego rachunku', () => {
    const bills = [
      { ...simple(60, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), id: 'r1', billName: 'Obiad' },
      { ...simple(40, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), id: 'r2', billName: 'Kino' },
    ];
    const ledger = buildLedger(bills);
    const directed = ledger.PLN.directed;
    expect(directed).toHaveLength(1); // jedna para b→a
    expect(directed[0].amountG).toBe(5000); // 30 + 20
    expect(directed[0].contributions).toEqual([
      { kind: 'bill', billId: 'r1', label: 'Obiad', amountG: 3000 },
      { kind: 'bill', billId: 'r2', label: 'Kino', amountG: 2000 },
    ]);
  });
});

describe('buildLedger — MODEL WPŁAT (rejestr spłat redukuje długi)', () => {
  const pay = (from, to, amount, currency = 'PLN') => ({ from, to, amount, currency });

  it('wpłata redukuje dług (b winien a 50, wpłata b→a 20 ⇒ b→a 30)', () => {
    const bills = [simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']])];
    const ledger = buildLedger(bills, [pay('b', 'a', 20)]);
    expect(ledger.PLN.net).toEqual([{ from: 'b', to: 'a', amountG: 3000 }]);
  });

  it('pełna wpłata → dług znika', () => {
    const bills = [simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']])];
    const ledger = buildLedger(bills, [pay('b', 'a', 50)]);
    expect(ledger.PLN.net).toEqual([]);
  });

  it('nadpłata → dług odwraca się (b nadpłacił a o 20)', () => {
    const bills = [simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']])];
    const ledger = buildLedger(bills, [pay('b', 'a', 70)]);
    expect(ledger.PLN.net).toEqual([{ from: 'a', to: 'b', amountG: 2000 }]);
  });

  it('wpłaty osobno per waluta', () => {
    const bills = [
      simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), // b→a 50 PLN
      simple(100, 'EUR', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), // b→a 50 EUR
    ];
    const ledger = buildLedger(bills, [pay('b', 'a', 50, 'PLN')]); // spłaca tylko PLN
    expect(ledger.PLN.net).toEqual([]);
    expect(ledger.EUR.net).toEqual([{ from: 'b', to: 'a', amountG: 5000 }]);
  });

  it('detal: wpłata jako kind „payment" (offset przeciwnej krawędzi)', () => {
    const bills = [{ ...simple(100, 'PLN', 'a', true, [['a', 'unpaid'], ['b', 'unpaid']]), id: 'r1', billName: 'Obiad' }];
    const ledger = buildLedger(bills, [pay('b', 'a', 20)]);
    const dir = ledger.PLN.directed;
    const billEdge = dir.find(e => e.from === 'b' && e.to === 'a');
    const payEdge = dir.find(e => e.from === 'a' && e.to === 'b');
    expect(billEdge.contributions).toEqual([{ kind: 'bill', billId: 'r1', label: 'Obiad', amountG: 5000 }]);
    expect(payEdge.contributions[0].kind).toBe('payment');
    expect(payEdge.contributions[0].amountG).toBe(2000);
  });

  it('wpłata bez pokrycia w rachunkach też liczy się do salda', () => {
    const ledger = buildLedger([], [pay('b', 'a', 30)]);
    // b zapłacił a 30 bez rachunku → a jest teraz winien b 30
    expect(ledger.PLN.net).toEqual([{ from: 'a', to: 'b', amountG: 3000 }]);
  });
});

describe('simplifyDebts — minimalizacja przelewów', () => {
  it('łańcuch a→b→c upraszcza do a→c', () => {
    const debts = [
      { from: 'a', to: 'b', amountG: 1000 },
      { from: 'b', to: 'c', amountG: 1000 },
    ];
    expect(simplifyDebts(debts)).toEqual([{ from: 'a', to: 'c', amountG: 1000 }]);
  });

  it('brak długów → brak przelewów', () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it('pojedynczy dług przechodzi bez zmian', () => {
    expect(simplifyDebts([{ from: 'a', to: 'b', amountG: 700 }]))
      .toEqual([{ from: 'a', to: 'b', amountG: 700 }]);
  });

  it('nie tworzy przelewów do samego siebie i tylko dodatnie kwoty', () => {
    const debts = [
      { from: 'a', to: 'b', amountG: 500 },
      { from: 'c', to: 'a', amountG: 500 },
      { from: 'b', to: 'c', amountG: 500 },
    ];
    const tr = simplifyDebts(debts);
    expect(tr.every((t) => t.from !== t.to)).toBe(true);
    expect(tr.every((t) => t.amountG > 0)).toBe(true);
  });
});

// --- helper: salda per osoba z listy długów kierunkowych ---
const balancesOf = (debts) => {
  const bal = {};
  debts.forEach((d) => {
    bal[d.from] = (bal[d.from] || 0) - d.amountG;
    bal[d.to] = (bal[d.to] || 0) + d.amountG;
  });
  return bal;
};

describe('simplifyDebts — niezmienniki (losowe)', () => {
  // deterministyczny PRNG (LCG) — powtarzalne przy błędzie
  let seed = 123456789;
  const rand = () => {
    seed = (1103515245 * seed + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  it('300 losowych układów: salda zachowane, przelewy ≤ n-1, kwoty dodatnie', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let iter = 0; iter < 300; iter++) {
      const numBills = 1 + Math.floor(rand() * 6);
      const bills = [];
      for (let k = 0; k < numBills; k++) {
        const n = 2 + Math.floor(rand() * (people.length - 1));
        const members = [...people].sort(() => rand() - 0.5).slice(0, n);
        const payer = pick(members);
        const statuses = members.map((id) => [id, pick(['unpaid', 'unpaid', 'unpaid', 'paid'])]);
        const amount = 1 + Math.floor(rand() * 50000) / 100; // 0,01–500 zł
        bills.push(simple(amount, 'PLN', payer, true, statuses));
      }
      // losowe wpłaty (rejestr spłat) — mogą przekraczać dług (nadpłaty) i nie mieć pokrycia
      const settlements = [];
      const numPays = Math.floor(rand() * 4);
      for (let k = 0; k < numPays; k++) {
        const from = pick(people); let to = pick(people);
        if (from === to) continue;
        settlements.push({ from, to, amount: 1 + Math.floor(rand() * 30000) / 100, currency: 'PLN' });
      }
      const ledger = buildLedger(bills, settlements);
      const cur = ledger.PLN;
      if (!cur) continue;

      // salda z net == salda z directed (netowanie nie zmienia sald)
      const balDirected = balancesOf(cur.directed);
      const balNet = balancesOf(cur.net);
      const ids = new Set([...Object.keys(balDirected), ...Object.keys(balNet)]);
      for (const id of ids) {
        expect(balNet[id] || 0).toBe(balDirected[id] || 0);
      }

      // konserwacja: suma sald == 0
      const sum = Object.values(balDirected).reduce((s, v) => s + v, 0);
      expect(sum).toBe(0);

      // uproszczenie odtwarza DOKŁADNIE te same salda
      const transfers = simplifyDebts(cur.directed);
      const balTransfers = balancesOf(transfers);
      for (const id of ids) {
        expect(balTransfers[id] || 0).toBe(balDirected[id] || 0);
      }

      // przelewy: dodatnie kwoty całkowite, brak self, ≤ (liczba niezerowych sald - 1)
      const nonzero = Object.values(balDirected).filter((v) => v !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonzero - 1));
      expect(transfers.every((t) => t.from !== t.to && Number.isInteger(t.amountG) && t.amountG > 0)).toBe(true);
    }
  });
});
