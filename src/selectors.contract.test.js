// KONTRAKT ETYKIET — test bezpieczeństwa redesignu.
//
// DLACZEGO to istnieje: cała logika w main.js trzyma się DOM przez `getElementById`
// i klasy-uchwyty (`.item-tile`, `.settle-btn`, `.nudge-btn`…). Redesign, który zmieni
// albo usunie `id` w index.html, NIE wywoła żadnego błędu — przycisk po prostu przestanie
// działać. Cicha awaria w aplikacji o cudzych pieniądzach jest najgorszym rodzajem błędu,
// bo nikt jej nie zauważy, dopóki ktoś nie straci wpłaty.
//
// Ten test czyta oba pliki jako TEKST (bez DOM, bez przeglądarki) i pilnuje, żeby każdy
// uchwyt, po który sięga kod, istniał w markupie. Po redesignie `npm test` wypisuje listę
// brakujących etykiet zamiast oddawać zepsutą aplikację.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'src/main.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

// Elementy, których w index.html NIE MA z założenia — tworzy je JavaScript w czasie działania.
// Każdy wpis musi mieć powód; nowy wpis bez powodu to zwykle przeoczona etykieta.
const RUNTIME_CREATED_IDS = new Set([
  'confirm-payer-btn',         // wstrzykiwany w baner potwierdzenia płatnika (rachunek zaawansowany)
  'confirm-payer-btn-simple',  // j.w. dla rachunku prostego
  'toast-notification',        // toast budowany przez showToast()
  'bills-filter-reset',        // „Pokaż wszystkie" w stanie pustym listy rachunków
  'bill-settle-btn',           // „Ureguluj" na limonkowej karcie „Twój udział" (myBillSettleHtml)
  'viewport-diag',             // panel z wymiarami okna — powstaje dopiero po ukrytym geście
  // Brama rozliczeń (2026-08-26): wszystkie cztery żyją w treści wstrzykiwanej do
  // istniejących pojemników — baner stanu rachunku i arkusz „Zamknij rachunek".
  'close-bill-btn',            // „Zamknij rachunek" w banerze stanu (gateBannerHtml)
  'remind-fill-btn',           // „Przypomnij" obok niego, dla płatnika/admina
  'close-bill-later',          // „Jeszcze poczekam" w arkuszu zamknięcia
  'rest-dispute-btn',          // „To nie moje" pod własnym udziałem (restClaimHtml)
]);

// Klasy-uchwyty renderowane przez JS do innerHTML — w index.html ich nie ma i być nie musi,
// ale MUSZĄ istnieć w szablonach main.js, inaczej `querySelector` trafia w pustkę.
const collect = (re, text, group = 1) =>
  [...text.matchAll(re)].map((m) => m[group]);

