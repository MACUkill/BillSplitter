import { describe, it, expect } from 'vitest';
import { calculateAll, billSettleGate, billCountsInLedger, billSplitMode } from './calc.js';

// BRAMA ROZLICZEŃ. Pilnuje PIENIĘDZY, nie ludzi: rachunek wolno regulować dopiero wtedy,
// gdy żadna złotówka nie wisi bez właściciela. Testy trzymają dwie obietnice naraz —
// sumienny nie dopłaca za spóźnialskiego, a stare rachunki działają jak działały.

const osoba = (id, extra = {}) => ({ id, name: id, status: 'in', individualAmount: 0, ...extra });

const rachunek = (extra = {}) => ({
  totalAmount: 300,
  currency: 'PLN',
  payerId: 'michal',
  payerConfirmed: true,
  splitMode: 'own',
  gated: true,
  participants: {
    michal: osoba('michal'), ania: osoba('ania'), kuba: osoba('kuba'),
    ola: osoba('ola'), piotr: osoba('piotr'), zosia: osoba('zosia'),
  },
  // 6 dań po 40 + wino 40 = 280 pozycji, serwis 20 jako koszt ogólny.
  sharedCosts: [
    { id: 'd1', description: 'Danie', amount: 40, sharedBy: ['michal'] },
    { id: 'd2', description: 'Danie', amount: 40, sharedBy: ['ania'] },
    { id: 'd3', description: 'Danie', amount: 40, sharedBy: ['piotr'] },
    { id: 'd4', description: 'Danie', amount: 40, sharedBy: ['zosia'] },
    { id: 'd5', description: 'Danie', amount: 40, sharedBy: [] },  // Kuba nie stuknął
    { id: 'd6', description: 'Danie', amount: 40, sharedBy: [] },  // Ola nie stuknęła
    { id: 'w1', description: 'Wino', amount: 40, sharedBy: [] },   // wspólne, nikt nie wziął
  ],
  globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 20 }],
  ...extra,
});

const udzial = (wynik, id) => wynik.participantTotals.find((pt) => pt.participant.id === id).total;

describe('billSettleGate — kiedy wolno się rozliczać', () => {
  it('rachunek z kwotą wiszącą bez właściciela jest zamknięty', () => {
    const gate = billSettleGate(rachunek());
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('rest');
    expect(gate.needsDecision).toBe(true);
    expect(gate.unallocatedG).toBe(12000); // 2 dania + wino
  });

  it('rachunek rozpisany co do grosza otwiera się SAM, bez niczyjego zatwierdzenia', () => {
    const b = rachunek();
    // Obaj spóźnialscy biorą pozostałe pozycje — inaczej Ola zostaje z udziałem zerowym
    // i brama słusznie się nie otwiera (patrz reguła „każdy ma stawkę" niżej).
    b.sharedCosts = b.sharedCosts.map((it) => (
      it.sharedBy.length ? it : { ...it, sharedBy: ['kuba', 'ola'] }
    ));
    const gate = billSettleGate(b);
    expect(gate.open).toBe(true);
    expect(gate.reason).toBe('exact');
  });

  it('tryb „po równo" nie ma bramy — scena przy stole zostaje nietknięta', () => {
    const b = rachunek({ splitMode: 'even', sharedCosts: [], globalCosts: [] });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('even');
  });

  it('stary rachunek bez pola `gated` działa jak dawniej', () => {
    const b = rachunek();
    delete b.gated;
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('legacy');
  });

  it('nadwyżka pozycji nad kwotą rachunku BLOKUJE zamknięcie', () => {
    // Bez tego warunku `unallocated` wynosi zero i brama otwierałaby się na rachunku,
    // na którym wszyscy przepłacają.
    const b = rachunek({ totalAmount: 100 });
    const gate = billSettleGate(b);
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('over');
  });

  it('po zamknięciu ręcznym brama stoi otworem', () => {
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('closed');
  });

  it('pozycja dopisana PO zamknięciu zamyka bramę z powrotem', () => {
    // Inaczej nieodklikana nowość rozdzieliłaby się po cichu — czyli ten sam błąd
    // tylnymi drzwiami.
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    b.totalAmount = 350;
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    const gate = billSettleGate(b);
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('changed');
  });

  it('grosz różnicy z procentowego kosztu ogólnego nie zamyka bramy', () => {
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 11999 });
    expect(billSettleGate(b).open).toBe(true);
  });
});

