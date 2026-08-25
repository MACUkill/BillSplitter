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

// --- UZGODNIENIE Z SUMĄ PARAGONU ---
//
// Suma wydrukowana na paragonie jest jedyną liczbą, której model nie musi składać sam —
// odczytuje ją wprost. Gdy „pozycje + modyfikatory" się z nią nie spinają, to modyfikator
// jest podejrzany, bo pozycje model przepisuje jedna do jednej, a modyfikatory INTERPRETUJE.
// Trzy błędy zaobserwowane w audycie 2026-08-16, wszystkie zaniżające rachunek:
//
//   1. Rabat JUŻ UWZGLĘDNIONY w cenie doliczony drugi raz. Paragon Rossmanna drukuje
//      „Uwzgl. rabat: -20,00" pod ceną, która ten rabat ma już w sobie. Model odjął go
//      ponownie: 29,98 zł zamieniło się w 9,98 zł.
//   2. To samo w wariancie „cena po rabacie + rabat osobno" (Diverse, -36 zł).
//   3. Kwota podatku oznaczona jako PROCENT: „Sales Tax 8% … 4.830" wróciło jako
//      `isPercent: true, value: 4.83`, czyli 4,83 % zamiast 4,83 waluty.
//
// Zamiast łatać każdy przypadek osobno, sprawdzamy WSZYSTKIE sensowne odczytania
// modyfikatorów i wybieramy to, które domyka sumę paragonu. Rozstrzyga arytmetyka, więc
// działa niezależnie od języka paragonu i od tego, jak model nazwał linię.
//
// Kolejność preferencji przy remisie: zostaw jak jest → przeczytaj procent jako kwotę →
// odrzuć. Dzięki temu nic nie znika, dopóki da się to wytłumaczyć łagodniej.
const MAX_RECONCILED = 6; // 3^6 = 729 kombinacji; wyżej i tak nie ma realnych paragonów

const reconcileModifiers = (mods, itemsG, receiptTotalG) => {
  if (!receiptTotalG || !mods.length || mods.length > MAX_RECONCILED) return null;

  // Warianty odczytania jednego modyfikatora, od najtańszego do najdroższego.
  const optionsFor = (m) => {
    const out = [{ cost: 0, mod: m }];
    if (m.type === 'percent') {
      // „4.83 %" może być w rzeczywistości kwotą 4,83 — model myli te dwa pola.
      out.push({ cost: 1, mod: { ...m, type: 'amount', value: fromGrosze(toGrosze(m.value)) } });
    }
    out.push({ cost: 2, mod: null }); // linia, której w ogóle nie należało doliczać
    return out;
  };

  let best = null;
  const walk = (i, chosen, sumG, cost) => {
    if (best && cost >= best.cost) return; // gorsze od już znalezionego — nie ma po co schodzić
    if (i === mods.length) {
      if (Math.abs(itemsG + sumG - receiptTotalG) <= TOLERANCE_G) {
        best = { cost, mods: chosen.filter(Boolean) };
      }
      return;
    }
    for (const opt of optionsFor(mods[i])) {
      const add = opt.mod ? modifierGrosze(opt.mod, itemsG) : 0;
      walk(i + 1, [...chosen, opt.mod], sumG + add, cost + opt.cost);
    }
  };
  walk(0, [], 0, 0);
  return best ? best.mods : null;
};

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
  const receiptTotalG = receiptTotal ? toGrosze(receiptTotal) : 0;

  // Najpierw arytmetyka: jeśli któreś odczytanie modyfikatorów domyka sumę paragonu,
  // to ono jest prawdą — niezależnie od nazw i od tego, co model zadeklarował.
  const reconciled = reconcileModifiers(parsedModifiers, itemsG, receiptTotalG);

  let modifiers;
  if (reconciled) {
    modifiers = reconciled.map(({ __tax, ...m }) => m);
  } else {
    // Suma się nie domyka (albo jej nie ma) — zostaje stara reguła podatkowa oparta na nazwie.
    const taxes = parsedModifiers.filter((m) => m.__tax);
    const others = parsedModifiers.filter((m) => !m.__tax);
    const keepTaxes = taxes.length === 0
      ? true
      : shouldKeepTaxes(taxes, others, itemsG, receiptTotalG);
    modifiers = parsedModifiers
      .filter((m) => {
        if (!m.__tax) return true;
        if (keepTaxes !== null) return keepTaxes;
        // Bez sumy zostaje sama nazwa: „PTU"/„VAT" znaczy podatek wliczony, więc precz.
        return !INCLUDED_TAX_RE.test(m.description);
      })
      .map(({ __tax, ...m }) => m);
  }
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

