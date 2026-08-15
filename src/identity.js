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

// PALETA TOŻSAMOŚCI — przebudowana 2026-08-15.
//
// Poprzedni zestaw miał szesnaście pozycji, ale realnie PIĘĆ rodzin: cztery fiolety,
// trzy błękity, trzy morskie, trzy maliny, trzy pomarańcze. Policzone: piętnaście par
// różniło się mniej niż o dwadzieścia stopni odcienia przy niemal równej jasności,
// czyli dla oka były tym samym kolorem („malina" i „wiśnia" dzieliły DWA stopnie).
// Do tego sześć kolorów siedziało na barwach ról pieniężnych — „lazur" siedem stopni
// od błękitu „czeka na Ciebie", „malina" siedem od czerwieni długu — czyli paleta
// łamała regułę rozdziału kolorów, którą sama miała chronić.
//
// Przyczyną było jedno założenie: WSZYSTKIE kolory musiały być ciemne, bo litera na
// awatarze była zawsze biała. To spychało szesnaście barw w jedno wąskie pasmo jasności,
// gdzie różnicował je wyłącznie odcień, a odcień się zbijał.
//
// Założenie znikło: litera dobiera teraz kolor sama (`readableInk`). Dzięki temu paleta
// idzie po CAŁYM kole barw i różnicuje się także jasnością — parzyste pozycje są ciemne
// i nasycone, nieparzyste jasne i łagodniejsze. Wygenerowane co 22,5 stopnia z omijaniem
// sąsiedztw limonki marki i trzech ról pieniężnych. Wynik: zero par nie do odróżnienia
// i zero kolizji ze znaczeniami.
export const IDENTITY_COLORS = [
  '#AC2F16', // ceglany
  '#D6984C', // miodowy
  '#AC9F16', // oliwka
  '#88D64C', // limonka leśna
  '#48AC16', // trawiasty
  '#4CD653', // mięta
  '#16AC4B', // szmaragd
  '#4CD6BB', // turkus
  '#1693AC', // lazur
  '#4C8AD6', // błękit
  '#3216AC', // granat
  '#764CD6', // fiolet
  '#7A16AC', // ametyst
  '#D64CD0', // orchidea
  '#AC166D', // malina
  '#D64C8D', // koral
];

// --- BARWY, KTÓRE ZNACZĄ COŚ INNEGO -----------------------------------------
// Kolor człowieka nie może udawać limonki marki („naciśnij to", „to jest twoje")
// ani żadnej z trzech ról pieniężnych. Nie wycinamy jednak CAŁYCH pasm odcienia,
// bo to zabrałoby cały żółty i cały zielony: blokujemy dopiero wtedy, gdy kolor jest
// podobny na wszystkich trzech wymiarach naraz. Ciemna oliwka przechodzi, jasna
// limonka nie.
export const RESERVED_COLORS = [
  '#C6F03A', // limonka marki
  '#E21E38', // czerwień długu
  '#008A5C', // zieleń należności
  '#2D4AEB', // błękit stanu
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const hexToHsl = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const hslToHex = (h, s, l) => {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const hue = ((h % 360) + 360) % 360;
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
};

// --- LITERA NA AWATARZE DOBIERA SIĘ SAMA -------------------------------------
// To jedna funkcja, ale bez niej nie ma swobodnego wyboru koloru: biała litera na
// żółtym jest nieczytelna, a ciemna na granatowym też. Liczymy luminancję względną
// (ta sama, na której stoi próg kontrastu 4,5:1) i wybieramy z DWÓCH barw systemu:
// atramentu albo bieli. Żadnej trzeciej — litera nie jest miejscem na kolor.
const CHANNEL = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * CHANNEL(rgb.r) + 0.7152 * CHANNEL(rgb.g) + 0.0722 * CHANNEL(rgb.b);
};

export const contrastRatio = (a, b) => {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

export const INK = '#0E0F13';
export const PAPER = '#FFFFFF';

export const readableInk = (hex) =>
  (contrastRatio(hex, INK) >= contrastRatio(hex, PAPER) ? INK : PAPER);

// --- KOLOR SPOZA ZBIORU: CZY WOLNO GO UŻYĆ -----------------------------------
const hueDistance = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
};

