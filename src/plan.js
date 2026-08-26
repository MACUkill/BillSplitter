// Plan rozliczenia widziany OCZAMI JEDNEJ OSOBY.
//
// DLACZEGO osobny moduł: aplikacja ma od 2026-08-17 jedną odpowiedź na pytanie „co mam
// zrobić" — najkrótszy plan przelewów (`simplifyDebts`). Ekran Bilansu liczył dotąd
// własną regułą (długi para po parze), więc mówił co innego niż ekran rozliczeń: ta sama
// sytuacja miała dwa różne obrazy, a przycisk „Ureguluj" popychał do wolniejszego sposobu.
// Tu mieszka wspólne źródło prawdy dla obu ekranów, bez DOM-u i bez sieci — dzięki temu
// da się je przetestować.
import { simplifyDebts } from './calc.js';

// Moje przelewy z planu, per waluta. Waluty NIGDY się nie mieszają (PRODUCT.md), więc
// każda dostaje własny plan i własny wpis.
//
// `pay` bywa krótkie (w planie minimalnym zwykle zero albo jeden przelew), a `receive`
// potrafi być długie: kto wyłożył pieniądze za całą ekipę, dostaje wpłatę od kilkunastu
// osób. Ekran musi traktować te dwie strony inaczej i dlatego zwracamy je osobno,
// zamiast jednej wspólnej listy.
export function myPlanRows(ledger, myId) {
  const out = [];
  if (!ledger || !myId) return out;
  for (const [currency, data] of Object.entries(ledger)) {
    const plan = simplifyDebts((data && data.directed) || []);
    const pay = plan.filter((t) => t.from === myId).map((t) => ({ other: t.to, amountG: t.amountG }));
    const receive = plan.filter((t) => t.to === myId).map((t) => ({ other: t.from, amountG: t.amountG }));
    if (pay.length || receive.length) {
      out.push({
        currency,
        pay,
        receive,
        payTotalG: pay.reduce((s, r) => s + r.amountG, 0),
        receiveTotalG: receive.reduce((s, r) => s + r.amountG, 0),
      });
    }
  }
  // Największe zobowiązanie pierwsze — przy kilku walutach to ono pilniejsze.
  return out.sort((a, b) => (b.payTotalG + b.receiveTotalG) - (a.payTotalG + a.receiveTotalG));
}

// To samo, ale w trybie „Kto komu": bez optymalizacji trasy, para po parze.
//
// DLACZEGO TEN SAM KSZTAŁT WYNIKU co `myPlanRows`: Bilans rysuje „Co masz zrobić"
// jednym kawałkiem kodu, a tryb ma zmieniać wyłącznie to, SKĄD biorą się wiersze.
// Dwa osobne szablony na dwa tryby rozjechałyby się przy pierwszej poprawce w jednym
// z nich — a to są ekrany, na których ludzie podejmują decyzje o cudzych pieniądzach.
export function myNetRows(ledger, myId) {
  const out = [];
  if (!ledger || !myId) return out;
  for (const [currency, data] of Object.entries(ledger)) {
    const net = (data && data.net) || [];
    const pay = net.filter((t) => t.from === myId).map((t) => ({ other: t.to, amountG: t.amountG }));
    const receive = net.filter((t) => t.to === myId).map((t) => ({ other: t.from, amountG: t.amountG }));
    if (pay.length || receive.length) {
      out.push({
        currency,
        pay,
        receive,
        payTotalG: pay.reduce((s, r) => s + r.amountG, 0),
        receiveTotalG: receive.reduce((s, r) => s + r.amountG, 0),
      });
    }
  }
  return out.sort((a, b) => (b.payTotalG + b.receiveTotalG) - (a.payTotalG + a.receiveTotalG));
}