// Rachunek zamknięty ręcznie: decyzja o reszcie zapadła i dopiero teraz reszta wchodzi
// do udziałów. Do 2026-08-26 wchodziła od pierwszej sekundy („na razie po równo").
const zamkniety = (extra = {}) => rachunek({
  settleOpen: true, everOpened: true, restSettledG: 12000, ...extra,
});

describe('reszta jest NICZYJA, dopóki nikt o niej nie zdecyduje', () => {
  it('kto nic nie stuknął, ma udział 0 — nie „na razie po równo"', () => {
    const w = calculateAll(rachunek());
    // Kuba nie wziął ani jednej pozycji. Zostaje mu sam koszt ogólny (serwis 20/6).
    expect(udzial(w, 'kuba')).toBeCloseTo(3.34, 2);
    expect(w.restDecided).toBe(false);
  });

  it('kto stuknął swoje, płaci DOKŁADNIE swoje — bez dopłaty za spóźnialskich', () => {
    const w = calculateAll(rachunek());
    expect(udzial(w, 'ania')).toBeCloseTo(43.34, 2); // danie 40 + serwis 3,34
  });

  it('nierozpisana kwota jest widoczna, choć nie należy do nikogo', () => {
    const w = calculateAll(rachunek());
    expect(w.unallocated).toBeCloseTo(120, 2);
    expect(w.perPersonUnallocated).toBe(0);
    expect(w.restToIds).toEqual([]);
  });

  it('stary rachunek dzieli resztę jak dawniej — aktualizacja nie rusza mu kwot', () => {
    const b = rachunek();
    delete b.gated;
    const w = calculateAll(b);
    expect(udzial(w, 'ania')).toBeCloseTo(63.34, 2);
    expect(w.restDecided).toBe(true);
  });

  it('tryb „po równo" dzieli od razu — tam reszta JEST treścią rachunku', () => {
    const w = calculateAll(rachunek({ splitMode: 'even', sharedCosts: [], globalCosts: [] }));
    expect(udzial(w, 'kuba')).toBeCloseTo(50, 2);
    expect(w.restDecided).toBe(true);
  });
});

