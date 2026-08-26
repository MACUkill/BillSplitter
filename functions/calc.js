// Czysta matematyka rachunków — bez Firebase, bez DOM. Testowalna w izolacji (Vitest).
//
// ZASADY (Faza 1 — fundament zaufania):
//   1) Udziały zaokrąglane W GÓRĘ do pełnego grosza → PŁATNIK NIGDY STRATNY.
//      Nadwyżka to najwyżej kilka groszy (po jednym na osobę).
//   2) Kontrola "suma pozycji vs kwota rachunku" liczona na DOKŁADNYCH kwotach
//      (przed zaokrągleniem), żeby grosze nigdy nie dawały fałszywego alarmu.
//
// Cała arytmetyka pieniędzy idzie w GROSZACH (liczby całkowite tam, gdzie się da),
// żeby uniknąć błędów zmiennoprzecinkowych typu 0.1 + 0.2 = 0.30000000000000004.

// Bufor na szum zmiennoprzecinkowy przy zaokrąglaniu w górę.
const EPS = 1e-6;

// Tolerancja kontroli sumy: 1 grosz (absorbuje ułamki z procentów, nie przepuszcza realnych pomyłek).
const TOLERANCE_GROSZE = 1;

// Złote (float) -> grosze (int). Zaokrągla do najbliższego grosza.
export const toGrosze = (amount) => Math.round((Number(amount) || 0) * 100);

// Grosze (int) -> złote (float, 2 miejsca po przecinku).
export const fromGrosze = (grosze) => grosze / 100;

// Zaokrąglenie W GÓRĘ do pełnego grosza. Wejście w groszach (może być ułamkowe).
// EPS chroni przed podbiciem wartości, która już jest pełnym groszem (np. 4850.0000001).
export const ceilGrosze = (grosze) => {
  const c = Math.ceil(grosze - EPS);
  return c === 0 ? 0 : c; // normalizacja -0 -> 0
};

const isActive = (p) => p && p.status !== 'not_applicable';

// KTO NIESIE KWOTĘ NIEROZPISANĄ.
//
// Domyślnie wszyscy aktywni — bo „brak wyboru znaczy wspólne" (patrz calculateAll).
// `bill.restTo` zawęża to do wskazanych osób i zapisuje się WYŁĄCZNIE w chwili zamykania
// rachunku, gdy płatnik świadomie odpowie na pytanie „to była wspólna rzecz czy czyjeś
// jedzenie?". Bez tej listy aplikacja musiałaby zgadywać, a przy cudzych pieniądzach
// zgadywanie jest gorsze niż zapytanie.
//
// Lista jest ODPORNA NA ZMIANY SKŁADU: kto wypadł z rachunku albo zniknął z uczestników,
// ten wypada też stąd. Gdyby po takim odsianiu nie został NIKT, reszta wraca do wszystkich
// aktywnych — pieniądze nie mogą wyparować tylko dlatego, że wskazana osoba odeszła.
const restRecipients = (bill, activeParticipants) => {
  const wanted = Array.isArray(bill && bill.restTo) ? bill.restTo : null;
  if (!wanted || wanted.length === 0) return activeParticipants;
  const narrowed = activeParticipants.filter((p) => wanted.includes(p.id));
  return narrowed.length > 0 ? narrowed : activeParticipants;
};

// CZY KWOTA NIEROZPISANA MA JUŻ WŁAŚCICIELI.
//
// Do 2026-08-26 dzieliła się po równo ZAWSZE, także zanim ktokolwiek zdążył cokolwiek
// stuknąć. Ekran mówił wtedy „na razie po równo" i pokazywał udział, który nie miał
// pokrycia w niczyjej decyzji: człowiek, który nie wybrał ani jednej pozycji, widział
// przy swoim imieniu kilkaset złotych. To myliło, bo wyglądało na rachunek, a było
// zgadywaniem aplikacji.
//
// Teraz reszta jest NICZYJA, dopóki ktoś o niej nie zdecyduje — i jest to dokładnie ta
// sama chwila, w której otwiera się brama rozliczeń. Jedna reguła zamiast dwóch:
//   stare rachunki (bez `gated`)  — dzielimy jak dawniej, nic im się nie zmienia,
//   „po równo"                    — cała kwota jest wspólna Z ZAŁOŻENIA, więc zawsze,
//   „ze swoimi kosztami"          — dopiero gdy płatnik zamknie rachunek.
//
// Bez tego udział rósł ludziom o cudze pozycje, zanim ktokolwiek się do nich przyznał.
//
// Zwraca, ILE GROSZY z kwoty nierozpisanej ma już właścicieli — nie „tak/nie".
// Powód jest konkretny: gdy po zamknięciu rachunku dojdzie nowa pozycja, decyzja sprzed
// chwili NIE MOŻE SIĘ COFNĄĆ. Cofnięcie zabrałoby udziały ludziom, którzy na ich podstawie
// zrobili już przelew, i zrobiłoby z tego dług płatnika wobec nich — czyli fałszywy dług
// w drugą stronę. Stara decyzja zostaje w mocy, a niczyja jest wyłącznie NADWYŻKA.
const decidedRestGrosze = (bill, unallocatedG) => {
  if (!bill || bill.gated !== true) return unallocatedG;
  if (billSplitMode(bill) === 'even') return unallocatedG;
  if (bill.settleOpen !== true) return 0;
  const objeteG = Math.max(0, Math.round(Number(bill.restSettledG) || 0));
  return Math.min(unallocatedG, objeteG);
};

