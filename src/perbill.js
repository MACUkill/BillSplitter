// TRYB „RACHUNEK PO RACHUNKU" — dług widziany rachunek po rachunku, bez zwijania.
//
// DLACZEGO osobny moduł. Aplikacja umie od 2026-08-26 rozliczać się na trzy sposoby
// i wszystkie trzy są JEDNĄ DRABINĄ ZWIJANIA tego samego długu:
//
//   „Najmniej przelewów"  — zwija MIĘDZY OSOBAMI (simplifyDebts): optymalizuje trasę.
//   „Kto komu"            — zwija NA OSOBIE (netDirected): sumuje należności wobec jednej.
//   „Rachunek po rachunku" — NIE ZWIJA NIC: wiersz na każdy rachunek, w kolejności dodawania.
//
// Ten moduł jest ostatnim szczeblem: rozkłada wpłaty z rejestru z powrotem na rachunki,
// z których wzięły się długi. Reszta matematyki (udziały, netowanie, plan minimalny)
// mieszka w functions/calc.js i tu jej nie powtarzamy — bierzemy stamtąd computeBillDebts,
// żeby kwota długu na tym ekranie była CO DO GROSZA tą, którą dłużnik widzi na rachunku.
//
// REGUŁA PRZYPISANIA WPŁATY — TYLKO W OBRĘBIE PARY.
// Wpłata X→Y gasi wyłącznie długi X wobec Y, od najstarszego rachunku. Wcześniejsza wersja
// tej reguły (najstarszy dług X wobec KOGOKOLWIEK) była błędna: pokazywałaby rachunek jako
// spłacony Markowi, choć pieniądze poszły do Oli. Przy cudzych pieniądzach to nie jest
// nieścisłość, tylko fałszywy dowód wpłaty.
//
// CZEGO NIE DA SIĘ PRZYPISAĆ, TO SIĘ PRZYZNAJE. Wpłata poprowadzona planem minimalnym
// („Kuba płaci Oli za dług wobec Marka") nie ma po stronie pary ANI JEDNEGO rachunku,
// więc nie gasi tu niczego. Nie wolno jej ani ukryć, ani doliczyć na siłę do cudzego
// rachunku: ląduje w osobnym bloku „Wpłaty bez przypisania" i wchodzi do linii
// uzgadniającej, żeby Bilans i lista rachunków nie mówiły dwóch różnych rzeczy.
import { computeBillDebts, toGrosze, billSettleGate, settlementCountsInLedger } from './calc.js';

// Czas powstania rachunku/wpłaty w milisekundach. Dokumenty z Firestore niosą Timestamp,
// testy — zwykłą liczbę, a świeżo zapisany dokument offline nie ma jeszcze czasu
// serwerowego (null). Kolejność musi być stabilna w każdym z tych trzech przypadków,
// bo od niej zależy, KTÓRY rachunek wpłata zgasi.
const timeOf = (doc) => {
  if (!doc) return 0;
  if (typeof doc.createdAtMs === 'number' && Number.isFinite(doc.createdAtMs)) return doc.createdAtMs;
  if (doc.createdAt && typeof doc.createdAt.toMillis === 'function') {
    const ms = doc.createdAt.toMillis();
    if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  }
  return 0;
};

// Remis po czasie rozstrzyga identyfikator — inaczej dwa rachunki dodane w tej samej
// sekundzie (albo dwa jeszcze bez czasu serwerowego) gasiłyby się w kolejności zależnej
// od tego, w jakiej kolejności przyszedł nasłuch. Ten sam ekran pokazywałby wtedy raz
// jedno, raz drugie.
const byTimeThenId = (a, b) => (a.at - b.at) || (String(a.billId) < String(b.billId) ? -1 : String(a.billId) > String(b.billId) ? 1 : 0);

const pairKey = (from, to, currency) => `${from}|${to}|${currency}`;

