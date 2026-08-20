import { describe, it, expect } from 'vitest';
import { calculateAll, toGrosze } from './calc.js';

// ROZPISKA UDZIAŁU MUSI SIĘ ZGADZAĆ Z KWOTĄ (zgłoszenie właściciela 2026-08-20).
//
// Ekran obiecuje pod „Twój udział" podpis „Z czego się składa" i wypisuje składniki.
// Do 2026-08-20 wypisywał trzy z czterech — brakowało udziału w kwocie, której nikt nie
// wziął na siebie — więc na rachunku zaraz po odczycie paragonu rozpiska pokazywała same
// zera nad kwotą 40,00. Te testy pilnują dwóch rzeczy naraz:
//   1. składniki rozpiski sumują się do kwoty do zapłaty (inaczej podpis kłamie),
//   2. `orphanCount` / `orphanAmount` / `itemCount` niosą dość, żeby ekran wybrał
//      WŁAŚCIWY podpis wiersza, bo „nikt nie wziął" i „reszta rachunku" to dwie różne
//      wiadomości dla czytającego.

const dwieOsoby = () => ({
  ala: { id: 'ala', name: 'Ala', status: 'completed', individualAmount: 0 },
  bob: { id: 'bob', name: 'Bob', status: 'completed', individualAmount: 0 },
});

describe('składniki rozpiski sumują się do kwoty do zapłaty', () => {
  const przypadki = [
    {
      nazwa: 'pozycje, koszt własny i osierocona reszta naraz',
      bill: {
        id: 'b1', currency: 'PLN', totalAmount: 200, payerId: 'ala', payerConfirmed: true,
        globalCosts: [{ id: 'g1', description: 'Napiwek', type: 'amount', value: 10 }],
        participants: {
          ala: { id: 'ala', name: 'Ala', status: 'completed', individualAmount: 30 },
          bob: { id: 'bob', name: 'Bob', status: 'completed', individualAmount: 0 },
        },
        sharedCosts: [
          { id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] },
          { id: 'i2', description: 'Wino', amount: 40, sharedBy: [] },
        ],
      },
    },
    {
      nazwa: 'rachunek bez ani jednej pozycji, czyli cała kwota po równo',
      bill: {
        id: 'b2', currency: 'PLN', totalAmount: 80, payerId: 'ala', payerConfirmed: true,
        globalCosts: [], participants: dwieOsoby(), sharedCosts: [],
      },
    },
    {
      nazwa: 'wszystko rozpisane, reszta zerowa',
      bill: {
        id: 'b3', currency: 'PLN', totalAmount: 100, payerId: 'ala', payerConfirmed: true,
        globalCosts: [], participants: dwieOsoby(),
        sharedCosts: [{ id: 'i1', description: 'Pizza', amount: 100, sharedBy: ['ala', 'bob'] }],
      },
    },
  ];

  przypadki.forEach(({ nazwa, bill }) => {
    it(nazwa, () => {
      const { participantTotals } = calculateAll(bill);
      participantTotals.forEach((pt) => {
        const suma = pt.sharedAmount + pt.globalCostsAmount + pt.individualAmount + pt.restAmount;
        // Do `exactTotal`, nie do `total`: kwota do zapłaty jest zaokrąglona w GÓRĘ do
        // grosza, więc może być o grosz wyższa od sumy dokładnych składników. Ekran
        // pokazuje składniki z dokładnością do grosza, więc różnica jest niewidoczna,
        // ale test nie ma prawa jej przemilczeć.
        expect(suma).toBeCloseTo(pt.exactTotal, 6);
        expect(toGrosze(pt.total)).toBeGreaterThanOrEqual(Math.floor(toGrosze(suma)));
      });
    });
  });
});

describe('źródło kwoty nierozpisanej da się rozpoznać z wyniku', () => {
  it('same pozycje bez chętnego: cała reszta to osierocone pozycje', () => {
    const wynik = calculateAll({
      id: 'b1', currency: 'PLN', totalAmount: 100, payerId: 'ala', payerConfirmed: true,
      globalCosts: [], participants: dwieOsoby(),
      sharedCosts: [
        { id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] },
        { id: 'i2', description: 'Wino', amount: 40, sharedBy: [] },
      ],
    });
    expect(wynik.itemCount).toBe(2);
    expect(wynik.orphanCount).toBe(1);
    expect(wynik.orphanAmount).toBe(40);
    // Równość obu liczb to sygnał dla ekranu, żeby napisać „Nikt nie wziął" — czyli
    // podpis, po którym wiadomo, że wystarczy stuknąć pozycję na paragonie.
    expect(wynik.orphanAmount).toBe(wynik.unallocated);
  });

  it('pozycje wpisane, ale nie spinają się z kwotą rachunku: brak sierot', () => {
    const wynik = calculateAll({
      id: 'b2', currency: 'PLN', totalAmount: 100, payerId: 'ala', payerConfirmed: true,
      globalCosts: [], participants: dwieOsoby(),
      sharedCosts: [{ id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] }],
    });
    expect(wynik.itemCount).toBe(1);
    expect(wynik.orphanCount).toBe(0);
    expect(wynik.orphanAmount).toBe(0);
    expect(wynik.unallocated).toBe(40); // 100 z rachunku minus 60 wpisane
  });

  it('rachunek bez pozycji: nie ma czego stukać, więc nie ma też sierot', () => {
    const wynik = calculateAll({
      id: 'b3', currency: 'PLN', totalAmount: 80, payerId: 'ala', payerConfirmed: true,
      globalCosts: [], participants: dwieOsoby(), sharedCosts: [],
    });
    expect(wynik.itemCount).toBe(0);
    expect(wynik.orphanCount).toBe(0);
    expect(wynik.unallocated).toBe(80);
    // `itemCount === 0` to warunek, po którym ekran MILCZY zamiast pisać „na razie".
    // Podział po równo jest tu całą treścią rachunku, a nie stanem przejściowym.
  });

  it('sieroty i niedobór naraz: osierocone to tylko część reszty', () => {
    const wynik = calculateAll({
      id: 'b4', currency: 'PLN', totalAmount: 150, payerId: 'ala', payerConfirmed: true,
      globalCosts: [], participants: dwieOsoby(),
      sharedCosts: [
        { id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] },
        { id: 'i2', description: 'Wino', amount: 40, sharedBy: [] },
      ],
    });
    expect(wynik.orphanCount).toBe(1);
    expect(wynik.orphanAmount).toBe(40);
    expect(wynik.unallocated).toBe(90); // 40 osierocone + 50 niewpisane
    expect(wynik.orphanAmount).toBeLessThan(wynik.unallocated);
  });

  it('pozycja wzięta wyłącznie przez osobę „nie dotyczy" liczy się jako sierota', () => {
    const wynik = calculateAll({
      id: 'b5', currency: 'PLN', totalAmount: 100, payerId: 'ala', payerConfirmed: true,
      globalCosts: [],
      participants: {
        ala: { id: 'ala', name: 'Ala', status: 'completed', individualAmount: 0 },
        bob: { id: 'bob', name: 'Bob', status: 'completed', individualAmount: 0 },
        cyd: { id: 'cyd', name: 'Cyd', status: 'not_applicable', individualAmount: 0 },
      },
      sharedCosts: [
        { id: 'i1', description: 'Pizza', amount: 60, sharedBy: ['ala', 'bob'] },
        { id: 'i2', description: 'Piwo', amount: 40, sharedBy: ['cyd'] },
      ],
    });
    expect(wynik.orphanCount).toBe(1);
    expect(wynik.orphanAmount).toBe(40);
  });
});