// --- Rachunek ZAAWANSOWANY: dokładne udziały (w groszach, mogą być ułamkowe) ---
function advancedExactSharesGrosze(bill) {
  const participants = Object.values(bill.participants || {});
  const active = participants.filter(isActive);
  const numActive = active.length;

  const individualSubtotalG = active.reduce((s, p) => s + toGrosze(p.individualAmount || 0), 0);

  // POZYCJE OSIEROCONE — patrz calculateAll. Pozycja, której nie wziął ani jeden AKTYWNY
  // uczestnik (pusta lista chętnych albo sami wykluczeni „nie dotyczy"), nie ma komu
  // obciążyć. Liczymy ją osobno, bo wchodzi do kwoty rachunku, ale NIE do niczyjego udziału.
  let sharedAssignedG = 0;
  let sharedOrphanG = 0;
  let orphanCount = 0;
  (bill.sharedCosts || []).forEach((sc) => {
    const g = toGrosze(sc.amount || 0);
    const hasTaker = (sc.sharedBy || []).some((id) => active.some((a) => a.id === id));
    if (hasTaker) sharedAssignedG += g;
    else { sharedOrphanG += g; orphanCount += 1; }
  });
  const sharedTotalG = sharedAssignedG + sharedOrphanG;

  // Podstawa procentu to WSZYSTKIE wpisane pozycje, także osierocone: napiwek 10% od
  // rachunku nie maleje dlatego, że nikt jeszcze nie kliknął, co jadł.
  const subtotalForGlobalG = individualSubtotalG + sharedTotalG;

  // Koszty ogólne (kwota lub procent). Procent może dać ułamek grosza.
  let globalTotalG = 0;
  (bill.globalCosts || []).forEach((gc) => {
    globalTotalG += gc.type === 'percent'
      ? subtotalForGlobalG * ((gc.value || 0) / 100)
      : toGrosze(gc.value || 0);
  });
  const globalPerPersonG = numActive > 0 ? globalTotalG / numActive : 0;

  const shares = participants.map((p) => {
    if (!isActive(p)) {
      return { participant: p, individualG: 0, sharedG: 0, globalG: 0, exactG: 0 };
    }
    const individualG = toGrosze(p.individualAmount || 0);
    const sharedG = (bill.sharedCosts || []).reduce((s, sc) => {
      const sharers = (sc.sharedBy || []).filter((id) => active.some((a) => a.id === id));
      if ((sc.sharedBy || []).includes(p.id) && sharers.length > 0) {
        return s + toGrosze(sc.amount || 0) / sharers.length;
      }
      return s;
    }, 0);
    const globalG = globalPerPersonG;
    return { participant: p, individualG, sharedG, globalG, exactG: individualG + sharedG + globalG };
  });

  return {
    shares, individualSubtotalG, sharedTotalG, sharedAssignedG, sharedOrphanG,
    orphanCount, itemCount: (bill.sharedCosts || []).length, globalTotalG,
  };
}

// Kontrola poprawności: suma DOKŁADNYCH pozycji vs kwota rachunku.
// status: 'ok' | 'over' | 'under' | 'empty'
//
// UWAGA na znaczenie 'under' po wprowadzeniu reguły reszty (patrz calculateAll):
// niedobór NIE JEST już błędem, tylko kwotą jeszcze nierozpisaną, którą rachunek
// dzieli po równo. Zostawiamy go jako osobny status, bo interfejs ma o nim mówić
// („120,00 nierozpisane — po 24,00 na osobę"), ale nie jako ostrzeżenie.
// Realnym błędem zostaje wyłącznie 'over': pozycje przekraczają kwotę rachunku,
// czyli ktoś wpisał coś dwa razy albo pomylił się o rząd wielkości.
function computeControl(enteredSubtotalG, billTotalG) {
  const enteredRoundedG = Math.round(enteredSubtotalG);
  if (billTotalG <= 0) {
    return { status: 'empty', diff: 0, enteredSubtotal: fromGrosze(enteredRoundedG), expectedTotal: 0 };
  }
  const diffG = enteredRoundedG - billTotalG;
  let status;
  if (Math.abs(diffG) <= TOLERANCE_GROSZE) status = 'ok';
  else if (diffG > 0) status = 'over';   // za dużo — ktoś przeliczył / podwójna pozycja
  else status = 'under';                 // reszta do rozdzielenia po równo
  return {
    status,
    diff: fromGrosze(Math.abs(diffG)),
    enteredSubtotal: fromGrosze(enteredRoundedG),
    expectedTotal: fromGrosze(billTotalG),
  };
}

// --- API publiczne ---