describe('restTo — komu przypada kwota nierozpisana po decyzji płatnika', () => {
  it('bez `restTo` reszta idzie po równo na wszystkich aktywnych', () => {
    const w = calculateAll(zamkniety());
    // 120 / 6 = 20 na osobę; Ania: danie 40 + reszta 20 + serwis 3,34 (w górę)
    expect(udzial(w, 'ania')).toBeCloseTo(63.34, 2);
    expect(udzial(w, 'kuba')).toBeCloseTo(23.34, 2);
    expect(w.restToEveryone).toBe(true);
  });

  it('`restTo` przerzuca resztę na wskazanych — sumienny przestaje dopłacać', () => {
    const w = calculateAll(zamkniety({ restTo: ['kuba', 'ola'] }));
    // 120 / 2 = 60 dla Kuby i Oli; Ania płaci już tylko swoje danie + serwis.
    expect(udzial(w, 'ania')).toBeCloseTo(43.34, 2);
    expect(udzial(w, 'kuba')).toBeCloseTo(63.34, 2);
    expect(w.restToEveryone).toBe(false);
    expect(w.restToIds).toEqual(['kuba', 'ola']);
  });

  it('suma udziałów pokrywa ZAMKNIĘTY rachunek — płatnik nigdy stratny', () => {
    [undefined, ['kuba', 'ola'], ['kuba']].forEach((restTo) => {
      const w = calculateAll(zamkniety({ restTo }));
      expect(w.controlSum).toBeGreaterThanOrEqual(300);
    });
  });

  it('osoba wypisana z rachunku wypada z listy niosącej resztę', () => {
    const b = zamkniety({ restTo: ['kuba', 'ola'] });
    b.participants.ola.status = 'not_applicable';
    const w = calculateAll(b);
    expect(w.restToIds).toEqual(['kuba']);
    expect(udzial(w, 'ola')).toBe(0);
  });

  it('gdy WSZYSCY wskazani wypadli, decyzja traci moc i reszta znów jest niczyja', () => {
    // AUDYT 2026-08-26. Wcześniej reszta wracała po cichu do wszystkich aktywnych:
    // płatnik rozstrzygnął „to jedzenie Kuby", Kuba wypadł ze składu, a 120 zł przechodziło
    // na pozostałych — bez słowa, przy otwartej bramie i czynnych przelewach.
    const b = zamkniety({ restTo: ['kuba', 'ola'] });
    b.participants.kuba.status = 'not_applicable';
    b.participants.ola.status = 'not_applicable';
    const w = calculateAll(b);
    // Ani grosza nierozpisanego nikomu — udziały zmienią się tylko o koszty wspólne,
    // które i tak dzielą się przez mniejszą liczbę osób.
    w.participantTotals.forEach((pt) => expect(pt.restAmount).toBe(0));
    expect(w.restUndecided).toBeCloseTo(w.unallocated, 2);
    expect(w.restToIds).toEqual([]);
    expect(w.restDecided).toBe(false);
    expect(billSettleGate(b).open).toBe(false); // brama pyta o decyzję jeszcze raz
  });

  it('gdy została CHOĆ JEDNA wskazana osoba, decyzja obowiązuje dalej', () => {
    const b = zamkniety({ restTo: ['kuba', 'ola'] });
    b.participants.ola.status = 'not_applicable';
    const w = calculateAll(b);
    expect(w.restToIds).toEqual(['kuba']);
    expect(billSettleGate(b).open).toBe(true);
  });

  it('ZAMKNIĘCIE PO ZMIANIE ROZSTRZYGA CAŁOŚĆ — inaczej rachunku nie da się już zamknąć', () => {
    // BŁĄD BLOKUJĄCY, znaleziony audytem 2026-08-26. Arkusz zapisywał jako `restSettledG`
    // kwotę NICZYJĄ (samą nadwyżkę), a `decidedRestGrosze` porównuje ją z CAŁYM
    // nierozpisanym. Decyzja obejmowała więc 50 zł z wiszących 170 i brama wracała na
    // miejsce natychmiast po zamknięciu — płatnik, który poprawił własny rachunek,
    // blokował ekipie przelewy na zawsze.
    const b = zamkniety();
    b.totalAmount = 350;
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    expect(billSettleGate(b).reason).toBe('changed');

    // Tak zamyka arkusz: całe nierozpisane, nie sama nadwyżka.
    const poZamknieciu = { ...b, restSettledG: Math.round(calculateAll(b).unallocated * 100) };
    const gate = billSettleGate(poZamknieciu);
    expect(gate.open).toBe(true);
    expect(gate.reason).toBe('closed');
    expect(calculateAll(poZamknieciu).restUndecided).toBe(0);
  });

  it('pozycja dopisana po zamknięciu nie cofa decyzji — niczyja jest tylko NADWYŻKA', () => {
    // Cofnięcie zabrałoby udział ludziom, którzy zdążyli już na jego podstawie zapłacić,
    // i zrobiłoby z tego dług płatnika wobec nich.
    const b = zamkniety();
    b.totalAmount = 350;
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    const w = calculateAll(b);
    expect(w.restDecided).toBe(false);
    expect(w.restUndecided).toBeCloseTo(50, 2);      // sam deser czeka na decyzję
    expect(w.perPersonUnallocated).toBeCloseTo(20, 2); // stara decyzja stoi: 120 / 6
    expect(udzial(w, 'kuba')).toBeCloseTo(23.34, 2);   // udział NIE spadł
  });
});

