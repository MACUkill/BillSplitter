// Sito na podejrzane pozycje z odczytu paragonu i stan kontroli sumy.
// Punkt wyjścia: zgłoszenie z 2026-08-25 — rachunek na 183 EUR pokazywał sumę pozycji
// 210,50, bo „opłata za nakrycie" 27,50 trafiła na listę dwa razy i przeszła przez
// arkusz akceptacji bez zatrzymania.
import { describe, it, expect } from 'vitest';
import { receiptItemFlags, receiptCheck } from './receipt.js';

const item = (description, amount, quantity = 1) => ({ description, amount, quantity });

describe('receiptItemFlags — duplikaty', () => {
  it('oznacza OBIE pozycje o tej samej nazwie i kwocie', () => {
    const items = [item('Woda', 12), item('Opłata za nakrycie', 27.5), item('Opłata za nakrycie', 27.5)];
    const flags = receiptItemFlags(items, 183);
    expect(flags[0]).toEqual([]);
    expect(flags[1]).toContain('duplicate');
    expect(flags[2]).toContain('duplicate');
  });

  it('odtwarza zgłoszony przypadek: 183 EUR, suma pozycji 210,50', () => {
    const items = [item('Pizza', 155.5), item('Woda', 27.5), item('Opłata za nakrycie', 27.5)];
    const sum = items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBeCloseTo(210.5, 2);
    // Woda i nakrycie mają tę samą kwotę, ale RÓŻNE nazwy — to nie jest duplikat.
    // Sito nie może zgadywać po samej kwocie, bo dwie różne rzeczy potrafią kosztować tyle samo.
    expect(receiptItemFlags(items, 183).every((f) => f.length === 0)).toBe(true);
    // Rozjazd łapie natomiast kontrola sumy — i to ona mówi, w którą stronę szukać.
    const check = receiptCheck(21050, 0, 18300);
    expect(check.status).toBe('diff');
    expect(check.diffG).toBe(2750); // dodatni = pozycji jest ZA DUŻO
  });

  it('nie myli się przy różnych kwotach tej samej nazwy', () => {
    const items = [item('Piwo', 12), item('Piwo', 14)];
    expect(receiptItemFlags(items, 100).every((f) => f.length === 0)).toBe(true);
  });

  it('ignoruje ozdoby w nazwie i wielkość liter', () => {
    const items = [item('  opłata   za NAKRYCIE ', 27.5), item('Opłata za nakrycie', 27.5)];
    const flags = receiptItemFlags(items, 183);
    expect(flags[0]).toContain('duplicate');
    expect(flags[1]).toContain('duplicate');
  });

  it('łapie dwa zdjęcia tego samego paragonu — dubluje się wszystko', () => {
    const one = [item('Pizza', 42), item('Cola', 12)];
    const flags = receiptItemFlags([...one, ...one], 54);
    expect(flags.every((f) => f.includes('duplicate'))).toBe(true);
  });

  it('nie oznacza niczego, gdy pozycja występuje raz', () => {
    expect(receiptItemFlags([item('Pizza', 42)], 42)).toEqual([[]]);
  });
});

describe('receiptItemFlags — pozycja większa niż paragon', () => {
  it('łapie przesunięty przecinek (275,00 zamiast 27,50)', () => {
    const flags = receiptItemFlags([item('Nakrycie', 275), item('Woda', 12)], 183);
    expect(flags[0]).toContain('over-total');
    expect(flags[1]).toEqual([]);
  });

  it('bez sumy paragonu nie zgłasza tej usterki — nie ma z czym porównać', () => {
    expect(receiptItemFlags([item('Nakrycie', 275)], null)).toEqual([[]]);
  });

  it('pozycja równa sumie paragonu jest w porządku (jedna rzecz na rachunku)', () => {
    expect(receiptItemFlags([item('Nocleg', 183)], 183)).toEqual([[]]);
  });
});

describe('receiptItemFlags — linie podsumowania', () => {
  it.each(['SUMA', 'Razem', 'DO ZAPŁATY', 'Total', 'Subtotal', 'Reszta', 'Karta'])(
    'oznacza „%s" jako linię podsumowania, nie pozycję',
    (name) => {
      expect(receiptItemFlags([item(name, 183)], 500)[0]).toContain('summary-line');
    },
  );

  it('nie czepia się dania, które tylko zaczyna się podobnie', () => {
    expect(receiptItemFlags([item('Sumak w oleju', 12)], 100)[0]).toEqual([]);
  });
});

describe('receiptCheck — trzy stany, nigdy zero', () => {
  it('zgodność co do grosza', () => {
    expect(receiptCheck(18300, 0, 18300).status).toBe('ok');
  });

  it('zaokrąglenia mieszczą się w tolerancji', () => {
    expect(receiptCheck(18301, 0, 18300).status).toBe('ok');
  });

  it('nadmiar niesie ZNAK DODATNI — szukaj duplikatu', () => {
    const r = receiptCheck(21050, 0, 18300);
    expect(r.status).toBe('diff');
    expect(r.diffG).toBeGreaterThan(0);
  });

  it('niedobór niesie ZNAK UJEMNY — szukaj przeoczonej linii', () => {
    const r = receiptCheck(15550, 0, 18300);
    expect(r.status).toBe('diff');
    expect(r.diffG).toBeLessThan(0);
  });

  it('modyfikatory wchodzą do porównania', () => {
    expect(receiptCheck(18300, 2750, 21050).status).toBe('ok');
  });

  // TO JEST SEDNO CAŁEJ POPRAWKI. Do 2026-08-25 brak sumy paragonu wyłączał ostrzeżenie
  // w całości, więc arkusz wyglądał tak samo pewnie jak przy zgodnej sumie.
  it('brak sumy paragonu to WŁASNY STAN, nie cisza', () => {
    expect(receiptCheck(21050, 0, 0).status).toBe('no-total');
    expect(receiptCheck(21050, 0, null).status).toBe('no-total');
    expect(receiptCheck(21050, 0, undefined).status).toBe('no-total');
  });

  it('stan „no-total" i tak podaje sumę pozycji — jest co pokazać', () => {
    expect(receiptCheck(21050, 0, null).sumG).toBe(21050);
  });
});
