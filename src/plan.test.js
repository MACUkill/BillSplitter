import { describe, it, expect } from 'vitest';
import { myPlanRows, planVsPairwise, myNetByCurrency } from './plan.js';
import { buildLedger } from './calc.js';

// Rachunek w kształcie, jakiego oczekuje buildLedger: płatnik potwierdzony, podział po równo.
const bill = (id, total, payerId, uczestnicy, currency = 'PLN') => ({
  id,
  billName: id,
  currency,
  totalAmount: total,
  payerId,
  payerConfirmed: true,
  globalCosts: [],
  sharedCosts: [],
  participants: Object.fromEntries(uczestnicy.map((p) => [p, { id: p, status: 'in' }])),
});

describe('myPlanRows — moje przelewy z najkrótszego planu', () => {
  it('kto jest na plusie, ten w planie zwykle nic nie płaci', () => {
    // Ja płacę za Boba (900 → Bob winien 450), Ala płaci za mnie (100 → ja winien 50).
    // Para po parze: mam jeden dług i jedną należność. W planie: Bob płaci Ali za mnie.
    const ledger = buildLedger([
      bill('b1', 900, 'ja', ['ja', 'bob']),
      bill('b2', 100, 'ala', ['ja', 'ala']),
    ], []);
    const [pln] = myPlanRows(ledger, 'ja');
    expect(pln.pay).toEqual([]);
    expect(pln.receiveTotalG).toBe(40000); // 450 − 50 = 400 zł
  });

  it('kto jest na minusie, ten dostaje konkretny przelew do zrobienia', () => {
    const ledger = buildLedger([
      bill('b1', 100, 'ja', ['ja', 'bob']),
      bill('b2', 900, 'ala', ['ja', 'ala']),
    ], []);
    const [pln] = myPlanRows(ledger, 'ja');
    expect(pln.receive).toEqual([]);
    expect(pln.payTotalG).toBe(40000);
  });

  it('SKALA: płatnik za piętnaście osób ma długą stronę „dostajesz", krótką „płacisz"', () => {
    // Realny przypadek właściciela: jeden wyjazd, jedna osoba płaci za wszystko.
    const ekipa = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const ledger = buildLedger([bill('b1', 1500, 'p0', ekipa)], []);
    const [pln] = myPlanRows(ledger, 'p0');
    expect(pln.pay).toEqual([]);
    expect(pln.receive).toHaveLength(14); // każdy oddaje osobno — nie da się krócej
    // Dlatego ekran pokazuje tę stronę JEDNĄ linią zbiorczą, a nie czternastoma wierszami.
    expect(pln.receiveTotalG).toBe(140000);
  });

  it('waluty nie mieszają się w jednym wpisie', () => {
    const ledger = buildLedger([
      bill('b1', 100, 'ja', ['ja', 'bob'], 'PLN'),
      bill('b2', 200, 'ja', ['ja', 'bob'], 'EUR'),
    ], []);
    const wiersze = myPlanRows(ledger, 'ja');
    expect(wiersze.map((w) => w.currency).sort()).toEqual(['EUR', 'PLN']);
    wiersze.forEach((w) => expect(w.pay).toEqual([]));
  });

  it('brak długów albo brak tożsamości nie wysypuje', () => {
    expect(myPlanRows({}, 'ja')).toEqual([]);
    expect(myPlanRows(null, 'ja')).toEqual([]);
    expect(myPlanRows(buildLedger([bill('b1', 100, 'ja', ['ja', 'bob'])], []), null)).toEqual([]);
  });
});

describe('planVsPairwise — liczby do zdania „N przelewów zamiast M"', () => {
  it('plan minimalny nigdy nie jest dłuższy od podziału para po parze', () => {
    const ledger = buildLedger([
      bill('b1', 900, 'ja', ['ja', 'bob', 'ala']),
      bill('b2', 300, 'ala', ['ja', 'ala', 'bob']),
      bill('b3', 150, 'bob', ['ja', 'bob']),
    ], []);
    const { plan, pairwise } = planVsPairwise(ledger);
    expect(plan).toBeGreaterThan(0);
    expect(plan).toBeLessThanOrEqual(pairwise);
  });

  it('przy piętnastu osobach i jednym płatniku obie liczby są równe — nie ma czego skracać', () => {
    const ekipa = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const { plan, pairwise } = planVsPairwise(buildLedger([bill('b1', 1500, 'p0', ekipa)], []));
    expect(plan).toBe(14);
    expect(pairwise).toBe(14);
  });
});

describe('myNetByCurrency — saldo jest takie samo w obu planach', () => {
  it('saldo z par równa się saldu z planu (niezmiennik, na którym stoi Bilans)', () => {
    const ledger = buildLedger([
      bill('b1', 900, 'ja', ['ja', 'bob']),
      bill('b2', 100, 'ala', ['ja', 'ala']),
    ], []);
    const zPar = myNetByCurrency(ledger, 'ja').PLN;
    const [pln] = myPlanRows(ledger, 'ja');
    expect(pln.receiveTotalG - pln.payTotalG).toBe(zPar);
  });

  it('rozliczone do zera nie zostawia waluty w wyniku', () => {
    expect(myNetByCurrency(buildLedger([], []), 'ja')).toEqual({});
  });
});
