import { describe, it, expect } from 'vitest';
import {
  itemQuantity, itemPickers, itemPickerCount, isPicked,
  unassignedItems, toggleItemPicker, splitItemByUnits,
} from './items.js';
import { toGrosze } from './calc.js';

const item = (over = {}) => ({ id: 'i1', description: 'Wino', amount: 70, sharedBy: [], ...over });

describe('itemQuantity', () => {
  it('brak / złe / niedodatnie → 1', () => {
    expect(itemQuantity(item())).toBe(1);
    expect(itemQuantity(item({ quantity: 0 }))).toBe(1);
    expect(itemQuantity(item({ quantity: -3 }))).toBe(1);
    expect(itemQuantity(item({ quantity: 'abc' }))).toBe(1);
    expect(itemQuantity(null)).toBe(1);
  });

  it('ułamek obcinany do całości', () => {
    expect(itemQuantity(item({ quantity: 2.9 }))).toBe(2);
  });
});

describe('wybierający', () => {
  it('liczy i rozpoznaje wybór', () => {
    const it1 = item({ sharedBy: ['a', 'b'] });
    expect(itemPickerCount(it1)).toBe(2);
    expect(isPicked(it1, 'a')).toBe(true);
    expect(isPicked(it1, 'z')).toBe(false);
    expect(isPicked(it1, null)).toBe(false);
  });

  it('brak sharedBy traktowany jak pusty', () => {
    const bare = { id: 'x', description: 'X', amount: 5 };
    expect(itemPickers(bare)).toEqual([]);
    expect(itemPickerCount(bare)).toBe(0);
  });
});

describe('unassignedItems', () => {
  it('zwraca tylko pozycje bez wybierających', () => {
    const bill = { sharedCosts: [
      item({ id: 'a', sharedBy: ['m1'] }),
      item({ id: 'b', sharedBy: [] }),
      { id: 'c', description: 'Bez pola', amount: 3 },
    ] };
    expect(unassignedItems(bill).map(i => i.id)).toEqual(['b', 'c']);
  });

  it('pusty / brak rachunku → pusto', () => {
    expect(unassignedItems({ sharedCosts: [] })).toEqual([]);
    expect(unassignedItems(null)).toEqual([]);
  });
});

describe('toggleItemPicker', () => {
  const items = [item({ id: 'i1', sharedBy: ['a'] }), item({ id: 'i2', sharedBy: [] })];

  it('dołącza gdy nie ma, wypisuje gdy jest', () => {
    expect(toggleItemPicker(items, 'i1', 'b')[0].sharedBy).toEqual(['a', 'b']);
    expect(toggleItemPicker(items, 'i1', 'a')[0].sharedBy).toEqual([]);
  });

  it('nie rusza pozostałych pozycji ani oryginału (brak mutacji)', () => {
    const out = toggleItemPicker(items, 'i1', 'b');
    expect(out[1]).toBe(items[1]);
    expect(items[0].sharedBy).toEqual(['a']);
  });

  it('bez memberId nic nie zmienia', () => {
    expect(toggleItemPicker(items, 'i1', null)[0].sharedBy).toEqual(['a']);
  });
});

describe('splitItemByUnits', () => {
  it('ilość 1 → bez zmian', () => {
    const one = item({ quantity: 1 });
    expect(splitItemByUnits(one)).toEqual([one]);
  });

  it('dzieli na sztuki i zachowuje wybierających', () => {
    const out = splitItemByUnits(item({ amount: 70, quantity: 2, sharedBy: ['a'] }));
    expect(out).toHaveLength(2);
    expect(out.map(i => i.amount)).toEqual([35, 35]);
    expect(out.every(i => i.quantity === 1)).toBe(true);
    expect(out.every(i => i.sharedBy.includes('a'))).toBe(true);
    expect(out[0].description).toBe('Wino (1/2)');
  });

  it('KLUCZOWE: suma rozbicia = oryginał co do grosza (reszta do pierwszych sztuk)', () => {
    const out = splitItemByUnits(item({ amount: 10, quantity: 3 }));
    const sumG = out.reduce((s, i) => s + toGrosze(i.amount), 0);
    expect(sumG).toBe(toGrosze(10));
    expect(out.map(i => toGrosze(i.amount))).toEqual([334, 333, 333]);
  });

  it('niepodzielne kwoty na wielu sztukach też nie gubią grosza', () => {
    for (const [amount, qty] of [[0.01, 2], [9.99, 4], [100, 7], [33.33, 6]]) {
      const out = splitItemByUnits(item({ amount, quantity: qty }));
      const sumG = out.reduce((s, i) => s + toGrosze(i.amount), 0);
      expect(sumG).toBe(toGrosze(amount));
      expect(out).toHaveLength(qty);
    }
  });

  it('nowe sztuki dostają unikalne id', () => {
    const out = splitItemByUnits(item({ amount: 20, quantity: 3 }));
    expect(new Set(out.map(i => i.id)).size).toBe(3);
    expect(out[0].id).toBe('i1'); // pierwsza zachowuje id oryginału
  });
});