// JEDEN RACHUNEK, KTÓRY ROŚNIE.
//
// Nie ma już podziału na „prosty" i „zaawansowany". Rachunek zaczyna się od samej kwoty
// i rozrasta się dokładnie tyle, ile trzeba: dopisujesz pozycje, koszty własne i koszty
// ogólne, a KWOTA JESZCZE NIEROZPISANA DZIELI SIĘ PO RÓWNU między uczestników.
//
// Ta reguła zastępuje dawne zachowanie, w którym reszta po cichu zostawała na płatniku.
// Tamto było ukrytą karą za niedokończone wpisywanie: przy stole nikt nie rozpisuje
// trzydziestu pozycji, więc płatnik dopłacał za wszystkich, nie wiedząc o tym.
// Teraz brak pozycji znaczy „to było wspólne", co odpowiada temu, jak ludzie realnie
// dzielą rachunek: kilka rzeczy imiennie, reszta po równo.
export const calculateAll = (bill) => {
  const {
    shares, individualSubtotalG, sharedTotalG, sharedAssignedG, sharedOrphanG,
    orphanCount, itemCount, globalTotalG,
  } = advancedExactSharesGrosze(bill);

  // POZYCJA OSIEROCONA IDZIE DO RESZTY, NIE W POWIETRZE.
  // Do 2026-08-16 kwota pozycji, której nikt nie wybrał, liczyła się jako rozpisana,
  // choć nie trafiała do żadnego udziału. Skutek był cichy i kosztowny: paragon odczytany
  // przez AI tworzy pozycje z pustą listą chętnych, więc rachunek na 100 zł pokazywał
  // udziały 0 zł i kontrolę „rozpisane co do grosza" — całość zostawała na płatniku,
  // a aplikacja twierdziła, że wszystko się zgadza. Teraz taka kwota wpada do puli
  // nierozpisanej i dzieli się po równo, zgodnie z regułą „brak wyboru znaczy wspólne".
  const allocatedG = individualSubtotalG + sharedAssignedG + globalTotalG;
  const enteredG = individualSubtotalG + sharedTotalG + globalTotalG; // wszystko, co wpisane
  const billTotalG = toGrosze(bill.totalAmount || 0);
  // Bez wpisanej kwoty rachunku miarą całości są same pozycje — wtedy resztą jest
  // dokładnie to, co osierocone.
  const effectiveTotalG = billTotalG > 0 ? billTotalG : enteredG;
  // Nadwyżka pozycji ponad kwotę rachunku NIE staje się ujemną resztą — to błąd wpisu,
  // który zgłasza kontrola, a nie powód, żeby komukolwiek odejmować od udziału.
  const unallocatedG = Math.max(0, effectiveTotalG - allocatedG);
  const aktywni = shares.filter((s) => isActive(s.participant)).map((s) => s.participant);
  const objeteDecyzjaG = Math.min(unallocatedG, Math.max(0, decidedRestGrosze(bill, unallocatedG)));
  // Grosz różnicy nie tworzy „kwoty niczyjej": procentowy koszt ogólny potrafi przesunąć
  // wynik o tyle bez żadnej zmiany w treści rachunku, a jeden nieprzypisany grosz
  // trzymałby bramę zamkniętą i pokazywał na ekranie „0,01 nikt nie wziął".
  const wCalosci = (unallocatedG - objeteDecyzjaG) <= TOLERANCE_GROSZE;
  const rozdzielonaG = wCalosci ? unallocatedG : objeteDecyzjaG;
  const niczyjaG = Math.max(0, unallocatedG - rozdzielonaG);
  const decyzjaZapadla = niczyjaG <= 0;
  const restTakers = rozdzielonaG > 0 ? restRecipients(bill, aktywni) : [];
  const restTakerIds = restTakers.map((p) => p.id);
  const perPersonUnallocatedG = restTakers.length > 0 ? rozdzielonaG / restTakers.length : 0;

  const participantTotals = shares.map((s) => {
    const restG = restTakerIds.includes(s.participant.id) ? perPersonUnallocatedG : 0;
    const exactG = s.exactG + restG;
    const totalG = exactG > 0 ? ceilGrosze(exactG) : 0; // W GÓRĘ do grosza
    return {
      participant: s.participant,
      individualAmount: fromGrosze(s.individualG),
      sharedAmount: fromGrosze(s.sharedG),        // dokładne (informacyjnie)
      globalCostsAmount: fromGrosze(s.globalG),   // dokładne (informacyjnie)
      restAmount: fromGrosze(restG),              // udział w kwocie nierozpisanej
      total: fromGrosze(totalG),                  // ZAOKRĄGLONE W GÓRĘ — kwota do zapłaty
      exactTotal: fromGrosze(exactG),             // dokładny udział (bez zaokrąglenia)
    };
  });

  // Sumujemy w GROSZACH i dzielimy raz na końcu. Dodawanie złotych jako liczb
  // zmiennoprzecinkowych dawało wynik w rodzaju 100.05000000000001 zamiast 100,05 —
  // na ekranie chowa to zaokrąglenie do dwóch miejsc, ale mnożenie przez kurs waluty
  // przenosiło ten śmieć dalej.
  const controlSum = fromGrosze(participantTotals.reduce((sum, pt) => sum + toGrosze(pt.total), 0));
  // Kontrola mówi o POPRAWNOŚCI WPISU (czy pozycje spinają się z kwotą rachunku), więc
  // liczy wszystkie wpisane pozycje — także te, których nikt jeszcze nie wybrał. To, kto
  // je bierze na siebie, jest osobnym pytaniem i odpowiada na nie kwota nierozpisana.
  const control = computeControl(enteredG, billTotalG);

  return {
    participantTotals,
    controlSum,
    control,
    // Kwota, która nie została rozpisana na nic imiennego i idzie po równo.
    // Interfejs pokazuje ją wprost, żeby nikt nie musiał się domyślać, skąd wynik.
    unallocated: fromGrosze(unallocatedG),
    perPersonUnallocated: fromGrosze(perPersonUnallocatedG),
    // KOMU przypada reszta. Ekran musi to powiedzieć wprost, bo od 2026-08-26 nie zawsze
    // jest to cała ekipa: przy zamykaniu rachunku płatnik może wskazać, że nierozpisane
    // pozycje należą do tych, którzy ich nie odklikali. Kto dostał taki przydział, ma
    // prawo wiedzieć, skąd wzięła się jego kwota — i mieć czym się odwołać.
    restToIds: restTakerIds,
    restToEveryone: restTakerIds.length > 0 && restTakerIds.length === aktywni.length,
    // Czy CAŁA reszta ma już właścicieli.
    restDecided: decyzjaZapadla,
    // Ile z niej NIE MA WŁAŚCICIELA. To jest liczba, o której mówi ekran („nikt tego nie
    // wziął") i którą pilnuje brama rozliczeń — a nie `unallocated`, bo po zamknięciu
    // rachunku część nierozpisanej kwoty ma już przypisanych ludzi.
    restUndecided: fromGrosze(niczyjaG),
    // SKĄD bierze się kwota nierozpisana. Ekran musi to rozróżnić, bo dla czytającego
    // to dwie różne historie. Pozycja bez chętnego („nikt tego nie wziął") naprawia się
    // jednym stuknięciem. Różnica między kwotą rachunku a sumą pozycji („reszta
    // rachunku") to po prostu to, czego nikt nie rozpisał — a na rachunku bez ani jednej
    // pozycji jest całą jego treścią, nie usterką, więc nie wolno o niej mówić alarmem.
    orphanAmount: fromGrosze(sharedOrphanG),
    orphanCount,
    itemCount,
    // Z CZEGO SKŁADA SIĘ SUMA KONTROLNA. Ekran ma pokazać DZIAŁANIE, a nie zgadywać
    // przyczynę rozjazdu: do 2026-08-25 przy nadwyżce mówił „ktoś przeliczył albo pozycja
    // jest podwójna", więc pomijał trzeci składnik — koszty ogólne — i przy doliczonym
    // serwisie kierował na fałszywy trop.
    entered: {
      individual: fromGrosze(individualSubtotalG),
      shared: fromGrosze(sharedTotalG),
      global: fromGrosze(Math.round(globalTotalG)),
    },
  };
};

