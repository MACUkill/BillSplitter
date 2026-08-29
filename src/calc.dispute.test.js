import { describe, it, expect } from 'vitest';
import { buildLedger, settlementCountsInLedger } from './calc.js';
import { billLedger, myBillsToPay } from './perbill.js';

// STRAŻNIK JEDNEJ REGUŁY: sporna i wycofana wpłata NIE gasi długu.
//
// Dlaczego to jest osobny plik i dlaczego jest ważny: to jedyne miejsce, w którym
// odpowiedź „nie widzę tego przelewu" zamienia się w pieniądze. Gdyby filtr wypadł
// z jednej z dwóch ksiąg, Bilans i zakładka Rozliczeń pokazywałyby dwie różne kwoty
// dla tej samej pary ludzi — a przy cudzych pieniądzach to nie jest nieścisłość.

const bill = (id, totalAmount, payerId, people, { currency = 'PLN', at = 0 } = {}) => ({
  id,
  billName: id,
  totalAmount,
  currency,
  payerId,
  payerConfirmed: true,
  createdAtMs: at,
  participants: Object.fromEntries(people.map((pid) => [pid, { id: pid, status: 'unpaid' }])),
});

const pay = (id, from, to, amount, extra = {}) => ({
  id, from, to, amount, currency: 'PLN', createdAtMs: 0, ...extra,
});

// Ala wyłożyła 100 za siebie i Bartka → Bartek jest jej winien 50.
const dwieOsoby = () => [bill('r1', 100, 'ala', ['ala', 'bartek'])];
const dlugBartkaG = (ledger) => {
  const cur = ledger.PLN;
  if (!cur) return 0;
  const edge = cur.net.find((n) => (n.from === 'bartek' && n.to === 'ala'));
  return edge ? edge.amountG : 0;
};

describe('settlementCountsInLedger', () => {
  it('wpłata bez pól stanu liczy się — tak wyglądają WSZYSTKIE wpłaty sprzed zmiany', () => {
    expect(settlementCountsInLedger({ from: 'a', to: 'b', amount: 10 })).toBe(true);
  });

  it('potwierdzenie NIE jest warunkiem: niepotwierdzona liczy się tak samo', () => {
    expect(settlementCountsInLedger({ confirmed: false })).toBe(true);
    expect(settlementCountsInLedger({ confirmed: true })).toBe(true);
  });

  it('sporna i wycofana nie liczą się', () => {
    expect(settlementCountsInLedger({ disputed: true })).toBe(false);
    expect(settlementCountsInLedger({ withdrawn: true })).toBe(false);
  });

  // `disputed: false` musi znaczyć to samo, co brak pola — inaczej cofnięcie sporu
  // („Jednak mam") zostawiałoby wpłatę poza saldem na zawsze.
  it('disputed: false po cofnięciu sporu przywraca wpłatę do salda', () => {
    expect(settlementCountsInLedger({ disputed: false })).toBe(true);
  });

  it('nie wywala się na pustce', () => {
    expect(settlementCountsInLedger(null)).toBe(false);
    expect(settlementCountsInLedger(undefined)).toBe(false);
  });
});

describe('buildLedger — spór cofa dług na saldo', () => {
  it('zgłoszona wpłata gasi dług, choć nikt jej nie potwierdził', () => {
    const ledger = buildLedger(dwieOsoby(), [pay('s1', 'bartek', 'ala', 50)]);
    expect(dlugBartkaG(ledger)).toBe(0);
  });

  it('po „Nie widzę" dług wraca w całości', () => {
    const ledger = buildLedger(dwieOsoby(), [pay('s1', 'bartek', 'ala', 50, { disputed: true })]);
    expect(dlugBartkaG(ledger)).toBe(5000);
  });

  it('po wycofaniu przez nadawcę dług też wraca', () => {
    const ledger = buildLedger(dwieOsoby(), [pay('s1', 'bartek', 'ala', 50, { withdrawn: true })]);
    expect(dlugBartkaG(ledger)).toBe(5000);
  });

  it('„Jednak mam" (disputed cofnięte, confirmed) znowu gasi dług', () => {
    const ledger = buildLedger(dwieOsoby(), [
      pay('s1', 'bartek', 'ala', 50, { disputed: false, confirmed: true }),
    ]);
    expect(dlugBartkaG(ledger)).toBe(0);
  });

  // Podtrzymanie nadawcy („Wysłałem na pewno") NIE przywraca wpłaty do salda —
  // aplikacja nie rozstrzyga sporu, więc dopóki odbiorca nie potwierdzi, pieniędzy nie ma.
  it('podtrzymanie nadawcy nie wraca do salda samo z siebie', () => {
    const ledger = buildLedger(dwieOsoby(), [
      pay('s1', 'bartek', 'ala', 50, { disputed: true, insisted: true }),
    ]);
    expect(dlugBartkaG(ledger)).toBe(5000);
  });

  it('spór jednej wpłaty nie rusza pozostałych', () => {
    const ledger = buildLedger([bill('r1', 200, 'ala', ['ala', 'bartek'])], [
      pay('s1', 'bartek', 'ala', 40, { disputed: true }),
      pay('s2', 'bartek', 'ala', 60),
    ]);
    expect(dlugBartkaG(ledger)).toBe(4000); // 100 udziału − 60 nienaruszonej wpłaty
  });
});

describe('billLedger — ta sama reguła rachunek po rachunku', () => {
  it('sporna wpłata otwiera rachunek z powrotem', () => {
    const bills = dwieOsoby();
    const otwarte = (settlements) => myBillsToPay(billLedger(bills, settlements), 'bartek')
      .reduce((s, r) => s + r.openG, 0);

    expect(otwarte([pay('s1', 'bartek', 'ala', 50)])).toBe(0);
    expect(otwarte([pay('s1', 'bartek', 'ala', 50, { disputed: true })])).toBe(5000);
    expect(otwarte([pay('s1', 'bartek', 'ala', 50, { withdrawn: true })])).toBe(5000);
  });

  // Wpłata sporna nie może wylądować w „bez przypisania" — dla księgi jej nie ma
  // w ogóle, więc nie ma też czego przyznawać w linii uzgadniającej.
  it('sporna wpłata nie trafia do „bez przypisania"', () => {
    const res = billLedger(dwieOsoby(), [
      pay('s1', 'bartek', 'ala', 500, { disputed: true }), // dziesięć razy za dużo
    ]);
    expect(res.unassigned).toEqual([]);
  });

  it('obie księgi mówią to samo o tej samej spornej wpłacie', () => {
    const bills = dwieOsoby();
    const settlements = [pay('s1', 'bartek', 'ala', 50, { disputed: true })];
    const zRachunkow = myBillsToPay(billLedger(bills, settlements), 'bartek')
      .reduce((s, r) => s + r.openG, 0);
    expect(zRachunkow).toBe(dlugBartkaG(buildLedger(bills, settlements)));
  });
});
