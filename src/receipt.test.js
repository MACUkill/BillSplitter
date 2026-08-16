import { describe, it, expect } from 'vitest';
import {
  parseNumberLoose, normalizeReceipt,
  receiptItemsToSharedCosts, receiptModifiersToGlobalCosts,
} from './receipt.js';
import { toGrosze } from './calc.js';

describe('parseNumberLoose — model zwraca liczby w różnych postaciach', () => {
  it('liczby przechodzą bez zmian', () => {
    expect(parseNumberLoose(42)).toBe(42);
    expect(parseNumberLoose(0)).toBe(0);
    expect(parseNumberLoose(-5.5)).toBe(-5.5);
  });

  it('polski przecinek dziesiętny', () => {
    expect(parseNumberLoose('12,50')).toBe(12.5);
    expect(parseNumberLoose('0,99')).toBe(0.99);
  });

  it('separator tysięcy (spacja, twarda spacja, kropka)', () => {
    expect(parseNumberLoose('1 234,50')).toBe(1234.5);
    expect(parseNumberLoose('1 234,50')).toBe(1234.5);
    expect(parseNumberLoose('1.234,50')).toBe(1234.5);
    expect(parseNumberLoose('1,234.50')).toBe(1234.5);
  });

  it('waluty i śmieci wokół liczby', () => {
    expect(parseNumberLoose('12,50 zł')).toBe(12.5);
    expect(parseNumberLoose('PLN 8.00')).toBe(8);
  });

  it('różne myślniki jako minus', () => {
    expect(parseNumberLoose('−5,00')).toBe(-5);
  });

  it('to, czego nie da się odczytać → null', () => {
    for (const v of [null, undefined, {}, [], '', '   ', 'brak', NaN, Infinity]) {
      expect(parseNumberLoose(v)).toBeNull();
    }
  });
});

describe('normalizeReceipt — sito na śmieci z modelu', () => {
  it('kompletne wejście przechodzi', () => {
    const out = normalizeReceipt({
      currency: 'pln',
      items: [
        { name: 'Pizza Margherita', quantity: 1, totalPrice: 42 },
        { name: 'Wino', quantity: 2, totalPrice: '70,00' },
      ],
      receiptTotal: '112,00',
    });
    expect(out.items).toEqual([
      { description: 'Pizza Margherita', quantity: 1, amount: 42 },
      { description: 'Wino', quantity: 2, amount: 70 },
    ]);
    expect(out.currency).toBe('PLN');
    expect(out.receiptTotal).toBe(112);
    expect(out.itemsTotal).toBe(112);
  });

  it('KLUCZOWE: pozycje bez nazwy albo bez sensownej ceny są ODRZUCANE, nie zerowane', () => {
    const out = normalizeReceipt({ items: [
      { name: '', totalPrice: 10 },
      { name: 'Bez ceny' },
      { name: 'Cena zero', totalPrice: 0 },
      { name: 'Cena ujemna', totalPrice: -5 },
      { name: 'Cena bzdurna', totalPrice: 'nie wiem' },
      { name: 'Absurd', totalPrice: 99999999 },
      null,
      'string zamiast obiektu',
      { name: 'Dobra', totalPrice: 9.99 },
    ] });
    expect(out.items).toEqual([{ description: 'Dobra', quantity: 1, amount: 9.99 }]);
  });

  it('brak/zła ilość → 1; ilość ułamkowa obcinana', () => {
    const out = normalizeReceipt({ items: [
      { name: 'A', totalPrice: 5 },
      { name: 'B', totalPrice: 5, quantity: 0 },
      { name: 'C', totalPrice: 5, quantity: -2 },
      { name: 'D', totalPrice: 5, quantity: '3' },
      { name: 'E', totalPrice: 5, quantity: 2.9 },
    ] });
    expect(out.items.map(i => i.quantity)).toEqual([1, 1, 1, 3, 2]);
  });

  it('oryginalna nazwa obcojęzyczna trafia w nawias', () => {
    const out = normalizeReceipt({ items: [
      { name: 'Makaron z krewetkami', nameOriginal: 'Pasta ai gamberi', totalPrice: 60 },
      { name: 'Woda', nameOriginal: 'Woda', totalPrice: 8 },
    ] });
    expect(out.items[0].description).toBe('Makaron z krewetkami (Pasta ai gamberi)');
    expect(out.items[1].description).toBe('Woda');
  });

  it('całkiem błędne wejście nie wywala się i nic nie przepuszcza', () => {
    for (const bad of [null, undefined, 42, 'tekst', [], { items: 'nie tablica' }]) {
      const out = normalizeReceipt(bad);
      expect(out.items).toEqual([]);
      expect(out.modifiers).toEqual([]);
      expect(out.itemsTotal).toBe(0);
    }
  });

  it('kwoty liczone przez grosze — bez błędów zmiennoprzecinkowych', () => {
    const out = normalizeReceipt({ items: [
      { name: 'A', totalPrice: 0.1 },
      { name: 'B', totalPrice: 0.2 },
    ] });
    expect(out.itemsTotal).toBe(0.3);
    expect(toGrosze(out.itemsTotal)).toBe(30);
  });

  it('limit liczby pozycji (obrona przed halucynacją)', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ name: `P${i}`, totalPrice: 1 }));
    expect(normalizeReceipt({ items: many }).items).toHaveLength(100);
  });
});