// ZGODNOŚĆ WSTECZ. Rachunek „prosty" przestał być osobnym typem — jest zwykłym
// rachunkiem bez ani jednej pozycji, więc CAŁA kwota jest nierozpisana i idzie po równu.
// Reguła z calculateAll daje dokładnie ten sam wynik, dlatego zostaje tu jedno wywołanie
// i dwa pola, po które sięgają starsze ekrany.
export const calculateSimple = (bill) => {
  const result = calculateAll(bill);
  return {
    ...result,
    amountPerPerson: result.participantTotals.find((pt) => isActive(pt.participant))?.total || 0,
    exactAmountPerPerson: result.perPersonUnallocated,
  };
};

// Jedna reguła dla każdego rachunku — typ nie rozgałęzia już obliczeń.
export const calculateAllForBill = (bill) => calculateAll(bill);

// TRYB PODZIAŁU — jedno źródło prawdy dla frontu i dla bramy rozliczeń.
// Rachunki sprzed wprowadzenia przełącznika nie mają tego pola, więc tryb czytamy z ich
// zawartości: skoro ktoś rozpisał pozycje albo wpisał koszt własny, to rachunek jest
// „ze swoimi kosztami", a przestawienie go po cichu na „po równo" byłoby zmianą cudzych kwot.
export const billSplitMode = (bill) => {
  if (bill && (bill.splitMode === 'even' || bill.splitMode === 'own')) return bill.splitMode;
  const items = (bill && bill.sharedCosts) || [];
  const anyOwn = Object.values((bill && bill.participants) || {})
    .some((p) => Number(p && p.individualAmount) > 0);
  return (items.length > 0 || anyOwn) ? 'own' : 'even';
};

// --- BRAMA ROZLICZEŃ ---------------------------------------------------------
//
// PROBLEM, KTÓRY TO NAPRAWIA (zgłoszenie 2026-08-26). Kwota nierozpisana dzieli się po
// równo — i słusznie, gdy chodzi o wspólne wino albo napiwek. Ale ta sama reguła obejmowała
// przypadek zupełnie inny: „Kuba jeszcze nie stuknął swoich pozycji". Wtedy podział po równo
// jest KARĄ DLA SUMIENNYCH — kto odklikał swoje, dopłacał za tego, kto tego nie zrobił.
// A przycisk „Ureguluj" stał otwarty od pierwszej sekundy, więc dało się przelać pieniądze
// za cudze jedzenie, zanim rachunek w ogóle był kompletny.
//
// REGUŁA JEST O PIENIĄDZACH, NIE O LUDZIACH. Nie pytamy „czy wszyscy skończyli" — tego
// aplikacja nie wie i nie ma jak sprawdzić (a przy ekipie 12–25 osób zawsze są tacy, którzy
// nie otworzyli linku ani razu; czekanie na nich zawiesiłoby rachunek na zawsze).
// Pytamy: CZY JAKAŚ ZŁOTÓWKA WISI BEZ WŁAŚCICIELA. Jeśli nie — nikt nie może stracić,
// więc brama stoi otworem sama z siebie i nikt niczego nie zatwierdza.
//
// POLA W DOKUMENCIE RACHUNKU:
//   gated        — czy rachunek w ogóle podlega bramie (dostają je tylko nowe rachunki)
//   settleOpen   — czy brama została otwarta ręcznie (płatnik odpowiedział o resztę)
//   everOpened   — czy KIEDYKOLWIEK była otwarta; nigdy nie wraca do false
//   restTo       — komu przypisano resztę (null = wszystkim)
//   restSettledG — ile groszy nierozpisanych obejmowała ta decyzja
//
// DLACZEGO `restSettledG`. Po zamknięciu rachunku płatnik może jeszcze dopisać pozycję.
// Bez tej liczby nowa, nieodklikana pozycja rozdzieliłaby się po cichu — czyli dokładnie
// ten błąd, przed którym brama ma chronić, tyle że tylnymi drzwiami. Porównanie „ile wisi
// teraz" z „ile obejmowała decyzja" wyłapuje to bez ani jednego dodatkowego zapisu
// i działa tak samo offline.
//
// DLACZEGO `everOpened`. Rachunek, którego brama NIGDY nie była otwarta, nie wchodzi do
// księgi długów — nie ma z niego czego regulować. Ale rachunek raz otwarty musi w niej
// ZOSTAĆ, nawet gdy brama zamknie się z powrotem: ktoś mógł już za niego zapłacić, a wpłata
// bez długu po drugiej stronie tworzy w `buildLedger` krawędź odwrotną, czyli fałszywy dług
// w drugą stronę (ta sama rodzina usterek co „wiersz widmo" opisany w src/plan.js).
//
// Zwraca:
//   open    — czy wolno się rozliczać z tego rachunku
//   reason  — 'legacy' | 'even' | 'exact' | 'closed' | 'rest' | 'over' | 'changed'
//   needsDecision — czy jest co zamykać ręcznie
export function billSettleGate(bill) {
  // STARE RACHUNKI NIE MAJĄ BRAMY. Pole `gated` dostają wyłącznie rachunki założone po
  // wdrożeniu. Gdyby brama obejmowała wszystkie, w dniu wdrożenia zamroziłaby ekipom
  // przelewy na rachunkach, które od dawna żyją i są rozliczane — czyli zabrałaby ludziom
  // działającą funkcję za to, że korzystali z aplikacji wcześniej.
  if (!bill || bill.gated !== true) return { open: true, reason: 'legacy', needsDecision: false };

  // Po równo nie ma czego uzupełniać: cała kwota jest nierozpisana Z ZAŁOŻENIA i to jest
  // dokładnie ten podział, o który poprosiła ekipa. Brama nie ma tu czego pilnować —
  // i dzięki temu scena „20 sekund przy stole" zostaje nietknięta.
  if (billSplitMode(bill) === 'even') return { open: true, reason: 'even', needsDecision: false };

  const wynik = calculateAll(bill);
  // KWOTA NICZYJA, nie „nierozpisana". Po zamknięciu rachunku część nierozpisanej kwoty ma
  // już właścicieli (decyzja płatnika), więc pilnowanie `unallocated` trzymałoby bramę
  // zamkniętą na rachunku, na którym wszystko jest już rozstrzygnięte.
  const unallocatedG = toGrosze(wynik.restUndecided);

  // NADWYŻKA BLOKUJE ZAMKNIĘCIE. Pozycje ponad kwotę rachunku to jedyny prawdziwy błąd
  // wpisu (`computeControl`), a przy nim `unallocated` wynosi zero — więc bez tego warunku
  // brama otwierałaby się na rachunku, na którym WSZYSCY przepłacają.
  if (wynik.control.status === 'over') {
    return { open: false, reason: 'over', needsDecision: false, unallocatedG, diff: wynik.control.diff };
  }

  // Nic nie wisi bez właściciela — nikt nie może stracić, więc brama stoi otworem.
  // Dwie drogi do tego stanu i obie są prawidłowe: rachunek rozpisany co do grosza
  // (`exact`, nikt niczego nie zatwierdzał) albo decyzja płatnika (`closed`).
  if (unallocatedG <= 0) {
    return {
      open: true,
      reason: bill.settleOpen === true ? 'closed' : 'exact',
      needsDecision: false,
      unallocatedG: 0,
    };
  }

  // Coś jest niczyje. Na rachunku jeszcze niezamykanym to zwykły stan uzupełniania;
  // na zamkniętym znaczy, że po decyzji DOSZŁO coś, czego ona nie obejmowała — i to jest
  // ten sam błąd, przed którym brama chroni, tyle że tylnymi drzwiami.
  return {
    open: false,
    reason: bill.settleOpen === true ? 'changed' : 'rest',
    needsDecision: true,
    unallocatedG,
  };
}

