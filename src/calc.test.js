import { describe, it, expect } from 'vitest';
import { calculateAll, calculateAllForBill } from './calc.js';

// Testy Fazy 0 = dokumentują OBECNE (wierne) zachowanie matmy.
// W Fazie 1 dojdą testy alokacji groszy i część z nich świadomie się zmieni.

describe('calc.js — smoke (wierność Fazy 0)', () => {
  it('prosty podział 100 / 2 = po 50', () => {
    const bill = {
      type: 'simple',
      totalAmount: 100,
      participants: {
        a: { id: 'a', status: 'unpaid' },
        b: { id: 'b', status: 'unpaid' },
      },
    };
    const { controlSum, participantTotals } = calculateAllForBill(bill);
    expect(controlSum).toBeCloseTo(100, 6);
    expect(participantTotals.find((p) => p.participant.id === 'a').total).toBeCloseTo(50, 6);
  });

  it('zaawansowany: indywidualne + dzielony + napiwek 10%', () => {
    const bill = {
      type: 'advanced',
      participants: {
        a: { id: 'a', status: 'unpaid', individualAmount: 40 },
        b: { id: 'b', status: 'unpaid', individualAmount: 20 },
      },
      sharedCosts: [{ id: 's1', amount: 10, sharedBy: ['a', 'b'] }],
      globalCosts: [{ id: 'g1', type: 'percent', value: 10 }],
    };
    // subtotal 70; napiwek 7; /2 = 3,5 na osobę.
    // a: 40 + 5 + 3,5 = 48,5 ; b: 20 + 5 + 3,5 = 28,5 ; suma 77.
    const { controlSum, participantTotals } = calculateAll(bill);
    expect(controlSum).toBeCloseTo(77, 6);
    expect(participantTotals.find((p) => p.participant.id === 'a').total).toBeCloseTo(48.5, 6);
    expect(participantTotals.find((p) => p.participant.id === 'b').total).toBeCloseTo(28.5, 6);
  });

  it('not_applicable wyłącza osobę z podziału (90 / 2 aktywnych = 45)', () => {
    const bill = {
      type: 'simple',
      totalAmount: 90,
      participants: {
        a: { id: 'a', status: 'unpaid' },
        b: { id: 'b', status: 'unpaid' },
        c: { id: 'c', status: 'not_applicable' },
      },
    };
    const { participantTotals } = calculateAllForBill(bill);
    expect(participantTotals.find((p) => p.participant.id === 'a').total).toBeCloseTo(45, 6);
    expect(participantTotals.find((p) => p.participant.id === 'c').total).toBe(0);
  });
});
