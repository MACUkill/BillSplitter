import { describe, it, expect } from 'vitest';
import { aggregateGroupSummary } from './calc.js';

// Podsumowania grupy liczone OD ZERA (zastępują delty przyrostowe z Cloud Function).

const simple = (totalAmount, currency, statuses) => ({
  type: 'simple',
  totalAmount,
  currency,
  participants: Object.fromEntries(statuses.map(([pid, st]) => [pid, { id: pid, status: st }])),
});

const adv = (totalAmount, currency, people) => ({
  type: 'advanced',
  totalAmount,
  currency,
  participants: Object.fromEntries(
    people.map(([pid, ind, st]) => [pid, { id: pid, status: st || 'unpaid', individualAmount: ind }]),
  ),
  sharedCosts: [],
  globalCosts: [],
});

describe('aggregateGroupSummary — podsumowania od zera', () => {
  it('sumuje udziały użytkownika i całość grupy', () => {
    const bills = [
      simple(100, 'PLN', [['a', 'unpaid'], ['b', 'unpaid']]), // po 50
      adv(60, 'PLN', [['a', 40], ['b', 20]]),                 // a 40, b 20
    ];
    const { userGrossSpend, groupGrossSpend } = aggregateGroupSummary(bills);
    expect(userGrossSpend.a.PLN).toBeCloseTo(90, 2);
    expect(userGrossSpend.b.PLN).toBeCloseTo(70, 2);
    expect(groupGrossSpend.PLN).toBeCloseTo(160, 2);
  });

  it('rozdziela waluty', () => {
    const bills = [
      simple(100, 'PLN', [['a', 'unpaid'], ['b', 'unpaid']]),
      simple(50, 'EUR', [['a', 'unpaid'], ['b', 'unpaid']]),
    ];
    const { userGrossSpend, groupGrossSpend } = aggregateGroupSummary(bills);
    expect(userGrossSpend.a.PLN).toBeCloseTo(50, 2);
    expect(userGrossSpend.a.EUR).toBeCloseTo(25, 2);
    expect(groupGrossSpend.PLN).toBeCloseTo(100, 2);
    expect(groupGrossSpend.EUR).toBeCloseTo(50, 2);
  });

  it('uwzględnia zaokrąglanie w górę (100/3), grupa = suma kwot rachunków', () => {
    const bills = [simple(100, 'PLN', [['a', 'unpaid'], ['b', 'unpaid'], ['c', 'unpaid']])];
    const { userGrossSpend, groupGrossSpend } = aggregateGroupSummary(bills);
    expect(userGrossSpend.a.PLN).toBeCloseTo(33.34, 2);
    expect(groupGrossSpend.PLN).toBeCloseTo(100, 2);
  });

  it('not_applicable nie dolicza udziału', () => {
    const bills = [simple(90, 'PLN', [['a', 'unpaid'], ['b', 'unpaid'], ['c', 'not_applicable']])];
    const { userGrossSpend } = aggregateGroupSummary(bills);
    expect(userGrossSpend.a.PLN).toBeCloseTo(45, 2);
    expect(userGrossSpend.c).toBeUndefined();
  });

  it('pusta lista rachunków → puste podsumowania', () => {
    const { userGrossSpend, groupGrossSpend } = aggregateGroupSummary([]);
    expect(userGrossSpend).toEqual({});
    expect(groupGrossSpend).toEqual({});
  });

  it('rachunek bez kwoty nie dolicza do sumy grupy', () => {
    const { groupGrossSpend } = aggregateGroupSummary([adv(0, 'PLN', [['a', 0], ['b', 0]])]);
    expect(groupGrossSpend.PLN).toBeUndefined();
  });
});
