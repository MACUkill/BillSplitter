// NAJMNIEJ PRZELEWÓW PRZY DUŻEJ EKIPIE.
//
// Aplikacja jest dla grup, więc piętnaście osób to normalny dzień, nie przypadek skrajny.
// Do 2026-08-18 plan liczył się dokładnie tylko do czternastu osób, a wyżej schodził na
// przegląd zerowych podgrup do sześciu osób i gubił po jednym przelewie — przy 15 osobach
// w 9,5% układów, przy 16 w 20,5%, przy 18–20 w około 30%. Ten plik pilnuje, żeby to
// nie wróciło: porównuje wynik z NIEZALEŻNIE policzonym optimum, a nie sam ze sobą.
import { describe, it, expect } from 'vitest';
import { simplifyDebts, calculateAll, toGrosze } from './calc.js';

// Wzorzec liczony inaczej niż kod produkcyjny: pełne programowanie dynamiczne po WSZYSTKICH
// parach maska–podmaska (3^n). Wolne, ale zupełnie nie dzieli założeń z badanym algorytmem,
// więc wspólny błąd jest nieprawdopodobny. Zwraca minimalną liczbę przelewów.
const brutePrzelewy = (salda) => {
  const n = salda.length;
  const size = 1 << n;
  const sum = new Float64Array(size);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + salda[31 - Math.clz32(low)];
  }
  const best = new Int32Array(size).fill(-1);
  best[0] = 0;
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    let b = -1;
    for (let s = m; s > 0; s = (s - 1) & m) {
      if (!(s & low) || sum[s] !== 0) continue;
      const prev = best[m ^ s];
      if (prev >= 0 && prev + 1 > b) b = prev + 1;
    }
    best[m] = b;
  }
  return n - best[size - 1];
};

// Salda -> długi. Wszystko przez jedno konto pośrednie o saldzie zero, żeby simplifyDebts
// odtworzyło dokładnie zadane salda niezależnie od tego, jak powstały.
const dlugiZSald = (salda) => {
  const out = [];
  salda.forEach((amt, i) => {
    const id = `P${String(i).padStart(2, '0')}`;
    if (amt > 0) out.push({ from: 'HUB', to: id, amountG: amt });
    else if (amt < 0) out.push({ from: id, to: 'HUB', amountG: -amt });
  });
  return out;
};

const saldaZPrzelewow = (transfers) => {
  const bal = new Map();
  transfers.forEach((t) => {
    bal.set(t.from, (bal.get(t.from) || 0) - t.amountG);
    bal.set(t.to, (bal.get(t.to) || 0) + t.amountG);
  });
  return bal;
};

const makeRng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

// Losowe salda sumujące się do zera, bez zer (osoba rozliczona nie jest uczestnikiem planu).
const losoweSalda = (rng, n, krok = 100, zakres = 200) => {
  for (;;) {
    const b = [];
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const v = (Math.floor(rng() * (2 * zakres + 1)) - zakres) * krok;
      b.push(v); s += v;
    }
    b.push(-s);
    if (!b.some((x) => x === 0)) return b;
  }
};