// Czy rachunek wchodzi do księgi długów (Bilans, Rozliczenia).
//
// Rachunek przed pierwszym otwarciem bramy NIE wchodzi: jego kwoty są wstępne i nikt nie
// mógł za niego zapłacić. Raz otwarty zostaje na zawsze — patrz `everOpened` wyżej.
export const billCountsInLedger = (bill) =>
  !!bill && (bill.everOpened === true || billSettleGate(bill).open);

// Agregacja podsumowań grupy z LISTY rachunków — przeliczenie OD ZERA.
// Zastępuje kruche delty przyrostowe: brak dryfu, odporne na retry / at-least-once.
// Akumulacja w groszach (int), konwersja na złote dopiero na końcu.
export function aggregateGroupSummary(bills) {
  const userG = {};   // { participantId: { currency: grosze } }
  const groupG = {};  // { currency: grosze }

  (bills || []).forEach((bill) => {
    if (!bill) return;
    const cur = bill.currency || 'PLN';
    const totalG = toGrosze(bill.totalAmount || 0);
    if (totalG > 0) groupG[cur] = (groupG[cur] || 0) + totalG;

    calculateAllForBill(bill).participantTotals.forEach((pt) => {
      const g = toGrosze(pt.total);
      if (g <= 0) return;
      const pid = pt.participant.id;
      if (!userG[pid]) userG[pid] = {};
      userG[pid][cur] = (userG[pid][cur] || 0) + g;
    });
  });

  const groupGrossSpend = {};
  for (const [cur, g] of Object.entries(groupG)) {
    if (g) groupGrossSpend[cur] = fromGrosze(g);
  }
  const userGrossSpend = {};
  for (const [pid, m] of Object.entries(userG)) {
    const inner = {};
    for (const [cur, g] of Object.entries(m)) {
      if (g) inner[cur] = fromGrosze(g);
    }
    if (Object.keys(inner).length) userGrossSpend[pid] = inner;
  }

  return { userGrossSpend, groupGrossSpend };
}

// ====================================================================
// Faza 5 — LEDGER (kto komu ile) + minimalizacja przelewów.
//
// Wszystko w GROSZACH (int). Rozliczenia SĄ per-waluta — walut NIE mieszamy
// (bez kursu netowanie PLN vs EUR byłoby zmyśleniem; kurs = osobny krok).
// Dług z rachunku istnieje tylko gdy: płatnik POTWIERDZONY i kwota > 0.
// Dłużnik = aktywny uczestnik (≠ not_applicable), ≠ płatnik, status ≠ 'paid'.
// Kwota długu = zaokrąglony w górę udział (pt.total) — DOKŁADNIE to, co dłużnik
// widzi na rachunku jako „Do zapłaty" / „Należność dla X" (zero rozjazdu).
// ====================================================================

