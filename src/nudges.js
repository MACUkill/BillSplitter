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