// Ile przelewów robi cała ekipa planem minimalnym, a ile robiłaby para po parze.
// Służy zdaniu „rozliczamy się w N przelewach zamiast w M" — liczby muszą być prawdziwe,
// więc liczymy je z danych, a nie wpisujemy na sztywno.
export function planVsPairwise(ledger) {
  let plan = 0;
  let pairwise = 0;
  for (const data of Object.values(ledger || {})) {
    plan += simplifyDebts((data && data.directed) || []).length;
    pairwise += ((data && data.net) || []).length;
  }
  return { plan, pairwise };
}

// SKĄD WZIĄŁ SIĘ WIERSZ „KTO KOMU": z rachunku czy z cudzej wpłaty poprowadzonej inaczej.
//
// USTERKA, KTÓRĄ TO NAPRAWIA (odtworzona na żywym kodzie 2026-08-25). Kuba jest winien
// Markowi 50, Marek Oli 50. Plan minimalny mówi „Kuba płaci Oli 50" i Kuba to robi.
// Po wpłacie salda wszystkich trzech osób są zerowe, plan minimalny jest pusty — a
// zakładka „Kto komu" pokazuje TRZY otwarte długi po 50, każdy z przyciskiem „Ureguluj".
// Trzeci z nich (Ola → Kuba) nie pochodzi z żadnego rachunku: powstał wyłącznie dlatego,
// że wpłata Kuby do Oli dokłada w `buildLedger` krawędź odwrotną. Marek mógł w dobrej
// wierze upomnieć się o 50 zł, których Kuba nie jest winien.
//
// Powód siedzi w `netDirected` (functions/calc.js): zwija długi WYŁĄCZNIE wewnątrz pary,
// więc cyklu nie widzi. `simplifyDebts` pracuje na saldach osób, więc cykl znika mu sam.
// Stąd dwa widoki i dwie różne prawdy o tej samej sytuacji.
//
// Pełna naprawa to rozłożenie wpłaty na długi, które faktycznie zgasiła — ta sama robota,
// co „za co" w planie minimalnym, i idzie razem z nią. Tutaj jest warstwa, która NICZEGO
// NIE UKRYWA, tylko nazywa pochodzenie wiersza. Ukrywanie byłoby błędem: kółko długów
// potrafi powstać z samych rachunków, bez ani jednej wpłaty, i wtedy są to długi prawdziwe,
// z prawdziwym „za co”.
//
// Zwraca 'bill' (są rachunki po którejś stronie pary), 'payment' (sama wpłata — wiersz
// widmo) albo 'none' (brak danych).
export function netRowOrigin(directed, from, to) {
  const edgeOf = (a, b) => (directed || []).find((d) => d && d.from === a && d.to === b);
  let hasBill = false;
  let hasPayment = false;
  [edgeOf(from, to), edgeOf(to, from)].forEach((e) => {
    ((e && e.contributions) || []).forEach((c) => {
      if (c && c.kind === 'payment') hasPayment = true;
      else hasBill = true;
    });
  });
  // Rachunek wygrywa nad wpłatą: dług z rachunku spłacony w części to nadal dług z rachunku,
  // a nie wiersz widmo. Znacznik należy się WYŁĄCZNIE wierszowi, za którym nie stoi
  // ani jeden rachunek.
  if (hasBill) return 'bill';
  if (hasPayment) return 'payment';
  return 'none';
}

// Saldo na czysto per waluta. NIEZMIENNIK, na którym stoi cały ten ekran: saldo jest
// identyczne w obu planach — plan zmienia wyłącznie TRASĘ pieniędzy, nie to, ile komu
// ostatecznie zostaje. Dzięki temu wielka liczba na Bilansie nie drgnie przy przełączeniu
// sposobu rozliczenia, a zmienia się tylko rozpisanie pod nią.
export function myNetByCurrency(ledger, myId) {
  const out = {};
  for (const [currency, data] of Object.entries(ledger || {})) {
    let saldo = 0;
    ((data && data.net) || []).forEach((t) => {
      if (t.to === myId) saldo += t.amountG;
      else if (t.from === myId) saldo -= t.amountG;
    });
    if (saldo !== 0) out[currency] = saldo;
  }
  return out;
}
