// Rozbicie sumy kontrolnej na składniki.
//
// Powód istnienia: zgłoszenie z 2026-08-25 — rachunek na 183 EUR pokazywał sumę pozycji
// 210,50 z komunikatem „ktoś przeliczył albo pozycja jest podwójna". Komunikat ZGADYWAŁ
// przyczynę i pomijał trzeci składnik sumy (koszty ogólne), więc przy doliczonym serwisie
// kierował na fałszywy trop. Ekran ma pokazać DZIAŁANIE, a do tego potrzebuje składników.
import { describe, it, expect } from 'vitest';
import { calculateAll } from './calc.js';

const bill = (over) => ({
  totalAmount: 183,
  currency: 'EUR',
  participants: {
    a: { id: 'a', name: 'Ala' },
    b: { id: 'b', name: 'Bartek' },
  },
  sharedCosts: [
    { id: 'i1', description: 'Pizza', amount: 155.5, sharedBy: ['a'] },
    { id: 'i2', description: 'Woda', amount: 27.5, sharedBy: ['b'] },
  ],
  ...over,
});

describe('calculateAll — rozbicie sumy kontrolnej', () => {
  it('podaje pozycje, koszty własne i koszty ogólne osobno', () => {
    const r = calculateAll(bill({
      globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 27.5 }],
      participants: {
        a: { id: 'a', name: 'Ala', individualAmount: 10 },
        b: { id: 'b', name: 'Bartek' },
      },
    }));
    expect(r.entered.shared).toBeCloseTo(183, 2);
    expect(r.entered.individual).toBeCloseTo(10, 2);
    expect(r.entered.global).toBeCloseTo(27.5, 2);
  });

  it('składniki sumują się do kwoty, którą kontrola porównuje z rachunkiem', () => {
    const r = calculateAll(bill({
      globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 27.5 }],
    }));
    const suma = r.entered.shared + r.entered.individual + r.entered.global;
    expect(suma).toBeCloseTo(r.control.enteredSubtotal, 2);
  });

  // ODTWORZENIE ZGŁOSZONEGO PRZYPADKU w wersji „koszt ogólny", czyli tej, na którą
  // stary komunikat nie miał ani słowa.
  it('koszt ogólny doliczony po wpisaniu kwoty rachunku daje status „over"', () => {
    const r = calculateAll(bill({
      globalCosts: [{ id: 'g1', description: 'Opłata za nakrycie', type: 'amount', value: 27.5 }],
    }));
    expect(r.control.status).toBe('over');
    expect(r.control.diff).toBeCloseTo(27.5, 2);
    expect(r.control.enteredSubtotal).toBeCloseTo(210.5, 2);
    expect(r.control.expectedTotal).toBeCloseTo(183, 2);
    // To jest liczba, którą podpowiada przycisk „Ustaw kwotę rachunku na…".
    expect(r.entered.global).toBeCloseTo(27.5, 2);
  });

  it('a duplikat pozycji daje ten sam status przy zerowych kosztach ogólnych', () => {
    const r = calculateAll({
      ...bill({}),
      sharedCosts: [
        { id: 'i1', description: 'Pizza', amount: 155.5, sharedBy: ['a'] },
        { id: 'i2', description: 'Nakrycie', amount: 27.5, sharedBy: ['b'] },
        { id: 'i3', description: 'Nakrycie', amount: 27.5, sharedBy: ['b'] },
      ],
    });
    expect(r.control.status).toBe('over');
    expect(r.entered.global).toBe(0);
    expect(r.entered.shared).toBeCloseTo(210.5, 2);
  });

  it('koszt procentowy też trafia do składnika „global"', () => {
    const r = calculateAll(bill({
      globalCosts: [{ id: 'g1', description: 'Napiwek', type: 'percent', value: 10 }],
    }));
    expect(r.entered.global).toBeCloseTo(18.3, 2);
  });

  it('rachunek bez dodatków ma zerowe składniki poboczne', () => {
    const r = calculateAll(bill({}));
    expect(r.entered.individual).toBe(0);
    expect(r.entered.global).toBe(0);
    expect(r.control.status).toBe('ok');
  });
});
