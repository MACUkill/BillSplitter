// Tożsamość uczestnika w interfejsie: kolor i litera.
//
// DLACZEGO to istnieje: w grupie potrafi być dwadzieścia pięć osób, a awatar w wierszu
// pozycji ma dwadzieścia osiem pikseli. Kolor musi rozróżniać na pierwszy rzut oka,
// zdjęcie ma pierwszeństwo, a litera jest ostatnią linią obrony, gdy zdjęcia nie ma.
//
// Kolor osoby jest LICZONY z identyfikatora, nie wybierany z listy: nie da się go
// wyczerpać przy dużej grupie, a ta sama osoba ma zawsze ten sam kolor na każdym
// urządzeniu. Wybór ręczny w profilu tylko nadpisuje wynik.

// FNV-1a — mały, szybki, deterministyczny. Nie ma tu nic do ukrycia, chodzi wyłącznie
// o powtarzalne rozrzucenie identyfikatorów po palecie.
export const hashSeed = (str) => {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

// Paleta tożsamości: kolory NASYCONE, każdy na tyle ciemny, żeby biała litera trzymała
// na nim kontrast co najmniej 4,5:1. Celowo rozłączna z rolami pieniężnymi (winien /
// dostajesz / informacja) i z limonką marki — kolor człowieka nie może znaczyć
// „zapłacone" ani „naciśnij to", bo wtedy interfejs kłamie kolorem.
export const IDENTITY_COLORS = [
  '#6D28D9', // fiolet
  '#2563EB', // kobalt
  '#0E7490', // morski
  '#B91C6B', // fuksja
  '#C2410C', // pomarańcz palony
  '#7C3AED', // ametyst
  '#0F766E', // szmaragd głęboki
  '#BE123C', // malina
  '#4338CA', // indygo
  '#A16207', // musztarda ciemna
  '#9333EA', // orchidea
  '#1D4ED8', // lazur
  '#B45309', // bursztyn ciemny
  '#86198F', // śliwka
  '#155E75', // stalowy błękit
  '#9F1239', // wiśnia
];

export const identityColor = (id, name) =>
  IDENTITY_COLORS[hashSeed(id || name || '?') % IDENTITY_COLORS.length];

// Rozkład na składowe RGB — potrzebny tam, gdzie kolor wchodzi do `rgb(... / alfa)`
// jako delikatne wypełnienie bloku, a nie jako pełne krycie.
export const identityRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '109 40 217';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

// Pierwsza litera imienia. Dwie litery przy dwuczłonowym imieniu („Anna Maria" → „AM”)
// rozróżniają lepiej niż jedna przy dużej grupie, ale nie zamieniają awatara w tekst.
export const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
};