describe('billCountsInLedger — co wchodzi do księgi długów', () => {
  it('rachunek przed pierwszym otwarciem bramy NIE wchodzi', () => {
    expect(billCountsInLedger(rachunek())).toBe(false);
  });

  it('rachunek raz otwarty zostaje w księdze, nawet gdy brama się zamknie', () => {
    // Ktoś mógł już zapłacić. Wypadnięcie z księgi zostawiłoby wpłatę bez długu,
    // czyli fałszywy dług w drugą stronę.
    const b = rachunek({ settleOpen: true, everOpened: true, restSettledG: 12000 });
    b.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    b.totalAmount = 350;
    expect(billSettleGate(b).open).toBe(false);
    expect(billCountsInLedger(b)).toBe(true);
  });

  it('stary rachunek wchodzi zawsze', () => {
    const b = rachunek();
    delete b.gated;
    expect(billCountsInLedger(b)).toBe(true);
  });
});

describe('billSplitMode — jedno źródło prawdy', () => {
  it('czyta pole, gdy jest', () => {
    expect(billSplitMode({ splitMode: 'own' })).toBe('own');
    expect(billSplitMode({ splitMode: 'even' })).toBe('even');
  });

  it('bez pola wnioskuje z zawartości', () => {
    expect(billSplitMode({ sharedCosts: [{ id: 'a', amount: 10 }] })).toBe('own');
    expect(billSplitMode({ participants: { a: { individualAmount: 5 } } })).toBe('own');
    expect(billSplitMode({})).toBe('even');
  });
});

// NAJDROŻSZA POMYŁKA, JAKĄ TA ZMIANA MOGŁABY WPROWADZIĆ: wpłata bez długu po drugiej
// stronie. `buildLedger` dokłada wtedy krawędź ODWROTNĄ, czyli pokazuje dług w drugą
// stronę — ktoś mógłby w dobrej wierze upomnieć się o pieniądze, których nie jest winien.
// To ta sama rodzina usterek, co „wiersz widmo" opisany w src/plan.js.
describe('rachunek wypadający z księgi nie może osierocić wpłaty', () => {
  const zamkniety = () => rachunek({
    id: 'b1', settleOpen: true, everOpened: true, restSettledG: 12000,
  });

  it('wpłata za zamknięty rachunek gasi dług, a nie tworzy długu w drugą stronę', async () => {
    const { buildLedger } = await import('./calc.js');
    const bill = zamkniety();
    const wynik = calculateAll(bill);
    const udzialKuby = wynik.participantTotals.find((pt) => pt.participant.id === 'kuba').total;
    const ledger = buildLedger([bill], [
      { from: 'kuba', to: 'michal', amount: udzialKuby, currency: 'PLN' },
    ]);
    const net = (ledger.PLN && ledger.PLN.net) || [];
    const kubaMichal = net.filter((t) => (t.from === 'kuba' && t.to === 'michal') || (t.from === 'michal' && t.to === 'kuba'));
    expect(kubaMichal).toEqual([]);
  });

  it('rachunek zamknięty, potem znów otwarty, NADAL liczy się w księdze', async () => {
    const { buildLedger } = await import('./calc.js');
    const bill = zamkniety();
    bill.totalAmount = 350;
    bill.sharedCosts.push({ id: 'd7', description: 'Deser', amount: 50, sharedBy: [] });
    expect(billSettleGate(bill).open).toBe(false);
    // Gdyby wypadł, sama wpłata zostawiłaby Michała „winnego" Kubie.
    const bills = [bill].filter(billCountsInLedger);
    const ledger = buildLedger(bills, [{ from: 'kuba', to: 'michal', amount: 20, currency: 'PLN' }]);
    const odwrotny = ((ledger.PLN && ledger.PLN.net) || []).find((t) => t.from === 'michal' && t.to === 'kuba');
    expect(odwrotny).toBeUndefined();
  });
});

