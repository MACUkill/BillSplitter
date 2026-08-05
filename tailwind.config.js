/** @type {import('tailwindcss').Config} */
//
// Wersja 3.x CELOWO — dokładnie ta, którą serwował `cdn.tailwindcss.com`. Podniesienie do 4
// zmienia domyślne wartości (kolor obramowania, cienie, odstępy), więc jest osobną decyzją.
//
// ⚠️ `content` to najważniejsza linia w tym pliku. Po kompilacji do arkusza trafiają wyłącznie
// nazwy, które skaner znajdzie jako CAŁY TEKST w poniższych plikach — klasa sklejona ze stringu
// (`bg-${kolor}`) wyparuje. Dane z bazy (kolor osoby) idą więc atrybutem `style`, nigdy klasą.
// Pilnuje tego test `src/selectors.contract.test.js`.
export default {
  content: [
    './index.html',
    './src/**/*.js',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Kolory wskazują na zmienne CSS z src/tailwind.css, więc jeden zestaw klas obsługuje
      // motyw jasny i ciemny. Składnia z <alpha-value> pozwala pisać np. `bg-brand/20`.
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',
        // Marka niesie CAŁE BLOKI, nie akcenty: limonka pod czarnym tekstem.
        brand: 'rgb(var(--brand) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        // Role pieniężne. Rozłączne z kolorami tożsamości ludzi — patrz src/tailwind.css.
        owe: 'rgb(var(--owe) / <alpha-value>)',
        due: 'rgb(var(--due) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Archivo Variable', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque Variable', 'Archivo Variable', 'system-ui', 'sans-serif'],
      },
      // Duże, miękkie promienie — karta jest kafelkiem, nie ramką.
      borderRadius: {
        card: '1.5rem',
        block: '1.25rem',
        inner: '0.875rem',
      },
      minHeight: {
        // Cel dotykowy 48 px: telefon w hałasie, jedna ręka, stuknięcie w biegu.
        tap: '3rem',
      },
      minWidth: {
        tap: '3rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.04), 0 8px 24px rgb(var(--shadow) / 0.06)',
        lift: '0 2px 6px rgb(var(--shadow) / 0.08), 0 18px 40px rgb(var(--shadow) / 0.12)',
      },
    },
  },
  plugins: [],
};
