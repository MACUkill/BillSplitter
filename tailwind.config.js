/** @type {import('tailwindcss').Config} */
//
// Wersja 3.x CELOWO — dokładnie ta, którą serwował `cdn.tailwindcss.com`. Wersja 4 zmienia
// domyślne wartości (kolor obramowania, cienie, odstępy), więc byłaby cichą zmianą wyglądu
// w kroku, którego celem jest WIERNE przeniesienie tego samego wyglądu z sieci do buildu.
// Podniesienie do 4 to osobna decyzja, po redesignie.
//
// ⚠️ `content` to najważniejsza linia w tym pliku. Z CDN działała KAŻDA klasa, bo style
// powstawały w locie. Po kompilacji do arkusza trafiają wyłącznie nazwy, które skaner
// znajdzie jako CAŁY TEKST w poniższych plikach — czego nie obejmie, tego nie będzie.
// Pilnuje tego test `src/selectors.contract.test.js`.
export default {
  content: [
    './index.html',
    './src/**/*.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
