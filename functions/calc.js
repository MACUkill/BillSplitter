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
  (bill.sharedCosts || []).forEach((sc) => {
    const g = toGrosze(sc.amount || 0);
    const hasTaker = (sc.sharedBy || []).some((id) => active.some((a) => a.id === id));
    if (hasTaker) sharedAssignedG += g;
    else sharedOrphanG += g;
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

  return { shares, individualSubtotalG, sharedTotalG, sharedAssignedG, sharedOrphanG, globalTotalG };
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
    shares, individualSubtotalG, sharedTotalG, sharedAssignedG, sharedOrphanG, globalTotalG,
  } = advancedExactSharesGrosze(bill);

  const activeCount = shares.filter((s) => isActive(s.participant)).length;

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
  const perPersonUnallocatedG = activeCount > 0 ? unallocatedG / activeCount : 0;

  const participantTotals = shares.map((s) => {
    const restG = isActive(s.participant) ? perPersonUnallocatedG : 0;
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

  const controlSum = participantTotals.reduce((sum, pt) => sum + pt.total, 0);
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

// Powyżej tylu osób w jednej podgrupie rezygnujemy z dokładnego podziału na rzecz
// wyszukiwania małych zerowych podgrup. 3^14 ≈ 4,8 mln kroków liczy się w kilkadziesiąt
// milisekund; wyżej rośnie trzykrotnie na osobę i zaczęłoby zamrażać telefon.
const EXACT_PARTITION_LIMIT = 14;

// Maksymalny podział zbioru sald na rozłączne podgrupy sumujące się do zera (dokładny,
// programowanie dynamiczne po maskach). Liczba przelewów = liczba osób − liczba podgrup,
// więc maksymalizacja podgrup to dokładnie minimalizacja przelewów.
function exactZeroSumGroups(people) {
  const n = people.length;
  const size = 1 << n;
  const sum = new Int32Array(size);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + people[31 - Math.clz32(low)].amt;
  }
  const best = new Int32Array(size).fill(-1);
  const pick = new Int32Array(size);
  best[0] = 0;
  for (let m = 1; m < size; m++) {
    const low = m & -m; // podgrupa musi zawierać najniższy bit — bez tego liczylibyśmy
    let b = -1;         // ten sam podział wielokrotnie w różnej kolejności
    for (let s = m; s > 0; s = (s - 1) & m) {
      if (!(s & low) || sum[s] !== 0) continue;
      const prev = best[m ^ s];
      if (prev >= 0 && prev + 1 > b) { b = prev + 1; pick[m] = s; }
    }
    best[m] = b;
  }
  const groups = [];
  let mask = size - 1;
  while (mask > 0 && best[mask] > 0) {
    const s = pick[mask];
    const group = [];
    for (let k = 0; k < n; k++) if (s & (1 << k)) group.push(people[k]);
    groups.push(group);
    mask ^= s;
  }
  return groups.length ? groups : [people];
}

// Wyszukiwanie zerowych podgrup rozmiaru 2 i 3 przy dużej liczbie osób. Pary są bezpieczne
// zawsze (wycięcie pary o przeciwnych saldach z większej zerowej grupy zostawia grupę nadal
// zerową, więc nigdy nie zmniejsza liczby podgrup). Trójki są już heurystyką, ale nie
// pogarszają wyniku względem samego zachłannego rozliczenia.
function heuristicZeroSumGroups(people) {
  const rest = [...people];
  const groups = [];
  for (let sizeWanted = 2; sizeWanted <= 3; sizeWanted++) {
    let found = true;
    while (found) {
      found = false;
      outer:
      for (let a = 0; a < rest.length; a++) {
        for (let b = a + 1; b < rest.length; b++) {
          if (sizeWanted === 2) {
            if (rest[a].amt + rest[b].amt === 0) {
              groups.push([rest[a], rest[b]]);
              rest.splice(b, 1); rest.splice(a, 1);
              found = true; break outer;
            }
            continue;
          }
          for (let c = b + 1; c < rest.length; c++) {
            if (rest[a].amt + rest[b].amt + rest[c].amt === 0) {
              groups.push([rest[a], rest[b], rest[c]]);
              rest.splice(c, 1); rest.splice(b, 1); rest.splice(a, 1);
              found = true; break outer;
            }
          }
        }
      }
    }
  }
  if (rest.length) groups.push(rest);
  return groups;
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

  const groups = people.length <= EXACT_PARTITION_LIMIT
    ? exactZeroSumGroups(people)
    : heuristicZeroSumGroups(people);

  return groups.flatMap((g) => settleGroupGreedy(g));
}