// Długi (UDZIAŁY) z JEDNEGO rachunku: [{ from, to, amountG, currency, billId, billName }].
// MODEL WPŁAT: rachunek mówi tylko o KONSUMPCJI (kto ile jest winien płatnikowi z tytułu udziału).
// Rozliczenie (czy zapłacone) NIE jest już flagą na rachunku — robi to osobny rejestr wpłat,
// który redukuje te długi w buildLedger. Dlatego NIE wykluczamy tu statusu „paid".
export function computeBillDebts(bill) {
  if (!bill || !bill.payerConfirmed || !bill.payerId) return [];
  if (toGrosze(bill.totalAmount || 0) <= 0) return [];
  const currency = bill.currency || 'PLN';
  const billId = bill.id || null;
  const billName = bill.billName || '';
  const debts = [];
  calculateAllForBill(bill).participantTotals.forEach((pt) => {
    const p = pt.participant;
    if (!p || p.id === bill.payerId) return;
    if (p.status === 'not_applicable') return; // tylko „nie dotyczy" wypada z udziałów
    const amountG = toGrosze(pt.total);
    if (amountG > 0) debts.push({ from: p.id, to: bill.payerId, amountG, currency, billId, billName });
  });
  return debts;
}

// Zwija długi przeciwnych kierunków w jednej walucie (A→B 30, B→A 10 ⇒ A→B 20).
function netDirected(directed) {
  const amt = new Map();
  directed.forEach((e) => amt.set(e.from + '|' + e.to, (amt.get(e.from + '|' + e.to) || 0) + e.amountG));
  const seen = new Set();
  const net = [];
  directed.forEach((e) => {
    const a = e.from, b = e.to;
    const k = a + '|' + b, rk = b + '|' + a;
    if (seen.has(k)) return;
    seen.add(k); seen.add(rk);
    const diff = (amt.get(k) || 0) - (amt.get(rk) || 0);
    if (diff > 0) net.push({ from: a, to: b, amountG: diff });
    else if (diff < 0) net.push({ from: b, to: a, amountG: -diff });
  });
  return net;
}

// Ledger całej grupy: rachunki (udziały) MINUS wpłaty (rejestr spłat). Zwraca { [currency]: { directed, net } }:
//   directed — krawędzie kierunkowe A→B z detalem (contributions: kind 'bill' | 'payment'),
//   net      — znetowane pary (kto komu ile, jeden kierunek na parę).
// WPŁATA from→to (from zapłacił to) redukuje dług from→to → dodajemy krawędź ODWROTNĄ to→from.
export function buildLedger(bills, settlements) {
  const byCur = {}; // currency -> Map("from|to" -> { from, to, amountG, contributions:[] })
  const addEdge = (cur, from, to, amountG, contribution) => {
    if (!from || !to || amountG <= 0) return;
    const map = byCur[cur] || (byCur[cur] = new Map());
    const key = from + '|' + to;
    let e = map.get(key);
    if (!e) { e = { from, to, amountG: 0, contributions: [] }; map.set(key, e); }
    e.amountG += amountG;
    if (contribution) e.contributions.push(contribution);
  };

  (bills || []).forEach((bill) => {
    computeBillDebts(bill).forEach((d) => {
      addEdge(d.currency, d.from, d.to, d.amountG, { kind: 'bill', billId: d.billId, label: d.billName, amountG: d.amountG });
    });
  });
  (settlements || []).forEach((s) => {
    if (!s || !s.from || !s.to || s.from === s.to) return;
    const cur = s.currency || 'PLN';
    const amountG = toGrosze(s.amount || 0);
    // wpłata from→to = krawędź odwrotna to→from (kredyt redukujący dług)
    addEdge(cur, s.to, s.from, amountG, { kind: 'payment', settlementId: s.id || null, label: s.note || 'Wpłata', amountG });
  });

  const result = {};
  for (const [cur, map] of Object.entries(byCur)) {
    const directed = [...map.values()];
    result[cur] = { directed, net: netDirected(directed) };
  }
  return result;
}

// Rozliczenie JEDNEJ grupy o zerowej sumie sald metodą zachłanną („max dłużnik ↔ max
// wierzyciel"). Dla grupy, której nie da się rozbić na mniejsze zerowe podgrupy, daje
// dokładnie n−1 przelewów, czyli tyle, ile wynosi optimum. Deterministyczna: sort malejąco
// po kwocie, remis po identyfikatorze.
function settleGroupGreedy(people) {
  const creditors = people.filter((p) => p.amt > 0).map((p) => ({ id: p.id, amt: p.amt }));
  const debtors = people.filter((p) => p.amt < 0).map((p) => ({ id: p.id, amt: -p.amt }));
  const cmp = (x, y) => (y.amt - x.amt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  creditors.sort(cmp); debtors.sort(cmp);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const t = Math.min(d.amt, c.amt);
    if (t > 0) transfers.push({ from: d.id, to: c.id, amountG: t });
    d.amt -= t; c.amt -= t;
    if (d.amt === 0) i++;
    if (c.amt === 0) j++;
  }
  return transfers;
}

// PODZIAŁ SALD NA ZEROWE PODGRUPY.
//
// Liczba przelewów = liczba osób − liczba rozłącznych podgrup sumujących się do zera,
// więc maksymalizacja podgrup to DOKŁADNIE minimalizacja przelewów. Cała trudność siedzi
// w znalezieniu tych podgrup; samo rozliczenie wewnątrz podgrupy robi już zachłanny.
//
// DLACZEGO NIE PRZEGLĄD PODGRUP DO STAŁEGO ROZMIARU (poprawione 2026-08-18, po pytaniu
// właściciela „czy ta matematyka na pewno działa przy piętnastu osobach"). Poprzednia wersja
// liczyła dokładnie tylko do czternastu osób (programowanie dynamiczne po wszystkich parach
// maska–podmaska, 3^n kroków), a wyżej szukała zerowych podgrup do sześciu osób. Pomiar na
// losowych saldach: przy 15 osobach gubiła przelew w 9,5% układów, przy 16 w 20,5%, przy
// 18–20 w około 30%. Przyczyna wyszła dopiero po rozbiciu przegranych układów — optimum
// wymagało tam podgrup SIEDMIO- DO DZIESIĘCIOOSOBOWYCH, których przegląd do sześciu nie
// mógł zobaczyć. Podnoszenie tego limitu nie było wyjściem: koszt to C(n,k), a przy dwudziestu
// osobach trzeba by szukać dziesiątek.
//
// Zamiast tego wypisujemy WSZYSTKIE zerowe podzbiory metodą spotkania w środku (2^(n/2)
// zamiast 2^n pamięci), a potem szukamy najlepszego podziału już tylko po nich. Zerowych
// podzbiorów jest przy realnych saldach garstka (mediana 27 przy dwudziestu osobach), więc
// jest to i dokładne, i szybkie: 0,2 ms przy 20 osobach, 0,8 ms przy 25 — wobec 4 ms, jakie
// stara wersja potrzebowała na samych czternastu.

