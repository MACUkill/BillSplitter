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
// `keepSettlements` — wpłaty, które PRZESTAŁY być sprawą, ale mają jeszcze chwilę
// postać na ekranie. Powód przy pętli niżej.
export function inboxItems({ nudges = [], settlements = [], actionBills = [], myId, myUid, seenConfirmations = [], keepSettlements = [], keepNudges = [] } = {}) {
  if (!myId) return [];
  const items = [];

  // Przypomnienia ZDJĘTE W TYM WEJŚCIU do skrzynki — ta sama zasada, co przy wpłatach
  // niżej: nic, co stuknąłeś, nie ucieka spod palca. Zdjęte przypomnienie zostaje jako
  // wiersz `resolved` (bez czynności) do następnego otwarcia.
  const trzymaneNudges = new Set(keepNudges);
  nudges.forEach((n) => {
    if (!n || n.to !== myId) return;
    const zdjete = Array.isArray(n.readBy) && n.readBy.includes(myUid);
    if (zdjete && !trzymaneNudges.has(n.id)) return;
    // `message` niesie treść napisaną przez człowieka — widzi ją wyłącznie adresat,
    // a tu i tak jesteśmy już po filtrze „do mnie".
    //
    // TRZY RODZAJE, TRZY RÓŻNE ŻĄDANIA (2026-08-26). Do wprowadzenia bramy rozliczeń
    // przypomnienie znaczyło zawsze „oddaj pieniądze", więc rodzaju nie było. Teraz doszły
    // dwa, które o pieniądze NIE proszą: „stuknij swoje pozycje" (rachunek czeka na
    // zamknięcie) i „to nie moje" (prośba o otwarcie rachunku z powrotem). Bez rozróżnienia
    // skrzynka podstawiałaby pod nie przycisk „Ureguluj" — czyli kazałaby płacić komuś,
    // kto nic nie jest winien, i to na rachunku, którego jeszcze nie da się rozliczyć.
    //
    // Poziom zostaje 1 dla wszystkich trzech: każde z nich wysłał ŻYWY CZŁOWIEK, który na
    // coś czeka. To jest dokładnie ten próg, który opisuje docs/UI-UX.md §10.2.
    const rodzaj = n.kind === 'fill' || n.kind === 'reopen' ? n.kind : 'debt';
    items.push({
      level: 1, kind: 'nudge', nudgeKind: rodzaj, id: n.id, from: n.from,
      // `resolved` trzyma wiersz z dala od odznaki: stoi jeszcze na ekranie, ale niczego
      // już nie żąda. Patrz `badgeCount`.
      ...(zdjete ? { resolved: true } : {}),
      amountG: n.amountG, currency: n.currency, message: n.message,
      billId: n.billId || null, billName: n.billName || '', at: n.createdAtMs,
    });
  });

  // Sprawa wynikająca z JEDNEJ wpłaty — albo `null`, gdy ta wpłata nikogo teraz nie woła.
  // Wydzielone z pętli (2026-09-02): pętla musi teraz wiedzieć nie tylko CO dopisać,
  // ale też CZY cokolwiek dopisała.
  const sprawaZeWplaty = (s) => {
    // `billId` jedzie dalej, bo od niego zależy, czy wiersz powie „za co". W trybie
    // rachunkowym pięć rachunków odklikniętych naraz daje PIĘĆ wpłat i pięć wierszy —
    // i tak ma zostać (decyzja właściciela: „robimy łopatologicznie bardzo"). Bez nazwy
    // rachunku byłoby to pięć identycznych wierszy z tą samą kwotą i tym samym imieniem.
    // Nazwę dokleja warstwa interfejsu — tu nie ma dostępu do rachunków.
    //
    // WYCOFANE ZGŁOSZENIE NIE JEST NICZYJĄ SPRAWĄ. Nadawca sam je zdjął („pomyłka,
    // nie wysłałem"), więc nie ma o co pytać ani czego domykać — zostaje wyłącznie
    // ślad w rejestrze.
    if (s.withdrawn) return null;

    // Ktoś zgłosił wpłatę DO MNIE i czeka na moją odpowiedź.
    //
    // Warunek obejmuje DWIE sytuacje, bo obie czekają na to samo słowo: świeże zgłoszenie
    // i takie, przy którym nadawca podtrzymał („wysłałem na pewno") po mojej odmowie.
    // Sprawa, na którą już odpowiedziałem odmownie, NIE wraca tutaj — piłka jest wtedy
    // po jego stronie, a wołanie mnie do czynności, której nie mam jak wykonać, jest
    // dokładnie tym, czego zabrania próg sygnału (docs/UI-UX.md §10.2).
    const czekaNaMnie = !s.confirmed && (!s.disputed || s.insisted) && !s.stalled;
    if (s.to === myId && s.from !== myId && czekaNaMnie) {
      return { level: 1, kind: 'confirm-payment', id: s.id, from: s.from, amountG: s.amountG, currency: s.currency, billId: s.billId || null, billIds: s.billIds || null, at: s.createdAtMs, insisted: !!s.insisted };
    }
    // Odbiorca NIE ZNALAZŁ mojego przelewu — i to jest sygnał poziomu 1, bo dług właśnie
    // wrócił na moje saldo. Bez tego wiersza pieniądze wracałyby znikąd i wyglądało
    // to na usterkę aplikacji, a nie na wiadomość od człowieka.
    if (s.from === myId && s.disputed && !s.insisted && !seenConfirmations.includes(s.id)) {
      return { level: 1, kind: 'payment-disputed', id: s.id, from: s.to, amountG: s.amountG, currency: s.currency, billId: s.billId || null, billIds: s.billIds || null, at: s.disputedAtMs || s.createdAtMs };
    }
    // Odbiorca potwierdził MOJĄ wpłatę — zamyka pętlę. Bez tego użytkownik nie wie,
    // że skończył. Znika po obejrzeniu (lista `seenConfirmations`).
    if (s.from === myId && s.confirmed && !s.disputed && s.confirmedBy !== myUid && !seenConfirmations.includes(s.id)) {
      return { level: 1, kind: 'payment-confirmed', id: s.id, from: s.to, amountG: s.amountG, currency: s.currency, billId: s.billId || null, billIds: s.billIds || null, at: s.confirmedAtMs };
    }
    return null;
  };

  // WIERSZ NIE ZNIKA POD PALCEM, KTÓRY WŁAŚNIE W NIEGO STUKNĄŁ (2026-09-02).
  //
  // „Mam" i „Wysłałem na pewno" ZDEJMUJĄ sprawę: po zapisie wpłata przestaje spełniać
  // warunki wyżej, więc wiersz wypada z listy. Gdyby wypadał natychmiast, dostalibyśmy
  // dwie usterki naraz. Po pierwsze: przy pięciu wpłatach od tej samej osoby (tryb
  // rachunkowy mnoży przelewy, a sortowanie niżej celowo stawia je obok siebie) drugie
  // stuknięcie trafiałoby w cel, który właśnie przeskoczył w górę — czyli w „Nie widzę"
  // sąsiedniej wpłaty. Po drugie: znikanie bez śladu czyta się jak „nie wiem, czy poszło",
  // a to jest dokładnie ta niepewność, od której zaczęła się ta poprawka.
  //
  // Warstwa interfejsu podaje więc identyfikatory wpłat rozstrzygniętych W TYM WEJŚCIU
  // do skrzynki. Taka wpłata zostaje na liście jako wiersz `settlement-resolved` — bez
  // przycisków, z aktualnym stanem — i znika dopiero przy następnym otwarciu.
  //
  // REGUŁA: mapa decyduje o OBECNOŚCI wiersza, dane decydują o jego WYGLĄDZIE. Dlatego
  // „Cofnij" nie potrzebuje własnej obsługi — wpłata wraca do stanu sprzed potwierdzenia,
  // `sprawaZeWplaty` znów zwraca sprawę i wiersz sam z siebie odzyskuje przyciski.
  const trzymane = new Set(keepSettlements);
  settlements.forEach((s) => {
    if (!s) return;
    const sprawa = sprawaZeWplaty(s);
    if (sprawa) { items.push(sprawa); return; }
    if (!trzymane.has(s.id)) return;
    // Cudza wpłata między dwiema innymi osobami nie jest moją sprawą nawet wtedy, gdy
    // jej identyfikator trafiłby tu przez pomyłkę.
    if (s.to !== myId && s.from !== myId) return;
    items.push({
      // Poziom 1 — bo wiersz stoi w tym samym miejscu listy, co przed stuknięciem.
      // `resolved` trzyma go z dala od ODZNAKI: liczba na dzwonku mówi, ile jeszcze
      // czeka, a ta sprawa już nie czeka. Patrz `badgeCount`.
      level: 1, resolved: true, kind: 'settlement-resolved', id: s.id,
      from: s.to === myId ? s.from : s.to,
      mine: s.from === myId,
      state: s.withdrawn ? 'withdrawn'
        : s.confirmed ? 'confirmed'
        : s.disputed ? (s.insisted ? 'insisted' : 'disputed')
        : 'open',
      amountG: s.amountG, currency: s.currency,
      billId: s.billId || null, billIds: s.billIds || null,
      // Czas ZGŁOSZENIA, nie rozstrzygnięcia: sortowanie niżej ustawia sprawy po czasie,
      // więc stempel „przed chwilą" wyrzuciłby wiersz na górę listy — czyli zrobiłby
      // dokładnie ten skok, któremu całe to trzymanie ma zapobiec.
      at: s.createdAtMs,
    });
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
  // Sprawa rozstrzygnięta przed chwilą stoi jeszcze na liście, ale NIE JEST już
  // czynnością do wykonania — odznaka nad zielonym „Potwierdzone" mówiłaby nieprawdę.
  return (items || []).filter((x) => x && x.level === 1 && !x.resolved).length;
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