// AUDYT 2026-08-26 — stany, w których dane z bazy przeczą temu, co mówi ekran.
describe('brama a przestawienie trybu podziału', () => {
  it('„po równo" dzieli po równo, nawet gdy rachunek nosi starą decyzję o reszcie', () => {
    // Płatnik zamknął rachunek w trybie „ze swoimi kosztami" (reszta dla Kuby), a potem
    // przestawił tryb na „po równo". Bez tego warunku całe 300 zł szło dalej Kubie —
    // przy otwartej bramie, więc te kwoty dało się przelać.
    const b = rachunek({
      splitMode: 'even', sharedCosts: [], globalCosts: [],
      settleOpen: true, everOpened: true, restSettledG: 30000, restTo: ['kuba'],
    });
    const w = calculateAll(b);
    expect(w.restToEveryone).toBe(true);
    expect(udzial(w, 'ania')).toBeCloseTo(50, 2);
    expect(udzial(w, 'kuba')).toBeCloseTo(50, 2);
  });
});

// ====================================================================================
// AUDYT 2026-08-26, PRZEJŚCIE DRUGIE. Trzy stany, w których brama stała otworem albo
// znikała, choć pieniądze już się przesuwały.
// ====================================================================================

describe('nadwyżka blokuje bramę TAKŻE w trybie „po równo"', () => {
  // Warunek `over` stał niżej niż wyjście dla trybu „po równo", więc omijał tryb, w którym
  // startuje KAŻDY nowy rachunek. Koszty wspólne działają w obu trybach — wystarczyło wpisać
  // „200" zamiast „20" przy rachunku na 100 zł.
  const poRownoZNadwyzka = () => rachunek({
    splitMode: 'even',
    totalAmount: 100,
    sharedCosts: [],
    globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 200 }],
  });

  it('koszt wspólny większy niż kwota rachunku zamyka bramę', () => {
    const gate = billSettleGate(poRownoZNadwyzka());
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('over');
    expect(gate.diff).toBe(100);
  });

  it('bez tego cała ekipa przelewałaby po 33,34 za rachunek, który kosztował 100', () => {
    // Sześć osób po 33,34 to 200,04 przy rachunku na 100 — liczba wprost z sondy audytowej.
    const w = calculateAll(poRownoZNadwyzka());
    expect(udzial(w, 'ania')).toBeCloseTo(33.34, 2);
    expect(w.controlSum).toBeGreaterThan(100);
  });

  it('rachunek „po równo", który się spina, dalej nie ma bramy', () => {
    const b = rachunek({
      splitMode: 'even', totalAmount: 300, sharedCosts: [],
      globalCosts: [{ id: 'g1', description: 'Serwis', type: 'amount', value: 20 }],
    });
    expect(billSettleGate(b).reason).toBe('even');
    expect(billSettleGate(b).open).toBe(true);
  });
});