describe('najmniej przelewów — duża ekipa', () => {
  // Kontrprzykład znaleziony podczas audytu 2026-08-18. Stary kod robił tu 13 przelewów,
  // choć wystarcza 12: optimum wymaga podgrupy SIEDMIOOSOBOWEJ, a przegląd do sześciu
  // osób nie mógł jej zobaczyć. Trzymamy go dosłownie, bo to jedyny test, który
  // odróżnia „algorytm poprawiony" od „algorytm przypadkiem trafił".
  it('piętnaście osób: układ, na którym przegląd do sześciu osób gubił przelew', () => {
    const salda = [
      15500, -9200, -18300, -3900, -4000, 17500, 19100, -18800,
      -3400, -4900, -13200, 16000, -8200, 18200, -2400,
    ];
    expect(salda.reduce((a, b) => a + b, 0)).toBe(0);
    expect(simplifyDebts(dlugiZSald(salda))).toHaveLength(12);
    expect(brutePrzelewy(salda)).toBe(12);
  });

  it.each([15, 16])('%i osób: plan zawsze równy optimum (losowe salda)', (n) => {
    const rng = makeRng(20260818 + n);
    for (let t = 0; t < 30; t++) {
      const salda = losoweSalda(rng, n);
      const got = simplifyDebts(dlugiZSald(salda)).length;
      expect({ n, t, got }).toEqual({ n, t, got: brutePrzelewy(salda) });
    }
  });

  it('salda zbite w wąskim zakresie też schodzą do optimum', () => {
    const rng = makeRng(4242);
    for (let t = 0; t < 20; t++) {
      // krok 10 gr i zakres ±20 daje mnóstwo zerowych podzbiorów — najgorszy przypadek
      // dla wyszukiwania podgrup.
      const salda = losoweSalda(rng, 14, 10, 20);
      const got = simplifyDebts(dlugiZSald(salda)).length;
      expect({ t, got }).toEqual({ t, got: brutePrzelewy(salda) });
    }
  });

  it.each([15, 20, 25, 34])('%i osób: plan zachowuje salda i nie przekracza n−1 przelewów', (n) => {
    const rng = makeRng(999 + n);
    for (let t = 0; t < 10; t++) {
      const salda = losoweSalda(rng, n);
      const transfers = simplifyDebts(dlugiZSald(salda));
      expect(transfers.length).toBeLessThanOrEqual(n - 1);
      transfers.forEach((tr) => expect(tr.amountG).toBeGreaterThan(0));
      const wynik = saldaZPrzelewow(transfers);
      salda.forEach((amt, i) => {
        expect(wynik.get(`P${String(i).padStart(2, '0')}`) || 0).toBe(amt);
      });
      expect(wynik.get('HUB') || 0).toBe(0);
    }
  });

  it('kolejność wpisywania rachunków nie zmienia planu', () => {
    const rng = makeRng(31337);
    const salda = losoweSalda(rng, 18);
    const dlugi = dlugiZSald(salda);
    const wzorzec = JSON.stringify(simplifyDebts(dlugi));
    for (let t = 0; t < 5; t++) {
      const shuffled = [...dlugi];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(JSON.stringify(simplifyDebts(shuffled))).toBe(wzorzec);
    }
  });

  it('dwadzieścia pięć osób liczy się w czasie, którego nie widać na telefonie', () => {
    const rng = makeRng(2025);
    const salda = losoweSalda(rng, 25);
    const dlugi = dlugiZSald(salda);
    const start = performance.now();
    for (let i = 0; i < 20; i++) simplifyDebts(dlugi);
    expect((performance.now() - start) / 20).toBeLessThan(150);
  });

  // Sumy podzbiorów szły kiedyś przez Int32Array. Powyżej ~21,4 mln zł zawijały się po cichu,
  // więc niezerowa podgrupa mogła wyjść „zerowa" i plan byłby fałszywy bez żadnego sygnału.
  it('kwoty przekraczające zakres liczby 32-bitowej nie psują podziału', () => {
    const salda = [3000000000, -1000000000, -1000000000, -1000000000];
    const transfers = simplifyDebts(dlugiZSald(salda));
    expect(transfers).toHaveLength(3);
    const wynik = saldaZPrzelewow(transfers);
    salda.forEach((amt, i) => expect(wynik.get(`P0${i}`)).toBe(amt));
  });

  it('grupa bez żadnej zerowej podgrupy daje dokładnie n−1 przelewów', () => {
    // Salda pierwszo-podobne: żaden właściwy podzbiór nie sumuje się do zera.
    const primes = [10007, 10009, 10037, 10039, 10061, 10067, 10069, 10079,
      10091, 10093, 10099, 10103, 10111, 10133, 10139, 10141];
    const salda = [...primes, -primes.reduce((a, b) => a + b, 0)];
    expect(simplifyDebts(dlugiZSald(salda))).toHaveLength(salda.length - 1);
  });
});

describe('controlSum liczony w groszach', () => {
  it.each([3, 7, 15, 23])('%i osób: suma udziałów bez śmiecia zmiennoprzecinkowego', (n) => {
    const participants = {};
    for (let i = 0; i < n; i++) participants[`p${i}`] = { id: `p${i}` };
    const wynik = calculateAll({ totalAmount: 100, participants, currency: 'PLN' });
    const dokladnie = wynik.participantTotals.reduce((s, pt) => s + toGrosze(pt.total), 0);
    // Dodawanie złotych jako liczb zmiennoprzecinkowych dawało tu np. 100.05000000000001.
    expect(toGrosze(wynik.controlSum)).toBe(dokladnie);
    expect(wynik.controlSum).toBe(dokladnie / 100);
  });
});