// GŁÓWNE WEJŚCIE. Zwraca długi rozpisane na rachunki, z naniesionymi wpłatami.
//
//   rows       — [{ billId, billName, currency, debtor, payer, shareG, paidG, openG, at }]
//                jeden wiersz na parę (dłużnik, rachunek). `shareG` to udział z rachunku,
//                `paidG` — ile z niego zgasiły wpłaty, `openG` — ile zostaje.
//   unassigned — [{ settlementId, from, to, currency, amountG, leftG, at }]
//                wpłaty, których nie było do czego przypisać (w całości albo w reszcie).
//
// Wpłaty NIEPOTWIERDZONE liczą się tak samo jak potwierdzone — dokładnie jak w buildLedger.
// Gdyby było inaczej, ten ekran pokazywałby dług, który dłużnik uważa za spłacony,
// a Bilans obok — już nie. Potwierdzenie jest tu mechanizmem zaufania, nie warunkiem
// istnienia wpłaty; niepotwierdzone widać w rejestrze i w skrzynce odbiorcy.
export function billLedger(bills, settlements) {
  const rows = [];
  (bills || []).forEach((bill) => {
    if (!bill) return;
    const at = timeOf(bill);
    computeBillDebts(bill).forEach((d) => {
      rows.push({
        billId: d.billId,
        billName: d.billName,
        currency: d.currency,
        debtor: d.from,
        payer: d.to,
        shareG: d.amountG,
        paidG: 0,
        at,
      });
    });
  });

  // Indeks po parze, żeby wpłata nie przeglądała wszystkich rachunków pokoju.
  // Wewnątrz pary od najstarszego — to jest cała reguła kolejności.
  const byPair = new Map();
  rows.forEach((r) => {
    const k = pairKey(r.debtor, r.payer, r.currency);
    const list = byPair.get(k);
    if (list) list.push(r); else byPair.set(k, [r]);
  });
  byPair.forEach((list) => list.sort(byTimeThenId));

  const unassigned = [];
  // Wpłaty nanosimy OD NAJSTARSZEJ. Kolejność nie zmienia sumy, ale zmienia, który
  // rachunek zostaje otwarty — a to jest treść tego ekranu.
  const ordered = [...(settlements || [])].sort((a, b) => timeOf(a) - timeOf(b));

  ordered.forEach((s) => {
    if (!s || !s.from || !s.to || s.from === s.to) return;
    // Sporna i wycofana wpłata NIE gasi rachunku i NIE trafia do „bez przypisania" —
    // dla księgi po prostu jej nie ma. Reguła stoi w `settlementCountsInLedger`,
    // wspólna z `buildLedger`, żeby oba ekrany nie mówiły dwóch różnych rzeczy.
    if (!settlementCountsInLedger(s)) return;
    const currency = s.currency || 'PLN';
    const amountG = toGrosze(s.amount || 0);
    if (amountG <= 0) return;
    let leftG = amountG;

    const list = byPair.get(pairKey(s.from, s.to, currency)) || [];
    // WSKAZANE RACHUNKI GASZĄ SIĘ PIERWSZE I TYLKO ONE, gdy człowiek wybrał je wprost.
    //
    // `billIds` powstaje w arkuszu „Za co płacisz": jeden przelew w banku bywa zapłatą
    // za kilka rachunków i wtedy wiadomo dokładnie, za które. Reguła „od najstarszego"
    // byłaby tu wprost szkodliwa — przy odznaczeniu środkowego rachunku zgasiłaby nie te,
    // które człowiek wybrał, a odbiorca nie miałby skąd wiedzieć, za co dostał pieniądze.
    //
    // Reszta pary WCHODZI DALEJ jako zapas na nadwyżkę: przelew większy niż suma
    // wybranych rachunków to najczęściej dopłata do pozostałych, a nie pomyłka.
    // `billId` (jeden napis) obsługujemy dla zgodności ze wpłatami zapisanymi, zanim
    // pojawił się wybór wielu rachunków.
    const wskazane = Array.isArray(s.billIds) && s.billIds.length
      ? s.billIds
      : (s.billId ? [s.billId] : []);
    const targets = wskazane.length
      ? [...list.filter((r) => wskazane.includes(r.billId)), ...list.filter((r) => !wskazane.includes(r.billId))]
      : list;

    targets.forEach((r) => {
      if (leftG <= 0) return;
      const take = Math.min(leftG, r.shareG - r.paidG);
      if (take <= 0) return;
      r.paidG += take;
      leftG -= take;
    });

    if (leftG > 0) {
      unassigned.push({
        settlementId: s.id || null,
        from: s.from,
        to: s.to,
        currency,
        amountG,
        leftG,
        at: timeOf(s),
      });
    }
  });

  rows.forEach((r) => { r.openG = r.shareG - r.paidG; });
  rows.sort(byTimeThenId);
  return { rows, unassigned };
}

