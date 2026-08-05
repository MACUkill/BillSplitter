// STRAŻNIK ESCAPOWANIA — regresja bezpieczeństwa renderowania.
//
// Interfejs składa HTML ze stringów i wstawia go przez innerHTML. Dane, które tam trafiają
// (imiona, nazwy rachunków, opisy pozycji, adresy zdjęć), pochodzą z Firestore, a do dokumentu
// grupy może pisać KAŻDY, kto zna link. Jedno pominięte `escapeHtml` wystarczy, żeby ktoś
// z ekipy wstrzyknął kod wykonujący się u wszystkich pozostałych.
//
// Audyt znalazł tu kilka takich miejsc naraz. Ten test pilnuje, żeby nie wróciły — a przy
// redesignie (przepisywanie szablonów) to ryzyko jest największe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'src/main.js'), 'utf8');

// Wyrażenia, których nie trzeba escapować — każde z konkretnego powodu.
// Dopisanie czegoś tutaj to świadoma decyzja, nie obejście testu.
const SAFE = [
  /^screenName$/,                        // nazwa ekranu z kodu, nie z bazy
  /^nameHtml$/,                          // już zescapowany fragment HTML
  /^avatarHtml\(/,                       // funkcja escapuje wewnątrz
  /^initials\(/,                         // pierwsza litera imienia, wstawiana już zescapowana
  /^escapeHtml\(/,                       // jawnie zescapowane
  /^fmtMoney\(/,                         // formatuje liczby
  /^paymentIconClass\(/,                 // klasa CSS ze słownika w kodzie
  /^getPlnConversionHtml\(/,             // liczby + nawiasy, bez danych użytkownika
  /^t\.label$/,                          // etykieta z PAYMENT_TYPES (stała w kodzie)
  /toFixed\(/,                           // liczby
  /^Number\(/,                           // jawnie sprowadzone do liczby
  /^(cur|currency|sizeClass|tileClass|selectClass|current\.\w+|badge|icon|when|amt|kwota)$/,
];

const isSafe = (expr) => SAFE.some((re) => re.test(expr.trim()));

// Nazwy, które w tej aplikacji NIEMAL ZAWSZE oznaczają dane z bazy.
const RISKY = /(?:^|[.\s(])(name|billName|description|label|value|photoURL|url|groupName)\b/i;

describe('bezpieczeństwo renderowania: dane z bazy nie trafiają surowe do HTML', () => {
  // Bierzemy tylko linie, które faktycznie budują znaczniki — reszta (toast, textContent,
  // ścieżki w Storage) nie jest wektorem.
  const htmlLines = mainJs
    .split('\n')
    .map((text, i) => ({ text, line: i + 1 }))
    .filter(({ text }) => text.includes('${') && /<[a-zA-Z/]/.test(text));

  it('znajduje szablony HTML do sprawdzenia (test nie zdegenerował się do pustego)', () => {
    expect(htmlLines.length).toBeGreaterThan(40);
  });

  it('każda interpolacja danych użytkownika w szablonie HTML jest zescapowana', () => {
    const offenders = [];
    for (const { text, line } of htmlLines) {
      for (const m of text.matchAll(/\$\{([^{}]*)\}/g)) {
        const expr = m[1];
        if (!RISKY.test(expr) || isSafe(expr)) continue;
        offenders.push(`main.js:${line}  \${${expr.trim()}}`);
      }
    }
    expect(
      offenders,
      `Nieescapowane dane w szablonie HTML:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('bezpieczeństwo renderowania: escapeHtml faktycznie escapuje', () => {
  // Wyciągamy implementację z main.js i sprawdzamy ją na wprost — gdyby ktoś ją „uprościł",
  // wszystkie powyższe wywołania stałyby się pustym gestem.
  // Uwaga: implementacja zawiera encję `&#39;`, więc cięcie po pierwszym średniku
  // urywałoby ją w połowie — bierzemy całą linię.
  const m = mainJs.match(/^\s*const escapeHtml = (.+);\s*$/m);

  it('funkcja istnieje w main.js', () => {
    expect(m, 'Nie znaleziono escapeHtml — zmieniła się nazwa lub postać?').toBeTruthy();
  });

  it('neutralizuje znaki niebezpieczne w HTML i w atrybutach', () => {
    // eslint-disable-next-line no-new-func
    const escapeHtml = new Function(`return (${m[1]});`)();
    const out = escapeHtml(`<img src=x onerror="alert(1)">&'`);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('"');
    expect(out).not.toContain("'");
    expect(out).toContain('&lt;');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
  });

  it('radzi sobie z null/undefined (render nie może się wywalić na braku danych)', () => {
    // eslint-disable-next-line no-new-func
    const escapeHtml = new Function(`return (${m[1]});`)();
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