describe('rachunek otwarty SAM Z SIEBIE też musi zostać w księdze', () => {
  // Brama otwiera się na trzy sposoby, a `everOpened` stawiało tylko ręczne zamknięcie.
  // Rachunek rozpisany co do grosza ('exact') nosił więc `everOpened: false`, choć cała
  // ekipa mogła już z niego płacić — i wypadał z księgi przy pierwszej zmianie.
  const rozpisanyCoDoGrosza = (extra = {}) => ({
    id: 'b1',
    billName: 'Sushi',
    totalAmount: 300, currency: 'PLN', payerId: 'michal', payerConfirmed: true,
    splitMode: 'own', gated: true, settleOpen: false,
    participants: { michal: osoba('michal'), ania: osoba('ania'), kuba: osoba('kuba') },
    globalCosts: [],
    sharedCosts: [
      { id: 'i1', description: 'Zestaw A', amount: 100, sharedBy: ['michal'] },
      { id: 'i2', description: 'Zestaw B', amount: 100, sharedBy: ['ania'] },
      { id: 'i3', description: 'Zestaw C', amount: 100, sharedBy: ['kuba'] },
    ],
    ...extra,
  });

  it('brama otwiera się bez niczyjego zatwierdzenia — więc wpłaty są możliwe od razu', () => {
    expect(billSettleGate(rozpisanyCoDoGrosza()).reason).toBe('exact');
    expect(billCountsInLedger(rozpisanyCoDoGrosza())).toBe(true);
  });

  it('ze stemplem `everOpened` dopisana pozycja NIE odwraca długu ani nie kasuje cudzego', async () => {
    const { buildLedger } = await import('./calc.js');
    const bill = rozpisanyCoDoGrosza({ everOpened: true });
    // Kuba oddał swoje 100. Płatnik dopisuje zapomnianą herbatę, której nikt nie wziął.
    bill.sharedCosts.push({ id: 'i4', description: 'Herbata', amount: 50, sharedBy: [] });
    bill.totalAmount = 350;
    expect(billSettleGate(bill).open).toBe(false);   // brama słusznie się zamyka
    expect(billCountsInLedger(bill)).toBe(true);     // ale rachunek zostaje w księdze

    const net = buildLedger([bill].filter(billCountsInLedger), [
      { from: 'kuba', to: 'michal', amount: 100, currency: 'PLN' },
    ]).PLN.net;
    // Dług Ani stoi, dług Kuby zgaszony, płatnik nikomu nic nie jest winien.
    expect(net).toEqual([{ from: 'ania', to: 'michal', amountG: 10000 }]);
  });

  it('bez stempla ten sam ruch obraca 200 zł: dług Ani znika, a płatnik jest winien Kubie', async () => {
    // Test-świadek. Trzyma opisany stan błędu, żeby nikt nie „uprościł" stemplowania
    // `everOpened` z powrotem do samego zamknięcia rachunku.
    const { buildLedger } = await import('./calc.js');
    const bill = rozpisanyCoDoGrosza({ everOpened: false });
    bill.sharedCosts.push({ id: 'i4', description: 'Herbata', amount: 50, sharedBy: [] });
    bill.totalAmount = 350;
    expect(billCountsInLedger(bill)).toBe(false);
    const net = buildLedger([bill].filter(billCountsInLedger), [
      { from: 'kuba', to: 'michal', amount: 100, currency: 'PLN' },
    ]).PLN.net;
    expect(net).toEqual([{ from: 'michal', to: 'kuba', amountG: 10000 }]);
  });
});

// ====================================================================================
// KAŻDY MUSI MIEĆ NA RACHUNKU JAKĄKOLWIEK STAWKĘ (zgłoszenie właściciela 2026-08-27).
//
// „Każda złotówka ma właściciela" nie pyta, ILU tych właścicieli jest. Woda za 25 zł,
// którą piło pięć osób, a stuknęła jedna, ma właściciela w stu procentach — i brama
// otwierała się z czystym sumieniem, podczas gdy jedna osoba płaciła dwa razy za dużo.
// ====================================================================================

const stolik = (extra = {}) => ({
  id: 'b1',
  billName: 'Kolacja',
  gated: true,
  splitMode: 'own',
  settleOpen: false,
  everOpened: true,
  totalAmount: 55,
  currency: 'PLN',
  payerId: 'michal',
  payerConfirmed: true,
  participants: {
    michal: osoba('michal'), ania: osoba('ania'),
    kuba: osoba('kuba'), ola: osoba('ola'), piotr: osoba('piotr'),
  },
  globalCosts: [],
  // Woda była dla całej piątki, ale stuknęła ją tylko Ania.
  sharedCosts: [
    { id: 'w', description: 'Woda', amount: 25, sharedBy: ['ania'] },
    { id: 'd1', description: 'Danie', amount: 15, sharedBy: ['michal'] },
    { id: 'd2', description: 'Danie', amount: 15, sharedBy: ['ania'] },
  ],
  ...extra,
});

