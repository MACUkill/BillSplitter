// Normalizacja odpowiedzi modelu AI czytającego paragon.
//
// DLACZEGO to osobny, czysty moduł: model potrafi zwrócić śmieci — ujemną cenę, „12,50 zł"
// zamiast liczby, ilość 0, nazwę pustą, sto zmyślonych pozycji. Kwoty w tej aplikacji muszą
// być godne zaufania, więc wszystko z zewnątrz przechodzi przez jedno, przetestowane sito,
// zanim dotknie rachunku. Nic tu nie sięga do sieci ani do DOM — dzięki temu da się to
// w całości przetestować.
import { toGrosze, fromGrosze } from './calc.js';

// Zapory przed absurdami (halucynacja / uszkodzone zdjęcie).
const MAX_ITEMS = 100;
const MAX_AMOUNT = 1_000_000;

// Liczba z modelu bywa stringiem w polskim formacie: „1 234,50", „12,50 zł", „−5".
// Zwraca liczbę albo null, gdy nie da się jej uczciwie odczytać.
export const parseNumberLoose = (val) => {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val !== 'string') return null;

  let s = val.trim()
    .replace(/[  \s]/g, '')      // spacje (też twarde) jako separator tysięcy
    .replace(/[−–—]/g, '-')                 // różne myślniki na zwykły minus
    .replace(/[^0-9.,-]/g, '');             // waluty, litery, symbole precz
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Oba znaki: ten dalej z tyłu jest separatorem dziesiętnym, drugi to tysiące.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Kwota pieniężna: dodatnia, w rozsądnym zakresie, zaokrąglona do grosza.
const parseMoney = (val) => {
  const n = parseNumberLoose(val);
  if (n === null || n <= 0 || n > MAX_AMOUNT) return null;
  return fromGrosze(toGrosze(n)); // przez grosze — koniec z 0.1+0.2
};

const parseQuantity = (val) => {
  const n = parseNumberLoose(val);
  if (n === null) return 1;
  const q = Math.trunc(n);
  return q >= 1 && q <= 1000 ? q : 1;
};

const cleanName = (val) => {
  if (typeof val !== 'string') return '';
  return val.replace(/\s+/g, ' ').trim().slice(0, 120);
};

// Typ modyfikatora → jak wpływa na rachunek. Rabat zmniejsza, reszta zwiększa.
const MODIFIER_KINDS = {
  tip:      { label: 'Napiwek',  sign: 1 },
  service:  { label: 'Serwis',   sign: 1 },
  tax:      { label: 'Podatek',  sign: 1 },
  discount: { label: 'Rabat',    sign: -1 },
};

export const normalizeReceipt = (raw) => {
  const src = (raw && typeof raw === 'object') ? raw : {};

  const items = (Array.isArray(src.items) ? src.items : [])
    .slice(0, MAX_ITEMS)
    .map((it) => {
      if (!it || typeof it !== 'object') return null;
      const description = cleanName(it.name ?? it.description);
      const amount = parseMoney(it.totalPrice ?? it.amount ?? it.price);
      // Bez nazwy albo bez sensownej ceny pozycja jest bezużyteczna — odrzucamy,
      // zamiast wstawiać zero i udawać, że coś odczytaliśmy.
      if (!description || amount === null) return null;
      const original = cleanName(it.nameOriginal);
      return {
        description: original && original !== description ? `${description} (${original})` : description,
        quantity: parseQuantity(it.quantity),
        amount,
      };
    })
    .filter(Boolean);

  const modifiers = (Array.isArray(src.modifiers) ? src.modifiers : [])
    .slice(0, 20)
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const kind = MODIFIER_KINDS[String(m.kind || '').toLowerCase()];
      if (!kind) return null;
      const isPercent = m.isPercent === true || String(m.type).toLowerCase() === 'percent';
      const rawValue = parseNumberLoose(m.value);
      if (rawValue === null || rawValue === 0) return null;
      const magnitude = Math.abs(rawValue);
      if (isPercent && magnitude > 100) return null;
      if (!isPercent && magnitude > MAX_AMOUNT) return null;
      return {
        description: cleanName(m.name) || kind.label,
        type: isPercent ? 'percent' : 'amount',
        value: (isPercent ? magnitude : fromGrosze(toGrosze(magnitude))) * kind.sign,
      };
    })
    .filter(Boolean);

  const receiptTotal = parseMoney(src.receiptTotal ?? src.total);
  const currency = typeof src.currency === 'string' && /^[A-Za-z]{3}$/.test(src.currency.trim())
    ? src.currency.trim().toUpperCase()
    : null;

  return {
    items,
    modifiers,
    currency,
    receiptTotal,
    itemsTotal: fromGrosze(items.reduce((s, i) => s + toGrosze(i.amount), 0)),
  };
};

// Odczytane pozycje → kafelki. `sharedBy` celowo puste: nikt jeszcze nie zadeklarował,
// co jadł, więc kafelek pokaże „nikt nie wybrał" i każdy dopisze się sam.
export const receiptItemsToSharedCosts = (items, makeId) =>
  (items || []).map((it, i) => ({
    id: makeId ? makeId() : `ai-${Date.now()}-${i}`,
    description: it.description,
    amount: it.amount,
    quantity: it.quantity,
    sharedBy: [],
  }));

export const receiptModifiersToGlobalCosts = (modifiers, makeId) =>
  (modifiers || []).map((m, i) => ({
    id: makeId ? makeId() : `aim-${Date.now()}-${i}`,
    description: m.description,
    type: m.type,
    value: m.value,
  }));