// MOJE RACHUNKI DO ODDANIA — w kolejności dodawania, bez ani jednego podsumowania
// po osobie. Kto chce wiedzieć, ile łącznie idzie do Marka, przełącza się na „Kto komu";
// dowożenie tego tutaj zamieniłoby trzy tryby w trzy księgowości.
export function myBillsToPay({ rows } = {}, myId) {
  if (!myId) return [];
  return (rows || []).filter((r) => r.debtor === myId && r.openG > 0);
}

// KTO JUŻ ODDAŁ ZA TEN RACHUNEK — widok płatnika, dostępny W KAŻDYM TRYBIE.
// Pytanie „oddałeś mi za tę kolację?" pada zawsze, niezależnie od tego, jak grupa
// umówiła się rozliczać, a do 2026-08-26 rachunek nie miał na nie ani słowa odpowiedzi.
export function billSettledBy({ rows } = {}, billId) {
  return (rows || [])
    .filter((r) => r.billId === billId)
    .map((r) => ({
      debtor: r.debtor,
      currency: r.currency,
      shareG: r.shareG,
      paidG: r.paidG,
      openG: r.openG,
      settled: r.openG <= 0,
    }));
}

// Wpłaty bez przypisania widziane z MOJEJ strony: te, które wysłałem (obciążają mnie,
// choć nie gaszą żadnego rachunku) i te, które dostałem.
export function myUnassigned({ unassigned } = {}, myId) {
  if (!myId) return { sent: [], received: [] };
  return {
    sent: (unassigned || []).filter((u) => u.from === myId),
    received: (unassigned || []).filter((u) => u.to === myId),
  };
}

// LINIA UZGADNIAJĄCA: „5 rachunków 130,00 · wpłata bez przypisania −30,00 · zostaje 100,00".
//
// Bez niej ten ekran i Bilans mówiłyby dwie różne rzeczy o tej samej sytuacji: lista
// rachunków pokazywałaby 130 do oddania, a saldo na czysto 100, bo trzydziestkę wysłano
// planem minimalnym w bok. Różnicy nie da się schować — da się ją tylko nazwać.
export function reconcileToPay(result, myId, currency) {
  const bills = myBillsToPay(result, myId).filter((r) => r.currency === currency);
  const billsG = bills.reduce((s, r) => s + r.openG, 0);
  const unassignedG = myUnassigned(result, myId).sent
    .filter((u) => u.currency === currency)
    .reduce((s, u) => s + u.leftG, 0);
  return {
    currency,
    billCount: bills.length,
    billsG,
    unassignedG,
    // Saldo nie schodzi poniżej zera: nadpłata jest należnością, a nie ujemnym długiem,
    // i pokazuje ją druga strona ekranu („dostajesz").
    restG: Math.max(0, billsG - unassignedG),
  };
}

// Waluty, w których mam cokolwiek do oddania albo wysłałem wpłatę bez przypisania.
// Waluty NIGDY się nie mieszają (PRODUCT.md), więc każda dostaje własną linię.
export function currenciesToPay(result, myId) {
  const set = new Set(myBillsToPay(result, myId).map((r) => r.currency));
  myUnassigned(result, myId).sent.forEach((u) => set.add(u.currency));
  return [...set];
}