describe('brama pyta też, czy KAŻDY ma na rachunku stawkę', () => {
  it('rachunek rozpisany co do grosza NIE otwiera się, gdy ktoś ma udział zerowy', () => {
    const gate = billSettleGate(stolik());
    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('nostake');
    expect(gate.needsDecision).toBe(true);
  });

  it('mówi wprost, na kogo czeka — ekran ma wymienić te osoby po imieniu', () => {
    expect(billSettleGate(stolik()).bezStawki.sort()).toEqual(['kuba', 'ola', 'piotr']);
  });

  it('bez tej reguły sumienna Ania płaci DWA RAZY tyle, co powinna', () => {
    // Liczba wprost z sondy audytowej: woda 25 na jednej osobie zamiast na pięciu.
    const w = calculateAll(stolik());
    expect(udzial(w, 'ania')).toBeCloseTo(40, 2);   // 25 wody + 15 dania
    expect(udzial(w, 'kuba')).toBeCloseTo(0, 2);
    expect(w.restUndecided).toBeCloseTo(0, 2);      // ...i ANI GROSZA bez właściciela
  });

  it('gdy woda trafia do wszystkich, udziały są uczciwe i brama otwiera się sama', () => {
    const b = stolik({
      totalAmount: 100,
      sharedCosts: [
        { id: 'w', description: 'Woda', amount: 25, sharedBy: ['michal', 'ania', 'kuba', 'ola', 'piotr'] },
        { id: 'd1', description: 'Danie', amount: 15, sharedBy: ['michal'] },
        { id: 'd2', description: 'Danie', amount: 15, sharedBy: ['ania'] },
        { id: 'd3', description: 'Danie', amount: 15, sharedBy: ['kuba'] },
        { id: 'd4', description: 'Danie', amount: 15, sharedBy: ['ola'] },
        { id: 'd5', description: 'Danie', amount: 15, sharedBy: ['piotr'] },
      ],
    });
    expect(billSettleGate(b).reason).toBe('exact');
    expect(udzial(calculateAll(b), 'ania')).toBeCloseTo(20, 2);
  });

  it('WŁASNY KOSZT też jest stawką — nie trzeba klikać pozycji', () => {
    const b = stolik();
    b.participants.kuba.individualAmount = 10;
    b.participants.ola.individualAmount = 10;
    b.participants.piotr.individualAmount = 10;
    b.totalAmount = 85;
    expect(billSettleGate(b).reason).toBe('exact');
  });

  it('kto jest „nie dotyczy", ten nie blokuje niczego', () => {
    const b = stolik();
    ['kuba', 'ola', 'piotr'].forEach((id) => { b.participants[id].status = 'not_applicable'; });
    expect(billSettleGate(b).reason).toBe('exact');
    expect(billSettleGate(b).open).toBe(true);
  });

  it('RACHUNEK NIE WISI: domknięcie ręką płatnika otwiera bramę mimo zerowych stawek', () => {
    // To jest cała różnica między tą regułą a „czekaniem, aż wszyscy skończą", którego
    // ta brama świadomie nie robi. Decyzja jest o jedno stuknięcie, nie o cudzą obecność.
    const b = stolik({ settleOpen: true, restSettledG: 0 });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('closed');
  });

  it('tryb „po równo" reguły nie zna — tam nikt niczego nie odklikuje', () => {
    const b = stolik({ splitMode: 'even', sharedCosts: [], globalCosts: [] });
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('even');
  });

  it('stary rachunek bez pola gated dziala jak dawniej', () => {
    const b = stolik();
    delete b.gated;
    expect(billSettleGate(b).open).toBe(true);
    expect(billSettleGate(b).reason).toBe('legacy');
  });

  it('kwota niczyja ma pierwszeństwo — najpierw reszta, potem stawki', () => {
    // Gdy JEDNOCZEŚNIE coś wisi bez właściciela i ktoś nie ma stawki, ekran ma mówić
    // o pieniądzach: to one są konkretem, który da się rozstrzygnąć przyciskiem.
    const b = stolik({ totalAmount: 155 });
    expect(billSettleGate(b).reason).toBe('rest');
  });
});