// Powyżej tylu osób maska bitowa nie mieści się już bezpiecznie w liczbie całkowitej,
// której JavaScript używa w operatorach bitowych. Takie grupy najpierw odchudzamy o pary.
const MAX_BITMASK_PEOPLE = 30;

// Bezpieczniki. Przy saldach zbitych w wąskim zakresie (wszyscy winni wielokrotność
// dziesięciu złotych) zerowych podzbiorów bywają miliony i samo ich wypisanie zamroziłoby
// telefon. Po przekroczeniu któregokolwiek limitu schodzimy na podział rekurencyjny.
const ZERO_SUBSET_CAP = 20000;
const MAX_DP_STATES = 200000;

// Sumy WSZYSTKICH podzbiorów listy, indeksowane maską. Float64Array, nie Int32Array:
// w groszach suma potrafi przekroczyć zakres liczby 32-bitowej, a zawinięcie oznaczałoby
// uznanie niezerowej podgrupy za zerową i po cichu błędny plan.
function subsetSums(list) {
  const sums = new Float64Array(1 << list.length);
  for (let m = 1; m < sums.length; m++) {
    const low = m & -m;
    sums[m] = sums[m ^ low] + list[31 - Math.clz32(low)].amt;
  }
  return sums;
}

// SPOTKANIE W ŚRODKU. Dzielimy ludzi na dwie połowy, liczymy sumy podzbiorów każdej z nich
// i łączymy te, które się znoszą. Zamiast 2^n przeglądamy 2^(n/2) — przy trzydziestu osobach
// to 32 tysiące zamiast miliarda.
function allZeroSubsets(people) {
  const half = people.length >> 1;
  const sumsA = subsetSums(people.slice(0, half));
  const sumsB = subsetSums(people.slice(half));

  const bySum = new Map();
  for (let m = 0; m < sumsB.length; m++) {
    const list = bySum.get(sumsB[m]);
    if (list) list.push(m); else bySum.set(sumsB[m], [m]);
  }

  const masks = [];
  for (let ma = 0; ma < sumsA.length; ma++) {
    const list = bySum.get(-sumsA[ma]);
    if (!list) continue;
    for (const mb of list) {
      const mask = ma | (mb << half);
      if (mask === 0) continue;
      masks.push(mask);
      if (masks.length > ZERO_SUBSET_CAP) return null; // za gęsto — patrz bezpieczniki
    }
  }
  return masks;
}

// Maksymalny podział na zerowe podgrupy — dokładny, ale liczony tylko po zerowych
// podzbiorach zamiast po wszystkich podmaskach. Zwraca null, gdy układ okazał się zbyt gęsty.
function exactZeroSumGroups(people) {
  const zeros = allZeroSubsets(people);
  if (!zeros) return null;

  // Podgrupa musi zawierać najniższy bit rozpatrywanej maski — bez tego liczylibyśmy
  // ten sam podział wielokrotnie, raz na każdą kolejność podgrup.
  const byLowestBit = new Map();
  for (const z of zeros) {
    const low = z & -z;
    const list = byLowestBit.get(low);
    if (list) list.push(z); else byLowestBit.set(low, [z]);
  }

  const best = new Map();   // maska -> najwięcej zerowych podgrup, na jakie da się ją rozłożyć
  const chosen = new Map(); // maska -> podgrupa wybrana do tego optimum
  let states = 0;
  const solve = (mask) => {
    if (mask === 0) return 0;
    const known = best.get(mask);
    if (known !== undefined) return known;
    if (++states > MAX_DP_STATES) return -1;
    let count = -1;
    let pick = 0;
    for (const z of byLowestBit.get(mask & -mask) || []) {
      if ((z & mask) !== z) continue;
      const rest = solve(mask ^ z);
      if (rest >= 0 && rest + 1 > count) { count = rest + 1; pick = z; }
    }
    best.set(mask, count);
    chosen.set(mask, pick);
    return count;
  };

  let mask = (1 << people.length) - 1;
  // Cały zbiór sumuje się do zera, więc rozkład zawsze istnieje; wynik poniżej jedynki
  // znaczy wyłącznie, że przerwał nas bezpiecznik.
  if (solve(mask) < 1) return null;

  const groups = [];
  while (mask > 0) {
    const z = chosen.get(mask);
    const group = [];
    for (let k = 0; k < people.length; k++) if (z & (1 << k)) group.push(people[k]);
    groups.push(group);
    mask ^= z;
  }
  return groups;
}

// Pierwszy WŁAŚCIWY (ani pusty, ani cały) zerowy podzbiór — też spotkaniem w środku.
// Trzymamy po kilka masek na sumę, bo pierwsza trafiona bywa właśnie tą odrzucaną.
function findProperZeroSubset(people) {
  const n = people.length;
  const half = n >> 1;
  const sumsA = subsetSums(people.slice(0, half));
  const sumsB = subsetSums(people.slice(half));

  const bySum = new Map();
  for (let m = 0; m < sumsB.length; m++) {
    const list = bySum.get(sumsB[m]);
    if (!list) bySum.set(sumsB[m], [m]);
    else if (list.length < 3) list.push(m);
  }

  const full = (1 << n) - 1;
  for (let ma = 0; ma < sumsA.length; ma++) {
    const list = bySum.get(-sumsA[ma]);
    if (!list) continue;
    for (const mb of list) {
      const mask = ma | (mb << half);
      if (mask !== 0 && mask !== full) return mask;
    }
  }
  return null;
}

