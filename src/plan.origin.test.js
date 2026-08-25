// Pochodzenie wiersza „kto komu": rachunek czy sama wpłata poprowadzona inną trasą.
//
// Test odtwarza usterkę zgłoszoną 2026-08-25 na PRAWDZIWYM ledgerze, nie na wymyślonych
// krawędziach — bo cała jej istota polega na tym, że dwa widoki tych samych danych mówią
// co innego, i tylko przejście przez `buildLedger` to pokazuje.
import { describe, it, expect } from 'vitest';
import { buildLedger, simplifyDebts } from './calc.js';
import { netRowOrigin } from './plan.js';

// Kuba jest winien Markowi 50 (Kolacja), Marek jest winien Oli 50 (Taxi).
const bills = [
  {
    id: 'b1', billName: 'Kolacja', payerId: 'M', payerConfirmed: true,
    totalAmount: 100, currency: 'PLN',
    participants: { K: { id: 'K', name: 'Kuba' }, M: { id: 'M', name: 'Marek' } },
  },
  {
    id: 'b2', billName: 'Taxi', payerId: 'O', payerConfirmed: true,
    totalAmount: 100, currency: 'PLN',
    participants: { M: { id: 'M', name: 'Marek' }, O: { id: 'O', name: 'Ola' } },
  },
];

describe('netRowOrigin — wiersze widmo po wpłacie planem minimalnym', () => {
  it('przed wpłatą oba wiersze pochodzą z rachunków', () => {
    const { directed } = buildLedger(bills, []).PLN;
    expect(netRowOrigin(directed, 'K', 'M')).toBe('bill');
    expect(netRowOrigin(directed, 'M', 'O')).toBe('bill');
  });

  it('plan minimalny każe Kubie zapłacić Oli — i to jest poprawne', () => {
    const plan = simplifyDebts(buildLedger(bills, []).PLN.directed);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ from: 'K', to: 'O', amountG: 5000 });
  });

  it('po wpłacie zgodnej z planem saldo jest zerowe, a plan minimalny pusty', () => {
    const settlements = [{ id: 's1', from: 'K', to: 'O', amount: 50, currency: 'PLN' }];
    const { directed } = buildLedger(bills, settlements).PLN;
    expect(simplifyDebts(directed)).toHaveLength(0);
  });

  it('ALE „kto komu" pokazuje wtedy trzy otwarte długi — to jest ta usterka', () => {
    const settlements = [{ id: 's1', from: 'K', to: 'O', amount: 50, currency: 'PLN' }];
    const { net } = buildLedger(bills, settlements).PLN;
    expect(net).toHaveLength(3);
  });

  it('i tylko JEDEN z nich nie pochodzi z żadnego rachunku', () => {
    const settlements = [{ id: 's1', from: 'K', to: 'O', amount: 50, currency: 'PLN' }];
    const { directed } = buildLedger(bills, settlements).PLN;
    // Ola „winna" Kubie 50 — powstało wyłącznie z krawędzi odwrotnej po jego wpłacie.
    expect(netRowOrigin(directed, 'O', 'K')).toBe('payment');
    // Dwa pozostałe stoją na prawdziwych rachunkach i wolno je pokazywać jak dotąd.
    expect(netRowOrigin(directed, 'K', 'M')).toBe('bill');
    expect(netRowOrigin(directed, 'M', 'O')).toBe('bill');
  });

  it('dług z rachunku spłacony CZĘŚCIOWO zostaje długiem z rachunku', () => {
    // Wpłata w tę samą parę nie może zamienić prawdziwego długu w wiersz widmo.
    const settlements = [{ id: 's1', from: 'K', to: 'M', amount: 20, currency: 'PLN' }];
    const { directed } = buildLedger(bills, settlements).PLN;
    expect(netRowOrigin(directed, 'K', 'M')).toBe('bill');
  });

  it('kółko długów z SAMYCH rachunków nie jest widmem — niczego nie ukrywamy', () => {
    // Trzy rachunki domykające się w cykl, zero wpłat. Salda zerowe, plan minimalny pusty,
    // ale każdy z tych długów jest prawdziwy i ma swoje „za co”.
    const cycle = [
      { id: 'c1', billName: 'A', payerId: 'M', payerConfirmed: true, totalAmount: 100, currency: 'PLN',
        participants: { K: { id: 'K' }, M: { id: 'M' } } },
      { id: 'c2', billName: 'B', payerId: 'O', payerConfirmed: true, totalAmount: 100, currency: 'PLN',
        participants: { M: { id: 'M' }, O: { id: 'O' } } },
      { id: 'c3', billName: 'C', payerId: 'K', payerConfirmed: true, totalAmount: 100, currency: 'PLN',
        participants: { O: { id: 'O' }, K: { id: 'K' } } },
    ];
    const { directed, net } = buildLedger(cycle, []).PLN;
    expect(net).toHaveLength(3);
    expect(simplifyDebts(directed)).toHaveLength(0);
    net.forEach((t) => expect(netRowOrigin(directed, t.from, t.to)).toBe('bill'));
  });

  it('nieznana para nie wywraca funkcji', () => {
    expect(netRowOrigin([], 'X', 'Y')).toBe('none');
    expect(netRowOrigin(null, 'X', 'Y')).toBe('none');
  });
});