// --- PODEJRZANE POZYCJE W ODCZYCIE ------------------------------------------
//
// DLACZEGO PO STRONIE APLIKACJI, A NIE W PROMPCIE: prompt ma już sekcję „GDY SUMA SIĘ
// NIE ZGADZA" i mimo to przepuścił pozycję wpisaną dwa razy (zgłoszenie z 2026-08-25:
// „opłata za nakrycie" 27,50 na liście dwukrotnie, rachunek 183 pokazywał 210,50).
// Model, który przeoczył linię, tym samym rozumowaniem przeoczy własny błąd. Odejmowanie
// dwóch liczb nie ma złego dnia — więc sprawdzamy tutaj, deterministycznie.
//
// ZNACZNIK, NIE KASOWANIE. Funkcja tylko WSKAZUJE wiersz; decyzję podejmuje człowiek.
// Aplikacja od cudzych pieniędzy nie usuwa po cichu odczytanych danych — bo „dwie takie
// same pozycje" bywa czasem prawdą, a cicho skasowana linia zaniża rachunek płatnikowi.

// Linie podsumowania nigdy nie są pozycją. Prompt tego zabrania (reguła 9), ale to jest
// druga warstwa: jedno przeoczenie modelu nie ma prawa wejść na rachunek bez ostrzeżenia.
const SUMMARY_LINE_RE = /^\s*(suma|razem|łącznie|lacznie|do zapłaty|do zaplaty|total|subtotal|amount due|gotówka|gotowka|karta|reszta)\b/i;

// Klucz duplikatu: nazwa bez ozdób i kwota co do grosza. Ilość NIE wchodzi do klucza —
// „2 × woda" i „2 × woda" to nadal ta sama linia odczytana dwa razy.
const dupKey = (it) =>
  `${String((it && it.description) || '').trim().replace(/\s+/g, ' ').toLowerCase()}|${toGrosze((it && it.amount) || 0)}`;

// Zwraca tablicę RÓWNOLEGŁĄ do `items`, w każdym miejscu lista kodów usterek:
//   'duplicate'    — ta sama nazwa i ta sama kwota występuje w odczycie więcej niż raz.
//                    Łapie też dwa zdjęcia tego samego paragonu, gdzie dubluje się wszystko.
//   'over-total'   — pojedyncza pozycja przewyższa sumę całego paragonu. Zero fałszywych
//                    alarmów: to niemożliwe, więc zawsze jest błędem (typowo przecinek
//                    nie tam, gdzie trzeba — 275,00 zamiast 27,50).
//   'summary-line' — nazwa wygląda na linię podsumowania, nie na pozycję.
export function receiptItemFlags(items, receiptTotal) {
  const list = Array.isArray(items) ? items : [];
  const flags = list.map(() => new Set());

  const byKey = new Map();
  list.forEach((it, i) => {
    const key = dupKey(it);
    if (byKey.has(key)) {
      flags[i].add('duplicate');
      flags[byKey.get(key)].add('duplicate');
    } else {
      byKey.set(key, i);
    }
  });

  const totalG = receiptTotal ? toGrosze(receiptTotal) : 0;
  list.forEach((it, i) => {
    if (totalG > 0 && toGrosze((it && it.amount) || 0) > totalG) flags[i].add('over-total');
    if (SUMMARY_LINE_RE.test(String((it && it.description) || ''))) flags[i].add('summary-line');
  });

  return flags.map((s) => [...s]);
}

// Stan kontroli sumy w arkuszu akceptacji. TRZY STANY, NIGDY ZERO — i to jest cała
// istota tej funkcji.
//
// Do 2026-08-25 warunek brzmiał `totalG > 0 && …`, więc gdy model nie odczytał sumy
// paragonu, ostrzeżenie znikało w całości i arkusz wyglądał DOKŁADNIE tak samo pewnie,
// jak wtedy, gdy wszystko się spina. Brak ostrzeżenia musi znaczyć „sprawdzone”,
// a nigdy „nie miałem czym sprawdzić”.
//
//   'ok'      — pozycje i modyfikatory spinają się z sumą z paragonu
//   'diff'    — spinają się, ale nie z tą sumą; `diffG` niesie ZNAK, bo kierunek
//               rozstrzyga, czego szukać: nadmiar to duplikat, niedobór to przeoczona linia
//   'no-total'— nie ma z czym porównać; ekran ma o tym powiedzieć i poprosić o kwotę
export function receiptCheck(itemsG, modifiersG, receiptTotalG) {
  const sumG = Math.round((itemsG || 0) + (modifiersG || 0));
  if (!receiptTotalG || receiptTotalG <= 0) return { status: 'no-total', sumG, diffG: 0 };
  const diffG = sumG - Math.round(receiptTotalG);
  if (Math.abs(diffG) <= TOLERANCE_G) return { status: 'ok', sumG, diffG: 0 };
  return { status: 'diff', sumG, diffG };
}