describe('normalizeReceipt — modyfikatory', () => {
  it('napiwek/serwis/podatek dodatnie, rabat ujemny', () => {
    const out = normalizeReceipt({ modifiers: [
      { kind: 'tip', name: 'Napiwek', value: '10,00' },
      { kind: 'service', name: 'Serwis', value: 10, isPercent: true },
      { kind: 'tax', value: 5 },
      { kind: 'discount', name: 'Rabat', value: 15 },
    ] });
    expect(out.modifiers).toEqual([
      { description: 'Napiwek', type: 'amount', value: 10 },
      { description: 'Serwis', type: 'percent', value: 10 },
      { description: 'Podatek', type: 'amount', value: 5 },
      { description: 'Rabat', type: 'amount', value: -15 },
    ]);
  });

  it('rabat podany ujemnie i tak wychodzi ujemny (bez podwójnego minusa)', () => {
    const out = normalizeReceipt({ modifiers: [{ kind: 'discount', value: -15 }] });
    expect(out.modifiers[0].value).toBe(-15);
  });

  it('odrzuca nieznany typ, zero, procent ponad 100', () => {
    const out = normalizeReceipt({ modifiers: [
      { kind: 'danie', value: 10 },
      { kind: 'tip', value: 0 },
      { kind: 'service', value: 150, isPercent: true },
      { kind: 'tip', value: 'bzdura' },
    ] });
    expect(out.modifiers).toEqual([]);
  });
});

