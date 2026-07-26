// Pozycje rachunku („kafelki paragonu"). Trzymane osobno od matmy pieniędzy (calc.js),
// bo to logika prezentacji i edycji — podziału na osoby dokonuje już `advancedExactSharesGrosze`.
//
// Pozycja = element `bill.sharedCosts[]`:
//   { id, description, amount, sharedBy: [memberId], quantity? }
// `amount` to ŁĄCZNA cena pozycji (tak jak drukuje ją paragon). `quantity` jest informacyjne
// i pozwala rozbić pozycję na sztuki; brak `quantity` znaczy 1.
import { toGrosze, fromGrosze } from './calc.js';

export const itemQuantity = (item) => {
  const q = Math.trunc(Number(item && item.quantity));
  return Number.isFinite(q) && q > 0 ? q : 1;
};

export const itemPickers = (item) => (Array.isArray(item && item.sharedBy) ? item.sharedBy : []);

export const itemPickerCount = (item) => itemPickers(item).length;

export const isPicked = (item, memberId) => !!memberId && itemPickers(item).includes(memberId);

// Pozycje, których nikt nie wybrał. WAŻNE: taka pozycja wypada z podziału (nikt za nią nie płaci),
// więc interfejs musi o niej głośno mówić — inaczej suma kontrolna „nie zgadza się" bez wyjaśnienia.
export const unassignedItems = (bill) =>
  ((bill && bill.sharedCosts) || []).filter((it) => itemPickerCount(it) === 0);

// Dołącz/wypisz osobę z pozycji. Zwraca NOWĄ tablicę pozycji (bez mutacji) — gotową do zapisu.
export const toggleItemPicker = (items, itemId, memberId) =>
  (items || []).map((it) => {
    if (it.id !== itemId || !memberId) return it;
    const pickers = itemPickers(it);
    return {
      ...it,
      sharedBy: pickers.includes(memberId)
        ? pickers.filter((id) => id !== memberId)
        : [...pickers, memberId],
    };
  });

// Rozbija pozycję o ilości n na n pozycji po jednej sztuce — dla przypadku
// „A wziął jedno wino, B i C dzielą drugie".
// Kwotę dzielimy w GROSZACH, a resztę z dzielenia dokładamy do pierwszych sztuk,
// żeby suma rozbicia równała się oryginałowi CO DO GROSZA.
export const splitItemByUnits = (item, makeId) => {
  const n = itemQuantity(item);
  if (n <= 1) return [item];

  const totalG = toGrosze(item.amount || 0);
  const baseG = Math.floor(totalG / n);
  const restG = totalG - baseG * n; // 0..n-1 groszy do rozdania

  return Array.from({ length: n }, (_, i) => ({
    ...item,
    id: i === 0 ? item.id : (makeId ? makeId() : `${item.id}-${i}`),
    description: `${item.description || 'Pozycja'} (${i + 1}/${n})`,
    amount: fromGrosze(baseG + (i < restG ? 1 : 0)),
    quantity: 1,
    sharedBy: [...itemPickers(item)],
  }));
};
