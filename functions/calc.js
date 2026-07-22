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
  const sharedTotalG = (bill.sharedCosts || []).reduce((s, sc) => s + toGrosze(sc.amount || 0), 0);
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

  return { shares, individualSubtotalG, sharedTotalG, globalTotalG };
}

// Kontrola poprawności: suma DOKŁADNYCH pozycji vs kwota rachunku.
// status: 'ok' | 'over' | 'under' | 'empty'
function computeControl(enteredSubtotalG, billTotalG) {
  const enteredRoundedG = Math.round(enteredSubtotalG);
  if (billTotalG <= 0) {
    return { status: 'empty', diff: 0, enteredSubtotal: fromGrosze(enteredRoundedG), expectedTotal: 0 };
  }
  const diffG = enteredRoundedG - billTotalG;
  let status;
  if (Math.abs(diffG) <= TOLERANCE_GROSZE) status = 'ok';
  else if (diffG > 0) status = 'over';   // za dużo — ktoś przeliczył / podwójna pozycja
  else status = 'under';                 // za mało — ktoś nie wpisał pozycji
  return {
    status,
    diff: fromGrosze(Math.abs(diffG)),
    enteredSubtotal: fromGrosze(enteredRoundedG),
    expectedTotal: fromGrosze(billTotalG),
  };
}

// --- API publiczne ---

// Rachunek ZAAWANSOWANY (i domyślny). Zwraca udziały ZAOKRĄGLONE W GÓRĘ + kontrolę.
export const calculateAll = (bill) => {
  const { shares, individualSubtotalG, sharedTotalG, globalTotalG } = advancedExactSharesGrosze(bill);

  const participantTotals = shares.map((s) => {
    const totalG = s.exactG > 0 ? ceilGrosze(s.exactG) : 0; // W GÓRĘ do grosza
    return {
      participant: s.participant,
      individualAmount: fromGrosze(s.individualG),
      sharedAmount: fromGrosze(s.sharedG),        // dokładne (informacyjnie)
      globalCostsAmount: fromGrosze(s.globalG),   // dokładne (informacyjnie)
      total: fromGrosze(totalG),                  // ZAOKRĄGLONE W GÓRĘ — kwota do zapłaty
      exactTotal: fromGrosze(s.exactG),           // dokładny udział (bez zaokrąglenia)
    };
  });

  const controlSum = participantTotals.reduce((sum, pt) => sum + pt.total, 0);
  const enteredSubtotalG = individualSubtotalG + sharedTotalG + globalTotalG;
  const control = computeControl(enteredSubtotalG, toGrosze(bill.totalAmount || 0));

  return { participantTotals, controlSum, control };
};

// Rachunek PROSTY: cała kwota po równo między aktywnych, zaokrąglona W GÓRĘ.
export const calculateSimple = (bill) => {
  const participants = Object.values(bill.participants || {});
  const active = participants.filter(isActive);
  const numActive = active.length;
  const billTotalG = toGrosze(bill.totalAmount || 0);

  const exactPerPersonG = numActive > 0 ? billTotalG / numActive : 0;
  const perPersonG = numActive > 0 ? ceilGrosze(exactPerPersonG) : 0; // W GÓRĘ

  const participantTotals = participants.map((p) => ({
    participant: p,
    total: isActive(p) ? fromGrosze(perPersonG) : 0,
    exactTotal: isActive(p) ? fromGrosze(exactPerPersonG) : 0,
  }));

  const controlSum = participantTotals.reduce((sum, pt) => sum + pt.total, 0);
  // Udziały pochodzą wprost z kwoty rachunku — kontrola zawsze OK (albo pusta).
  const control = {
    status: billTotalG > 0 ? 'ok' : 'empty',
    diff: 0,
    enteredSubtotal: fromGrosze(billTotalG),
    expectedTotal: fromGrosze(billTotalG),
  };

  return {
    participantTotals,
    controlSum,
    control,
    amountPerPerson: fromGrosze(perPersonG),        // zaokrąglone w górę
    exactAmountPerPerson: fromGrosze(exactPerPersonG),
  };
};

// Wybór wg typu rachunku (używane m.in. w podsumowaniu na dashboardzie).
export const calculateAllForBill = (bill) => {
  if (bill && bill.type === 'simple') {
    return calculateSimple(bill);
  }
  return calculateAll(bill);
};

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