// Najgroźniejszy zaobserwowany błąd modelu: PTU A i PTU B (rozbicie VAT już wliczonego
// w ceny) doliczone jako NAPIWEK, żeby suma się spięła. Rachunek wychodził zawyżony,
// a użytkownik realnie dopłacał podatek drugi raz.
describe('normalizeReceipt — podatek wliczony vs doliczany', () => {
  const plParagon = (modifiers) => normalizeReceipt({
    items: [
      { name: 'Pizza', totalPrice: 42.00 },
      { name: 'Cola', totalPrice: 12.00 },
    ],
    modifiers,
    receiptTotal: 54.00,
  });

  it('KLUCZOWE: PTU zgłoszone jako napiwek nie dolicza się do rachunku', () => {
    const out = plParagon([
      { kind: 'tip', name: 'PTU A 8%', value: 4.00 },
      { kind: 'tip', name: 'PTU B 23%', value: 2.24 },
    ]);
    expect(out.modifiers).toEqual([]);
    expect(out.itemsTotal).toBe(54);
  });

  it('PTU zgłoszone poprawnie jako podatek też odpada, bo suma już się zgadza', () => {
    expect(plParagon([{ kind: 'tax', name: 'SP.OP.PTU A', value: 4.00 }]).modifiers).toEqual([]);
  });

  it('prawdziwy napiwek zostaje — odrzucamy podatek, nie wszystko', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Pizza', totalPrice: 42.00 }, { name: 'Cola', totalPrice: 12.00 }],
      modifiers: [
        { kind: 'tax', name: 'PTU A', value: 4.00 },
        { kind: 'tip', name: 'Napiwek', value: 6.00 },
      ],
      receiptTotal: 60.00,
    });
    expect(out.modifiers).toEqual([{ description: 'Napiwek', type: 'amount', value: 6 }]);
  });

  it('amerykański sales tax DOLICZAMY — tam suma bez niego się nie spina', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Burger', totalPrice: 12.00 }, { name: 'Frytki', totalPrice: 4.00 }],
      modifiers: [
        { kind: 'tax', name: 'Sales Tax', value: 1.32 },
        { kind: 'tip', name: 'Napiwek', value: 3.00 },
      ],
      receiptTotal: 20.32,
      currency: 'USD',
    });
    expect(out.modifiers).toEqual([
      { description: 'Sales Tax', type: 'amount', value: 1.32 },
      { description: 'Napiwek', type: 'amount', value: 3 },
    ]);
  });

  it('podatek procentowy doliczany liczy się od sumy pozycji', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Burger', totalPrice: 100.00 }],
      modifiers: [{ kind: 'tax', name: 'Sales Tax', value: 8, isPercent: true }],
      receiptTotal: 108.00,
    });
    expect(out.modifiers).toEqual([{ description: 'Sales Tax', type: 'percent', value: 8 }]);
  });

  it('bez sumy paragonu: PTU/VAT odpada, ogólny „Podatek" zostaje (brak dowodu)', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Pizza', totalPrice: 42.00 }],
      modifiers: [
        { kind: 'tax', name: 'PTU A', value: 3.11 },
        { kind: 'tax', name: 'Podatek', value: 2.00 },
      ],
    });
    expect(out.modifiers).toEqual([{ description: 'Podatek', type: 'amount', value: 2 }]);
  });

  it('linia PTU wzięta za danie nie staje się pozycją', () => {
    const out = normalizeReceipt({
      items: [
        { name: 'Pizza', totalPrice: 42.00 },
        { name: 'SP.OP.PTU A 8%', totalPrice: 4.00 },
        { name: 'PTU B', totalPrice: 2.24 },
      ],
      receiptTotal: 42.00,
    });
    expect(out.items.map(i => i.description)).toEqual(['Pizza']);
  });

  it('rozjazd sumy NIE jest łatany podatkiem — przy remisie wygrywa pominięcie', () => {
    // Suma paragonu nie zgadza się ani z podatkiem, ani bez niego (przeoczona pozycja).
    // Doliczenie podatku nie poprawia sprawy wyraźnie, więc go nie doliczamy.
    const out = normalizeReceipt({
      items: [{ name: 'Pizza', totalPrice: 42.00 }],
      modifiers: [{ kind: 'tax', name: 'PTU A', value: 4.00 }],
      receiptTotal: 100.00,
    });
    expect(out.modifiers).toEqual([]);
  });
});

describe('mapowanie na rachunek', () => {
  it('pozycje stają się kafelkami, których NIKT jeszcze nie wybrał', () => {
    let n = 0;
    const out = receiptItemsToSharedCosts(
      [{ description: 'Pizza', quantity: 1, amount: 42 }],
      () => `id${++n}`,
    );
    expect(out).toEqual([{ id: 'id1', description: 'Pizza', amount: 42, quantity: 1, sharedBy: [] }]);
  });

  it('modyfikatory stają się kosztami ogólnymi', () => {
    let n = 0;
    const out = receiptModifiersToGlobalCosts(
      [{ description: 'Serwis', type: 'percent', value: 10 }],
      () => `g${++n}`,
    );
    expect(out).toEqual([{ id: 'g1', description: 'Serwis', type: 'percent', value: 10 }]);
  });

  it('puste wejście nie wysypuje', () => {
    expect(receiptItemsToSharedCosts(null)).toEqual([]);
    expect(receiptModifiersToGlobalCosts(undefined)).toEqual([]);
  });
});