export const isReservedColor = (hex) => {
  const c = hexToHsl(hex);
  if (!c) return false;
  return RESERVED_COLORS.some((role) => {
    const r = hexToHsl(role);
    return hueDistance(c.h, r.h) < 18
      && Math.abs(c.l - r.l) < 18
      && Math.abs(c.s - r.s) < 32;
  });
};

// --- DWA SUWAKI: ODCIEŃ I INTENSYWNOŚĆ ---------------------------------------
// Intensywność jest JEDNĄ liczbą, a steruje dwiema: nasyceniem i jasnością naraz.
// Osobne suwaki na nasycenie i jasność dałyby więcej kolorów, ale też całe obszary
// nieczytelnego błota (wysoka jasność przy niskim nasyceniu to prawie biel).
// Ta krzywa prowadzi od barwy jasnej i łagodnej do ciemnej i nasyconej, i każdy
// punkt na niej jest kolorem, który da się zobaczyć na kole o średnicy 28 pikseli.
// PASMO NIECZYTELNE. Pośrodku suwaka jest wąski zakres jasności, w którym ANI biała,
// ani ciemna litera nie łapie progu 4,5:1 — dla nasyconej czerwieni wychodziło 4,45.
// Nie da się tego wyprostować jedną stałą, bo miejsce tego pasma zależy od odcienia
// (żółty jest jasny nawet przy niskiej jasności, granat ciemny nawet przy wysokiej).
// Dlatego liczymy kolor, sprawdzamy kontrast i jeśli wypada poniżej progu, odsuwamy
// jasność w stronę BLIŻSZEGO brzegu pasma. Suwak nadal jest płynny; ten jeden zakres
// przeskakuje o kilka punktów i nie widać tego pod palcem.
//
// Test `identity.test.js` przechodzi przez wszystkie odcienie co pięć stopni i wszystkie
// intensywności co dziesięć, więc dziura nie ma jak wrócić niezauważona.
const MIN_CONTRAST = 4.5;

const legibleLightness = (hue, s, l) => {
  const ok = (x) => {
    const hex = hslToHex(hue, s, x);
    return Math.max(contrastRatio(hex, INK), contrastRatio(hex, PAPER)) >= MIN_CONTRAST;
  };
  if (ok(l)) return l;
  for (let step = 1; step <= 40; step++) {
    // Najpierw w dół (ciemniej, biała litera), potem w górę (jaśniej, ciemna litera).
    if (l - step >= 0 && ok(l - step)) return l - step;
    if (l + step <= 100 && ok(l + step)) return l + step;
  }
  return l;
};

export const colorFromControls = (hue, intensity) => {
  const t = clamp(Number(intensity) || 0, 0, 100) / 100;
  const h = Math.round(Number(hue) || 0);
  const s = Math.round(45 + t * 45);
  const l = Math.round(80 - t * 58);
  return hslToHex(h, s, legibleLightness(h, s, l));
};

export const controlsFromColor = (hex) => {
  const c = hexToHsl(hex);
  if (!c) return { hue: 258, intensity: 40 };
  return { hue: c.h, intensity: Math.round(clamp((80 - c.l) / 58, 0, 1) * 100) };
};

// Najbliższy odcień, który NIE należy do barw znaczeniowych. Szukamy w obie strony,
// żeby suwak przeskakiwał zakazaną strefę w tę stronę, w którą palec i tak zmierzał.
export const nearestAllowedHue = (hue, intensity) => {
  const start = ((Math.round(Number(hue) || 0) % 360) + 360) % 360;
  if (!isReservedColor(colorFromControls(start, intensity))) return start;
  for (let step = 1; step <= 60; step++) {
    for (const dir of [1, -1]) {
      const h = ((start + dir * step) % 360 + 360) % 360;
      if (!isReservedColor(colorFromControls(h, intensity))) return h;
    }
  }
  return start;
};

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
