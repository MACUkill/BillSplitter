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
    items.push({ level: 1, kind: 'nudge', id: n.id, from: n.from, amountG: n.amountG, currency: n.currency, at: n.createdAtMs });
  });

  settlements.forEach((s) => {
    if (!s) return;
    // Ktoś zgłosił wpłatę DO MNIE i czeka na potwierdzenie — blokuje domknięcie długu.
    if (s.to === myId && s.from !== myId && !s.confirmed) {
      items.push({ level: 1, kind: 'confirm-payment', id: s.id, from: s.from, amountG: s.amountG, currency: s.currency, at: s.createdAtMs });
      return;
    }
    // Odbiorca potwierdził MOJĄ wpłatę — zamyka pętlę. Bez tego użytkownik nie wie,
    // że skończył. Znika po obejrzeniu (lista `seenConfirmations`).
    if (s.from === myId && s.confirmed && s.confirmedBy !== myUid && !seenConfirmations.includes(s.id)) {
      items.push({ level: 1, kind: 'payment-confirmed', id: s.id, from: s.to, amountG: s.amountG, currency: s.currency, at: s.confirmedAtMs });
    }
  });

  actionBills.forEach((b) => {
    if (!b || !b.id) return;
    items.push({ level: 2, kind: 'bill-action', id: b.id, title: b.title, label: b.label, at: b.at });
  });

  // Najpilniejsze na górze, w obrębie poziomu najnowsze pierwsze.
  return items.sort((a, b) => (a.level - b.level) || ((b.at || 0) - (a.at || 0)));
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
