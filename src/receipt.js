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

// --- PODATEK: dwa różne zwierzęta pod jedną nazwą ---
//
// Na polskim paragonie linie „PTU A", „SP.OP.PTU B", „w tym VAT" to rozbicie podatku JUŻ
// WLICZONEGO w ceny pozycji — informacja, nie opłata. Na paragonie z USA „Sales Tax" to
// realna kwota doliczana do sumy. Model myli te przypadki, a najgorszy zaobserwowany błąd
// polegał na wrzuceniu PTU jako NAPIWKU, żeby suma się spięła — czyli na dopasowaniu danych
// do arytmetyki. Stąd dwa zabezpieczenia poniżej, niezależne od tego, co model zadeklaruje.

// Cokolwiek, co pachnie podatkiem → traktujemy jak podatek, choćby model nazwał to napiwkiem.
const TAX_NAME_RE = /(\bptu\b|\bvat\b|\bmwst\b|\bbtw\b|\biva\b|\btva\b|\bgst\b|\bhst\b|\bpst\b|podatek|\btax\b|\btaxe\b)/i;

// Znaczniki podatku WLICZONEGO w ceny. Świadomie węższe niż wzorzec wyżej: „Podatek" czy
// „Tax" bez dopowiedzenia jest dwuznaczny, więc sam z siebie nie wystarcza do odrzucenia.
const INCLUDED_TAX_RE = /(\bptu\b|\bvat\b|\bmwst\b|\bbtw\b|\biva\b|\btva\b|w tym)/i;

// Linia podsumowania VAT wzięta przez model za danie. Wzorce zakotwiczone, żeby nie zjeść
// pozycji, która ma słowo „vat" gdzieś w środku nazwy.
const TAX_LINE_AS_ITEM_RE = /^(sp\.?\s*op\.?\s*)?ptu\b|^suma\s+ptu\b|^w\s+tym\s+vat\b|^vat\b/i;

const TOLERANCE_G = 2; // grosze — luz na zaokrąglenia przy porównywaniu z sumą paragonu

const modifierGrosze = (m, itemsG) =>
  m.type === 'percent' ? Math.round(itemsG * m.value / 100) : toGrosze(m.value);

// Zwraca true, gdy podatek należy DOLICZYĆ (przypadek amerykański), false gdy jest już
// wliczony w ceny (przypadek polski). Rozstrzyga arytmetyka, bo tylko ona jest niezależna
// od nazewnictwa i od języka paragonu.
const shouldKeepTaxes = (taxes, others, itemsG, receiptTotalG) => {
  if (!receiptTotalG) {
    // Bez sumy paragonu nie ma czym rozstrzygnąć. Odrzucamy tylko to, co nazwą samo się
    // przyznaje do bycia podatkiem wliczonym.
    return null; // decyzja per modyfikator, patrz niżej
  }
  const othersG = others.reduce((s, m) => s + modifierGrosze(m, itemsG), 0);
  const taxesG = taxes.reduce((s, m) => s + modifierGrosze(m, itemsG), 0);
  const diffWithout = Math.abs(itemsG + othersG - receiptTotalG);
  const diffWith = Math.abs(itemsG + othersG + taxesG - receiptTotalG);

  // Dowodem jest DOMKNIĘCIE sumy, nie samo zmniejszenie różnicy. Gdy pozycja została
  // przeoczona, dorzucenie podatku też zbliża wynik do sumy — i tą drogą zawyżylibyśmy
  // rachunek, zgadując. Rozstrzygamy tylko wtedy, gdy któryś wariant faktycznie się spina.
  if (diffWith <= TOLERANCE_G && diffWith < diffWithout) return true;  // doliczany (USA)
  if (diffWithout <= TOLERANCE_G) return false;                        // wliczony (Polska)
  return null;                                                         // rozjazd → decyduje nazwa
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
      // Rozbicie VAT wzięte za danie — nie jest niczym, co ktokolwiek zjadł.
      if (TAX_LINE_AS_ITEM_RE.test(description)) return null;
      const original = cleanName(it.nameOriginal);
      return {
        description: original && original !== description ? `${description} (${original})` : description,
        quantity: parseQuantity(it.quantity),
        amount,
      };
    })
    .filter(Boolean);

  const parsedModifiers = (Array.isArray(src.modifiers) ? src.modifiers : [])
    .slice(0, 20)
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const name = cleanName(m.name);
      // O rodzaju decyduje nazwa, nie deklaracja modelu: „PTU A" zgłoszone jako `tip`
      // to wciąż podatek i nie wolno go doliczyć jako napiwek.
      const declared = String(m.kind || '').toLowerCase();
      const kindKey = TAX_NAME_RE.test(name) ? 'tax' : declared;
      const kind = MODIFIER_KINDS[kindKey];
      if (!kind) return null;
      const isPercent = m.isPercent === true || String(m.type).toLowerCase() === 'percent';
      const rawValue = parseNumberLoose(m.value);
      if (rawValue === null || rawValue === 0) return null;
      const magnitude = Math.abs(rawValue);
      if (isPercent && magnitude > 100) return null;
      if (!isPercent && magnitude > MAX_AMOUNT) return null;
      return {
        description: name || kind.label,
        type: isPercent ? 'percent' : 'amount',
        value: (isPercent ? magnitude : fromGrosze(toGrosze(magnitude))) * kind.sign,
        __tax: kindKey === 'tax',
      };
    })
    .filter(Boolean);

  const receiptTotal = parseMoney(src.receiptTotal ?? src.total);

  const itemsG = items.reduce((s, i) => s + toGrosze(i.amount), 0);
  const taxes = parsedModifiers.filter((m) => m.__tax);
  const others = parsedModifiers.filter((m) => !m.__tax);
  const keepTaxes = taxes.length === 0
    ? true
    : shouldKeepTaxes(taxes, others, itemsG, receiptTotal ? toGrosze(receiptTotal) : 0);

  const modifiers = parsedModifiers
    .filter((m) => {
      if (!m.__tax) return true;
      // Suma paragonu rozstrzygnęła — trzymamy się jej.
      if (keepTaxes !== null) return keepTaxes;
      // Bez sumy zostaje sama nazwa: „PTU"/„VAT" znaczy podatek wliczony, więc precz.
      return !INCLUDED_TAX_RE.test(m.description);
    })
    .map(({ __tax, ...m }) => m);
  const currency = typeof src.currency === 'string' && /^[A-Za-z]{3}$/.test(src.currency.trim())
    ? src.currency.trim().toUpperCase()
    : null;

  return {
    items,
    modifiers,
    currency,
    receiptTotal,
    itemsTotal: fromGrosze(itemsG),
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