// SALDO NA CZYSTO LICZONE Z TEGO MODUŁU — istnieje wyłącznie po to, żeby dało się je
// porównać z `myNetByCurrency` z plan.js. To jest NIEZMIENNIK całej trójki trybów:
// tryb zmienia trasę pieniędzy i grubość ziarna, nigdy wynik. Gdyby te dwie liczby
// się rozjechały, trzy tryby stałyby się trzema księgowościami — a to jedyna rzecz,
// której w aplikacji o cudzych pieniądzach nie wolno zrobić.
export function netFromBills({ rows, unassigned } = {}, myId) {
  const out = {};
  const add = (cur, g) => { out[cur] = (out[cur] || 0) + g; };
  (rows || []).forEach((r) => {
    if (r.payer === myId) add(r.currency, r.openG);
    else if (r.debtor === myId) add(r.currency, -r.openG);
  });
  (unassigned || []).forEach((u) => {
    // Wpłata, której nie było do czego przypisać, jest nadpłatą: kto ją wysłał, ma
    // u odbiorcy należność dokładnie tej wielkości.
    if (u.from === myId) add(u.currency, u.leftG);
    else if (u.to === myId) add(u.currency, -u.leftG);
  });
  for (const [cur, g] of Object.entries(out)) if (g === 0) delete out[cur];
  return out;
}

// KTÓRE RACHUNKI W OGÓLE TRAFIAJĄ NA EKRANY O PIENIĄDZACH (decyzja właściciela 2026-08-27).
//
// Wejściem jest lista rachunków, które już przeszły `billCountsInLedger` — czyli takich,
// z których wolno się rozliczać albo kiedyś było wolno. Ta funkcja odejmuje z niej jeszcze
// jedną rzecz: rachunki, które SIĘ NIE SPINAJĄ.
//
// „Nie spina się" (`billSettleGate` → 'over') znaczy, że suma pozycji kłóci się z kwotą,
// którą płatnik realnie wyłożył. Aplikacja nie była w restauracji i nie wie, która z tych
// dwóch liczb jest prawdziwa — więc udziały policzone z takiego rachunku są ZMYŚLONE.
// Brama zatrzymuje je na ekranie samego rachunku, ale Bilans i Rozliczenia sumują długi
// z wielu rachunków naraz i o bramę nie pytały: pokazywały kwotę zawyżoną razem z żywym
// przyciskiem „Ureguluj". Dłużnik, który do tego rachunku nie zaglądał, nie miał jak się
// zorientować, bo nie ma z czym porównać zsumowanej liczby.
//
// JEDEN WYJĄTEK, BEZ KTÓREGO LEK BYŁBY GORSZY OD CHOROBY.
// Wpłata musi mieć w księdze dług, który gasi. Rachunek wyjęty z księgi zostawia wpłaty
// za niego w powietrzu, a `buildLedger` wyciąga z tego jedyny możliwy wniosek: że to
// PŁATNIK jest winien pieniądze temu, kto mu właśnie zapłacił. Dlatego rachunek, do którego
// ktokolwiek już dopłacił, ZOSTAJE — z zawyżoną kwotą, ale bez odwróconego kierunku.
// W praktyce rzadkie: rachunek psuje się prawie zawsze, zanim ktokolwiek zdążył cokolwiek oddać.
export function ledgerVisibleBills(bills, settlements) {
  const wszystkie = bills || [];
  const zepsute = wszystkie.filter((b) => billSettleGate(b).reason === 'over');
  // Najczęstszy przypadek wychodzi tędy, bez przypisywania wpłat do rachunków.
  if (zepsute.length === 0) return wszystkie;
  // Przypisanie MUSI iść po pełnej liście — inaczej pytalibyśmy o wpłaty tę samą listę,
  // którą dopiero układamy.
  const pelna = billLedger(wszystkie, settlements);
  const zostaja = new Set(
    zepsute
      .filter((b) => billSettledBy(pelna, b.id).some((x) => x.paidG > 0))
      .map((b) => b.id),
  );
  return wszystkie.filter((b) => billSettleGate(b).reason !== 'over' || zostaja.has(b.id));
}
