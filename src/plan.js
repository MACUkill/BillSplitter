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
