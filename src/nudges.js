// Pure helpery przypomnień (nudge-windykator). Trzymane osobno od matmy rachunków
// (calc.js) — to logika UI/powiadomień, nie liczenie pieniędzy.

// Ile nieprzeczytanych przypomnień skierowanych DO MNIE — licznik na dzwonku.
// nudges: [{ to, readBy? }], myId: id członka, myUid: uid zalogowanego.
export function unreadNudgeCount(nudges, myId, myUid) {
  if (!Array.isArray(nudges) || !myId) return 0;
  return nudges.reduce((count, x) => {
    const toMe = x && x.to === myId;
    const read = Array.isArray(x && x.readBy) && x.readBy.includes(myUid);
    return count + (toMe && !read ? 1 : 0);
  }, 0);
}

// --- PRÓG SYGNAŁU (docs/UI-UX.md §10.2) -------------------------------------
// Trzy poziomy i jedna twarda reguła: sygnał KOSZTUJE, więc dostaje go tylko to,
// co dotyczy moich pieniędzy albo mojego ruchu.
//
//   Poziom 1 — push i odznaka LICZBOWA. Domyka dług: przypomnienie do mnie,
//              cudza wpłata czekająca na moje potwierdzenie, potwierdzenie mojej
//              wpłaty przez odbiorcę.
//   Poziom 2 — sama KROPKA na zakładce. Coś mnie dotyczy, ale nie ma pilności:
//              rachunek czeka na mój ruch.
//   Poziom 3 — zero sygnału. Wchodzisz, kiedy chcesz wiedzieć.
//
// Nic, co zrobiłem sam, nie generuje sygnału dla mnie — stąd `myId`/`myUid`
// w każdym warunku.
//
// Funkcja jest czysta i dostaje gotowe dane, żeby próg dało się przetestować bez
// bazy: to on decyduje, czy użytkownik ufa czerwonej kropce, czy przestaje ją widzieć.
export function inboxItems({ nudges = [], settlements = [], actionBills = [], myId, myUid, seenConfirmations = [] } = {}) {
  if (!myId) return [];
  const items = [];

  nudges.forEach((n) => {
    if (!n || n.to !== myId) return;
    if (Array.isArray(n.readBy) && n.readBy.includes(myUid)) return;
    // `message` niesie treść napisaną przez człowieka — widzi ją wyłącznie adresat,
    // a tu i tak jesteśmy już po filtrze „do mnie".
    items.push({ level: 1, kind: 'nudge', id: n.id, from: n.from, amountG: n.amountG, currency: n.currency, message: n.message, at: n.createdAtMs });
  });

  settlements.forEach((s) => {
    if (!s) return;
    // `billId` jedzie dalej, bo od niego zależy, czy wiersz powie „za co". W trybie
    // rachunkowym pięć rachunków odklikniętych naraz daje PIĘĆ wpłat i pięć wierszy —
    // i tak ma zostać (decyzja właściciela: „robimy łopatologicznie bardzo"). Bez nazwy
    // rachunku byłoby to pięć identycznych wierszy z tą samą kwotą i tym samym imieniem.
    // Nazwę dokleja warstwa interfejsu — tu nie ma dostępu do rachunków.
    //
    // Ktoś zgłosił wpłatę DO MNIE i czeka na potwierdzenie — blokuje domknięcie długu.
    if (s.to === myId && s.from !== myId && !s.confirmed) {
      items.push({ level: 1, kind: 'confirm-payment', id: s.id, from: s.from, amountG: s.amountG, currency: s.currency, billId: s.billId || null, billIds: s.billIds || null, at: s.createdAtMs });
      return;
    }
    // Odbiorca potwierdził MOJĄ wpłatę — zamyka pętlę. Bez tego użytkownik nie wie,
    // że skończył. Znika po obejrzeniu (lista `seenConfirmations`).
    if (s.from === myId && s.confirmed && s.confirmedBy !== myUid && !seenConfirmations.includes(s.id)) {
      items.push({ level: 1, kind: 'payment-confirmed', id: s.id, from: s.to, amountG: s.amountG, currency: s.currency, billId: s.billId || null, billIds: s.billIds || null, at: s.confirmedAtMs });
    }
  });

  actionBills.forEach((b) => {
    if (!b || !b.id) return;
    items.push({ level: 2, kind: 'bill-action', id: b.id, title: b.title, label: b.label, at: b.at });
  });

  // Najpilniejsze na górze, w obrębie poziomu najnowsze pierwsze — ALE WIERSZE TEJ SAMEJ
  // OSOBY STOJĄ RAZEM.
  //
  // DLACZEGO (etap 3): tryb „Rachunek po rachunku" mnoży wpłaty. Kto oddaje za pięć
  // rachunków, wysyła pięć wpłat, więc odbiorca dostaje odznakę „5" i pięć wierszy do
  // potwierdzenia. Zwijać ich nie wolno (decyzja właściciela) — ale rozsypane po
  // skrzynce między cudzymi sprawami zmuszają do pięciu osobnych decyzji o tej samej
  // osobie. Posortowane obok siebie są jedną sprawą z pięcioma stuknięciami.
  //
  // Kolejność OSÓB nadal idzie od najnowszej sprawy, więc świeże rzeczy zostają na górze:
  // sortujemy po najnowszym wpisie DANEJ OSOBY, a dopiero wewnątrz osoby po czasie.
  const newestByPerson = new Map();
  items.forEach((x) => {
    const key = `${x.level}|${x.from || ''}`;
    newestByPerson.set(key, Math.max(newestByPerson.get(key) || 0, x.at || 0));
  });
  const personKey = (x) => `${x.level}|${x.from || ''}`;
  return items.sort((a, b) =>
    (a.level - b.level)
    || ((newestByPerson.get(personKey(b)) || 0) - (newestByPerson.get(personKey(a)) || 0))
    || (personKey(a) < personKey(b) ? -1 : personKey(a) > personKey(b) ? 1 : 0)
    || ((b.at || 0) - (a.at || 0)));
}

// Odznaka liczbowa NALEŻY SIĘ WYŁĄCZNIE poziomowi 1. Poziom 2 dostaje kropkę bez
// liczby, poziom 3 nie zapala niczego — inaczej wracamy do ślepoty na czerwoną kropkę.
export function badgeCount(items) {
  return (items || []).filter((x) => x && x.level === 1).length;
}

export function hasDot(items) {
  return (items || []).some((x) => x && x.level === 2);
}

// Anty-spam: czy w oknie `windowMs` (od `nowMs`) już poszło przypomnienie fromId→toId?
// nudges muszą mieć `createdAtMs` (liczba); caller wyłuskuje z Timestamp.toMillis().
// Wpisy bez sensownego createdAtMs są ignorowane (świeżo dodane lokalnie, jeszcze bez serwerowego czasu).
export function hasRecentNudge(nudges, fromId, toId, nowMs, windowMs) {
  if (!Array.isArray(nudges)) return false;
  return nudges.some((x) => {
    if (!x || x.from !== fromId || x.to !== toId) return false;
    const ms = x.createdAtMs;
    return typeof ms === 'number' && Number.isFinite(ms) && (nowMs - ms) < windowMs;
  });
}