// Awaryjny podział dla układów zbyt gęstych na przegląd dokładny: tnij po dowolnym
// znalezionym zerowym podzbiorze i powtórz po obu stronach. Nie gwarantuje optimum (wybór
// cięcia bywa nieszczęśliwy), ale widzi podgrupy KAŻDEGO rozmiaru, więc jest wyraźnie lepszy
// od dawnego przeglądu do sześciu osób.
function recursiveSplitGroups(people) {
  const mask = findProperZeroSubset(people);
  if (mask === null) return [people];
  const inside = [];
  const outside = [];
  people.forEach((p, i) => ((mask & (1 << i)) ? inside : outside).push(p));
  return [...recursiveSplitGroups(inside), ...recursiveSplitGroups(outside)];
}

// ODCHUDZANIE GRUPY WIĘKSZEJ NIŻ LIMIT MASEK.
//
// Szukamy małych zerowych podgrup przeglądem wprost i odrywamy je, ale TYLKO DOPÓKI reszta
// nie zejdzie do rozmiaru liczonego dokładnie. To ważne: pary są bezpieczne zawsze (wycięcie
// dwóch przeciwnych sald z zerowej podgrupy zostawia ją zerową, a z dwóch różnych podgrup
// robi jedną zerową — podgrup nigdy nie ubywa), natomiast trójki i większe są już
// zgadywaniem. Odrywamy więc najmniej, ile trzeba, i resztę oddajemy przeglądowi dokładnemu,
// zamiast psuć zgadywaniem cały podział.
const MAX_SCAN_GROUP = 6;
// Przegląd podgrup to C(n, k) kroków. Przy sześćdziesięciu osobach szóstek jest pięćdziesiąt
// milionów, więc bez budżetu telefon by stanął. Wyczerpanie budżetu kończy tylko ten
// przegląd — plan i tak powstanie, po prostu bez tej jednej podgrupy.
const SCAN_STEP_BUDGET = 2000000;

function peelSmallZeroSumGroups(people) {
  const rest = [...people];
  const groups = [];
  let budget = SCAN_STEP_BUDGET;

  // Pierwsza podgrupa zadanego rozmiaru sumująca się do zera. Rekurencja zamiast
  // zagnieżdżonych pętli — przy sześciu poziomach ręczne pisanie byłoby nieczytelne.
  const znajdz = (want, start, chosen, sum) => {
    if (chosen.length === want) return sum === 0 ? [...chosen] : null;
    for (let i = start; i < rest.length; i++) {
      if (--budget < 0) return null;
      chosen.push(i);
      const hit = znajdz(want, i + 1, chosen, sum + rest[i].amt);
      chosen.pop();
      if (hit) return hit;
    }
    return null;
  };

  for (let want = 2; want <= MAX_SCAN_GROUP && rest.length > MAX_BITMASK_PEOPLE; want++) {
    while (rest.length > MAX_BITMASK_PEOPLE && rest.length >= want && budget > 0) {
      const indeksy = znajdz(want, 0, [], 0);
      if (!indeksy) break;
      groups.push(indeksy.map((i) => rest[i]));
      // Od końca, żeby wcześniejsze indeksy nie przesunęły się przy usuwaniu.
      indeksy.slice().reverse().forEach((i) => rest.splice(i, 1));
    }
  }
  return { groups, rest };
}

function zeroSumGroups(people) {
  if (people.length <= MAX_BITMASK_PEOPLE) {
    return exactZeroSumGroups(people) || recursiveSplitGroups(people);
  }
  const { groups, rest } = peelSmallZeroSumGroups(people);
  if (!rest.length) return groups;
  // Nie dało się zejść pod limit masek — reszta idzie jedną podgrupą, czyli rozliczy się
  // zachłannie w n−1 przelewach. Gorzej się nie da, bo n−1 to sufit dla każdego planu.
  if (rest.length > MAX_BITMASK_PEOPLE) return [...groups, rest];
  return [...groups, ...zeroSumGroups(rest)];
}

// MINIMALIZACJA LICZBY PRZELEWÓW.
// Wejście: [{ from, to, amountG }] JEDNEJ waluty. Wynik: zestaw przelewów o minimalnej
// (przy realnych rozmiarach grupy) liczbie pozycji, zawsze ≤ n−1.
//
// DLACZEGO NIE SAM ZACHŁANNY (poprawione 2026-08-16): „max dłużnik ↔ max wierzyciel" jest
// heurystyką i na ok. 5% losowych układów dawał JEDEN przelew więcej, niż trzeba. Przykład:
// salda −80, +100, −60, −40, +80 zachłanny rozlicza czterema przelewami, a wystarczą trzy,
// bo −80 i +80 znoszą się parą, a reszta (+100, −60, −40) domyka się osobno.
// Liczba przelewów to (liczba osób z niezerowym saldem) − (liczba rozłącznych podgrup
// sumujących się do zera), więc szukamy najpierw takich podgrup, a dopiero w każdej z nich
// rozliczamy zachłannie — wewnątrz niepodzielnej podgrupy zachłanny jest już optymalny.
// Podgrupy znajduje zeroSumGroups; opis metody i pomiary są przy jego definicji.
export function simplifyDebts(debts) {
  const balance = new Map();
  (debts || []).forEach((d) => {
    balance.set(d.from, (balance.get(d.from) || 0) - d.amountG);
    balance.set(d.to, (balance.get(d.to) || 0) + d.amountG);
  });
  const people = [];
  for (const [id, amt] of balance) if (amt !== 0) people.push({ id, amt });
  if (people.length < 2) return [];
  // Stała kolejność wejścia → stały wynik niezależnie od kolejności wpisywania rachunków.
  people.sort((x, y) => (y.amt - x.amt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  return zeroSumGroups(people).flatMap((g) => settleGroupGreedy(g));
}