describe('kontrakt etykiet: getElementById → index.html', () => {
  const ids = [...new Set(collect(/getElementById\(\s*'([^'$]+)'\s*\)/g, mainJs))];

  it('znajduje sensowną liczbę statycznych identyfikatorów (test nie zdegenerował się do pustego)', () => {
    expect(ids.length).toBeGreaterThan(100);
  });

  it('każdy identyfikator z main.js istnieje w index.html albo jest jawnie tworzony w czasie działania', () => {
    const missing = ids.filter(
      (id) => !RUNTIME_CREATED_IDS.has(id) && !indexHtml.includes(`id="${id}"`),
    );
    expect(missing, `Brakujące id w index.html:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('lista wyjątków nie zawiera martwych wpisów (element istnieje w HTML → wyjątek niepotrzebny)', () => {
    const stale = [...RUNTIME_CREATED_IDS].filter((id) => indexHtml.includes(`id="${id}"`));
    expect(stale, `Wyjątki do usunięcia: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('kontrakt etykiet: klasy-uchwyty → markup albo szablon JS', () => {
  // Bierzemy tylko selektory klasowe (`.foo`, `.foo:checked`) — selektory atrybutowe
  // sprawdzamy osobno niżej.
  const classSelectors = [
    ...new Set(
      collect(/querySelector(?:All)?\(\s*'\.([a-zA-Z0-9_-]+)[^']*'\s*\)/g, mainJs),
    ),
  ];
  // `closest('.foo')` to ta sama zależność — delegacja zdarzeń łapie po klasie.
  const closestSelectors = [
    ...new Set(collect(/closest\(\s*'\.([a-zA-Z0-9_-]+)'\s*\)/g, mainJs)),
  ];
  const handles = [...new Set([...classSelectors, ...closestSelectors])];

  it('wyłapuje klasy-uchwyty (test nie zdegenerował się do pustego)', () => {
    expect(handles.length).toBeGreaterThan(15);
  });

  // Do sprawdzania „czy klasa jest gdzieś NADAWANA" bierzemy main.js BEZ miejsc jej odczytu —
  // inaczej querySelector('.foo') sam by siebie uzasadniał i test nic by nie pilnował.
  const mainJsWithoutReads = mainJs
    .replace(/querySelector(?:All)?\(\s*'[^']*'\s*\)/g, '')
    .replace(/closest\(\s*'[^']*'\s*\)/g, '');

  it('każda klasa-uchwyt występuje w index.html albo jest nadawana w main.js', () => {
    const missing = handles.filter((cls) => {
      const inHtml = new RegExp(`class="[^"]*\\b${cls}\\b`).test(indexHtml);
      // Klasa bywa nadawana wprost w szablonie (`class="item-tile ..."`), przez className,
      // przez classList.add, ale też POŚREDNIO — jako literał przypisany do zmiennej,
      // która trafia do `class="${zmienna}"` (tak działa np. simple-status-select).
      const assigned = new RegExp(`['"\`][^'"\`]*\\b${cls}\\b`).test(mainJsWithoutReads);
      return !inHtml && !assigned;
    });
    expect(
      missing,
      `Klasy-uchwyty bez odpowiednika w markupie:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('kontrakt etykiet: atrybuty data-* czytane przez logikę', () => {
  // Logika czyta wartości przez dataset.X; element musi je gdzieś dostawać.
  // camelCase w dataset odpowiada data-kebab-case w markupie.
  const camelToKebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const datasetReads = [...new Set(collect(/\.dataset\.([a-zA-Z0-9]+)/g, mainJs))];

  it('każdy odczyt dataset.X ma odpowiadający atrybut data-x w markupie albo w szablonie', () => {
    const missing = datasetReads.filter((key) => {
      const attr = `data-${camelToKebab(key)}`;
      // Uwzględniamy też zapis z JS (`el.dataset.x = ...`), bo to też nadanie wartości.
      const written = new RegExp(`(?:${attr}=|dataset\\.${key}\\s*=)`).test(mainJs);
      return !written && !indexHtml.includes(`${attr}=`);
    });
    expect(
      missing,
      `Odczyty dataset bez źródła danych:\n  ${missing.map((k) => `dataset.${k}`).join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('gotowość na kompilowany Tailwind (dziś CDN)', () => {
  // Tailwind z CDN generuje style w locie, więc DZIAŁA KAŻDA klasa. Po przejściu na build
  // do arkusza trafiają tylko te nazwy, które skaner ZNAJDZIE JAKO CAŁY TEKST w plikach.
  // Klasa sklejana z kawałków (`bg-${kolor}-500`) jest wtedy nie do znalezienia i po cichu
  // wyparowuje — element traci styl, a nic nie zgłasza błędu. Ten test pilnuje, żeby
  // takie sklejanie nie pojawiło się w kodzie przed samą wymianą.
  it('żadna klasa nie jest sklejana z fragmentów wewnątrz atrybutu class', () => {
    const offenders = [];
    const classAttr = /class="([^"]*)"/g;
    for (const m of mainJs.matchAll(classAttr)) {
      const value = m[1];
      // Groźne jest tylko wstawienie ZROŚNIĘTE z tekstem klasy (bez spacji dookoła),
      // np. `bg-${x}` albo `${x}-500`. Wstawienie całej klasy (`${tileClass}`) jest bezpieczne.
      if (/[a-zA-Z0-9-]\$\{/.test(value) || /\}\-?[a-zA-Z0-9]/.test(value)) {
        const line = mainJs.slice(0, m.index).split('\n').length;
        offenders.push(`main.js:${line}  class="${value.trim().slice(0, 90)}"`);
      }
    }
    expect(
      offenders,
      `Klasy sklejane z fragmentów (skaner Tailwinda ich nie znajdzie):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('konfiguracja Tailwinda skanuje oba źródła klas', () => {
    // Klasy żyją w DWÓCH miejscach: w znacznikach (index.html) i w szablonach składanych
    // w JavaScripcie (src/main.js). Wypadnięcie któregokolwiek z `content` nie wywoła
    // żadnego błędu — po prostu część styli przestanie powstawać.
    const config = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
    const content = config.match(/content:\s*\[([^\]]*)\]/);
    expect(content, 'Nie znaleziono listy `content` w tailwind.config.js').toBeTruthy();
    expect(content[1]).toContain('./index.html');
    expect(content[1]).toMatch(/\.\/src\/\*\*\/\*\.js/);
  });

  it('nic już nie ładuje Tailwinda z sieci', () => {
    // Powrót skryptu z CDN cofnąłby cały ten krok i przywrócił zależność od cudzego serwera.
    expect(indexHtml).not.toMatch(/<script[^>]+cdn\.tailwindcss\.com/);
  });

  it('zmienne trzymające klasy zawierają pełne nazwy (skaner znajdzie je jako tekst)', () => {
    // Przykłady z kodu: sizeClass 'w-9 h-9 text-lg mr-3', tileClass 'border-blue-500 bg-blue-50'.
    // Sprawdzamy, że nie ma przypisań w rodzaju `const c = 'bg-' + kolor`.
    const glued = [...mainJs.matchAll(/'[a-z-]*-'\s*\+|\+\s*'-[a-z-]*'/g)].map((m) => m[0]);
    expect(glued, `Sklejanie nazw klas operatorem +: ${glued.join(', ')}`).toEqual([]);
  });
});

describe('kontrakt etykiet: ekrany i modale', () => {
  // showScreen() składa id ekranu z nazwy — te id nie pojawią się w getElementById jako literał,
  // więc bez tego testu redesign mógłby je usunąć niezauważenie.
  const SCREENS = ['loading', 'start', 'join', 'group-dashboard', 'bill', 'profile'];

  it('każdy ekran z showScreen() istnieje w index.html', () => {
    const missing = SCREENS.filter((s) => !indexHtml.includes(`id="${s}-screen"`));
    expect(missing, `Brakujące ekrany: ${missing.join(', ')}`).toEqual([]);
  });

  it('lista ekranów w teście jest zgodna z listą w main.js', () => {
    // Wyciągamy tablicę z showScreen, żeby test i kod nie rozjechały się po cichu.
    const m = mainJs.match(/showScreen\s*=\s*\(screenName\)\s*=>\s*\{\s*\[([^\]]+)\]/);
    expect(m, 'Nie znaleziono listy ekranów w showScreen — zmieniła się jego postać?').toBeTruthy();
    const inCode = collect(/'([^']+)'/g, m[1]);
    expect(inCode.sort()).toEqual([...SCREENS].sort());
  });
});