// ====================================================================
// AUDYT 2026-08-16 — uzgadnianie modyfikatorów z sumą paragonu.
//
// Pomiar na czternastu prawdziwych paragonach (tools/receipt-bench.mjs) wykazał trzy
// błędy, wszystkie ZANIŻAJĄCE rachunek i wszystkie w modyfikatorach, nie w pozycjach:
// rabat już wliczony w cenę odjęty drugi raz, cena po rabacie plus rabat osobno,
// oraz kwota podatku zgłoszona jako procent. Poniższe testy pilnują naprawy.
// ====================================================================
describe('uzgodnienie modyfikatorów z sumą paragonu', () => {
  it('rabat JUŻ UWZGLĘDNIONY w cenie nie jest odejmowany drugi raz', () => {
    // Rossmann: „NIVEA 2 x14,99 29,98" + „Uwzgl. rabat: -20,00", SUMA 29,98.
    // Bez tej reguły rachunek spadał do 9,98 zł.
    const out = normalizeReceipt({
      items: [{ name: 'Nivea Soft krem', quantity: 2, totalPrice: 29.98 }],
      modifiers: [{ kind: 'discount', name: 'Uwzgl. rabat', value: 20 }],
      receiptTotal: 29.98,
    });
    expect(out.modifiers).toEqual([]);
    expect(out.itemsTotal).toBe(29.98);
  });

  it('rabat, który NAPRAWDĘ jest potrącany, zostaje', () => {
    // Ten sam kształt danych, ale suma paragonu potwierdza potrącenie.
    const out = normalizeReceipt({
      items: [{ name: 'Bluzka', quantity: 1, totalPrice: 89.99 }],
      modifiers: [{ kind: 'discount', name: 'Rabat', value: 36 }],
      receiptTotal: 53.99,
    });
    expect(out.modifiers).toEqual([{ description: 'Rabat', type: 'amount', value: -36 }]);
  });

  it('kwota podatku zgłoszona jako procent jest czytana jako kwota', () => {
    // Petra Guest House: „Sales Tax 8% … 4.830" wróciło jako isPercent + value 4.83.
    // Jako procent dałoby 2,78 zamiast 4,83 — rachunek niższy o 2,05.
    const out = normalizeReceipt({
      items: [
        { name: 'Petra 5% 50cl', totalPrice: 7.5 },
        { name: 'Tea', totalPrice: 2 },
        { name: 'JR Classic', totalPrice: 33 },
        { name: 'Mezzeh', totalPrice: 8 },
        { name: 'Jagermeister', totalPrice: 7 },
      ],
      modifiers: [
        { kind: 'tax', name: 'Sales Tax 8%', isPercent: true, value: 4.83 },
        { kind: 'service', name: 'Service Charge', isPercent: false, value: 2.875 },
      ],
      receiptTotal: 65.205,
    });
    const sumG = toGrosze(out.itemsTotal)
      + out.modifiers.reduce((s, m) => s + (m.type === 'percent'
        ? Math.round(toGrosze(out.itemsTotal) * m.value / 100)
        : toGrosze(m.value)), 0);
    expect(sumG).toBe(toGrosze(out.receiptTotal));
    expect(out.modifiers.find((m) => /Sales Tax/.test(m.description)))
      .toEqual({ description: 'Sales Tax 8%', type: 'amount', value: 4.83 });
  });

  it('prawdziwy procent zostaje procentem, gdy to on domyka sumę', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Danie', totalPrice: 100 }],
      modifiers: [{ kind: 'service', name: 'Serwis 10%', isPercent: true, value: 10 }],
      receiptTotal: 110,
    });
    expect(out.modifiers).toEqual([{ description: 'Serwis 10%', type: 'percent', value: 10 }]);
  });

  it('podatek wliczony (PTU) wypada, bo bez niego suma się spina', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Pizza', totalPrice: 42 }, { name: 'Cola', totalPrice: 12 }],
      modifiers: [{ kind: 'tax', name: 'SP.OP.PTU A 8%', value: 4 }],
      receiptTotal: 54,
    });
    expect(out.modifiers).toEqual([]);
  });

  it('podatek doliczany (Sales Tax) zostaje, bo bez niego suma się nie spina', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Burger', totalPrice: 12 }, { name: 'Fries', totalPrice: 4 }],
      modifiers: [
        { kind: 'tax', name: 'Sales Tax', value: 1.32 },
        { kind: 'tip', name: 'Tip', value: 3 },
      ],
      receiptTotal: 20.32,
    });
    expect(out.modifiers).toHaveLength(2);
    expect(out.modifiers.map((m) => m.value)).toEqual([1.32, 3]);
  });

  it('gdy nic nie domyka sumy, modyfikatory zostają nietknięte', () => {
    // Przeoczona pozycja: nie wolno „naprawiać" tego kasowaniem prawdziwego napiwku.
    const out = normalizeReceipt({
      items: [{ name: 'Danie', totalPrice: 40 }],
      modifiers: [{ kind: 'tip', name: 'Napiwek', value: 5 }],
      receiptTotal: 95,
    });
    expect(out.modifiers).toEqual([{ description: 'Napiwek', type: 'amount', value: 5 }]);
  });

  it('bez sumy paragonu decyduje nazwa — PTU precz, napiwek zostaje', () => {
    const out = normalizeReceipt({
      items: [{ name: 'Pizza', totalPrice: 42 }],
      modifiers: [
        { kind: 'tax', name: 'PTU A 23%', value: 8 },
        { kind: 'tip', name: 'Napiwek', value: 5 },
      ],
      receiptTotal: null,
    });
    expect(out.modifiers).toEqual([{ description: 'Napiwek', type: 'amount', value: 5 }]);
  });
});
