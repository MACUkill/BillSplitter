// Cloud Function: przelicza podsumowania grupy OD ZERA przy każdej zmianie rachunku.
// Nazwa eksportu zachowana historycznie (deploy = aktualizacja w miejscu), ale logika
// NIE jest już przyrostowa — czytamy wszystkie rachunki i liczymy świeżo. To eliminuje
// dryf delt i problemy z at-least-once/retry, oraz używa TEJ SAMEJ matmy co front (calc.js).
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import admin from "firebase-admin";
import { aggregateGroupSummary } from "./calc.js";
import { RECEIPT_SYSTEM_PROMPT, receiptUserPrompt } from "./receipt-prompt.js";

admin.initializeApp();

const APP_ID = "bill-splitter-public";

export const recalculateGroupSummaryIncrementally = onDocumentWritten(
  {
    document: `artifacts/${APP_ID}/public/data/groups/{groupId}/bills/{billId}`,
    region: "europe-central2",
  },
  async (event) => {
    const { groupId } = event.params;
    const db = admin.firestore();
    const groupRef = db.doc(`artifacts/${APP_ID}/public/data/groups/${groupId}`);

    const groupDoc = await groupRef.get();
    if (!groupDoc.exists) {
      logger.warn(`Grupa ${groupId} nie istnieje — pomijam przeliczenie.`);
      return;
    }

    // Przeliczenie OD ZERA: czytamy wszystkie rachunki grupy i agregujemy świeżo.
    const billsSnap = await db
      .collection(`artifacts/${APP_ID}/public/data/groups/${groupId}/bills`)
      .get();
    const bills = billsSnap.docs.map((d) => d.data());

    const { userGrossSpend, groupGrossSpend } = aggregateGroupSummary(bills);

    // update() zastępuje wskazane pola w CAŁOŚCI (usuwa nieaktualne wpisy),
    // nie ruszając reszty dokumentu grupy (nazwa, członkowie, storage itd.).
    await groupRef.update({
      userGrossSpend,
      groupGrossSpend,
      expenseSummary: userGrossSpend, // lustro; net-balans "kto komu" przyjdzie w Fazie 5
    });

    logger.info(
      `Przeliczono podsumowania grupy ${groupId} od zera (${bills.length} rachunków).`,
    );
  },
);

// Faza 6: przypomnienie („windykator") → push na urządzenia dłużnika.
// Payload DATA-ONLY, bo notyfikację buduje nasz service worker (public/sw.js) —
// dzięki temu treść i zachowanie kliknięcia są w jednym miejscu, po naszej stronie.
export const sendNudgePush = onDocumentCreated(
  {
    document: `artifacts/${APP_ID}/public/data/groups/{groupId}/nudges/{nudgeId}`,
    region: "europe-central2",
  },
  async (event) => {
    const { groupId } = event.params;
    const nudge = event.data && event.data.data();
    if (!nudge || !nudge.to) return;

    const db = admin.firestore();
    const groupDoc = await db.doc(`artifacts/${APP_ID}/public/data/groups/${groupId}`).get();
    if (!groupDoc.exists) return;

    // ANTY-SPAM PO STRONIE SERWERA. Reguły pozwalają każdemu zalogowanemu utworzyć dowolnie
    // wiele dokumentów `nudges`, więc bez bramki ktoś mógłby w pętli zasypać czyjś telefon.
    //
    // BRAMKA TO DZIESIĘĆ SEKUND, NIE SZEŚĆ GODZIN (audyt 2026-08-16).
    // Właściciel rozstrzygnął 2026-08-05, że blokujemy wyłącznie walenie w przycisk co
    // sekundę: produkt ma domykać dług, a nie chronić dłużnika przed wierzycielem. Zmiana
    // trafiła wtedy do przeglądarki (`NUDGE_GATE_MS` w src/main.js), ale TU ZOSTAŁO SZEŚĆ
    // GODZIN — i to jest najpewniejsze wyjaśnienie zgłoszenia „powiadomienia czasem
    // działały, zwykle nie". Wpis w skrzynce powstawał normalnie, więc nadawca widział
    // sukces, a telefon odbiorcy milczał przez kolejne sześć godzin od poprzedniego
    // przypomnienia. Przy testowaniu w kilka osób tego samego wieczoru trafiał jeden push
    // na całą sesję.
    const GATE_MS = 10 * 1000;
    const createdAtMs = nudge.createdAt && nudge.createdAt.toMillis
      ? nudge.createdAt.toMillis()
      : Date.now();
    const recentSnap = await db
      .collection(`artifacts/${APP_ID}/public/data/groups/${groupId}/nudges`)
      .where("from", "==", nudge.from)
      .where("to", "==", nudge.to)
      .get();
    const hasRecent = recentSnap.docs.some((d) => {
      if (d.id === event.params.nudgeId) return false;
      const ts = d.data().createdAt;
      const ms = ts && ts.toMillis ? ts.toMillis() : 0;
      return ms > 0 && createdAtMs - ms < GATE_MS;
    });
    if (hasRecent) {
      logger.info(`Pominięto push do ${nudge.to}: przypomnienie od ${nudge.from} poszło mniej niż ${GATE_MS / 1000} s temu.`);
      return;
    }

    const members = groupDoc.data().members || {};
    const tokens = (members[nudge.to] && members[nudge.to].fcmTokens) || [];
    if (tokens.length === 0) {
      logger.info(`Dłużnik ${nudge.to} nie ma zarejestrowanych urządzeń — pomijam push.`);
      return;
    }

    const fromName = (members[nudge.from] && members[nudge.from].name) || "Ktoś";
    const amount = Number(nudge.amountG || 0) / 100;
    const currency = nudge.currency || "PLN";
    const kwota = amount > 0 ? `${amount.toFixed(2).replace(".", ",")} ${currency}` : "";

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title: "Przypomnienie o zaległości",
        body: kwota
          ? `${fromName} przypomina o ${kwota}. Już zapłaciłeś? Zapisz wpłatę.`
          : `${fromName} przypomina o zaległości.`,
        url: `/?group=${groupId}`,
        tag: `nudge-${groupId}`,
      },
      webpush: { headers: { Urgency: "high", TTL: "3600" } },
    });

    // Tokeny wygasają (odinstalowana apka, wyczyszczone dane) — sprzątamy, żeby nie rosły w nieskończoność.
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await groupDoc.ref.update({
        [`members.${nudge.to}.fcmTokens`]: admin.firestore.FieldValue.arrayRemove(...dead),
      });
    }

    logger.info(`Push do ${nudge.to}: ${res.successCount}/${tokens.length} dostarczone, usunięto ${dead.length} martwych tokenów.`);
  },
);

// ===================================================================
// Faza 7B: odczyt paragonu przez model AI (OpenRouter)
// ===================================================================
// Klucz NIGDY nie trafia do klienta — przeglądarka wysyła tu zdjęcia, a odpowiedź modelu
// wraca jako surowy JSON. Sito na śmieci (src/receipt.js) działa po stronie klienta, żeby
// tę samą logikę dało się testować bez sieci.
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
// Domyślnie najtańszy sensowny model. Na paragonie testowym flash-lite dał identyczny odczyt
// co flash, ale 3x szybciej i ~24x taniej (0,0008 $ vs 0,0197 $ — flash marnował tokeny na
// „rozmyślanie"). Mocniejsze modele zostają do eskalacji przy pomiętych/nieczytelnych paragonach.
const OPENROUTER_MODEL = defineString("OPENROUTER_MODEL", { default: "google/gemini-3.1-flash-lite" });

// Biała lista — bez niej klient mógłby wskazać dowolnie drogi model na nasz rachunek.
const ALLOWED_MODELS = new Set([
  "google/gemini-3.5-flash",
  "google/gemini-3.1-flash-lite",
  "anthropic/claude-sonnet-5",
]);

const MAX_IMAGES = 5;
const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB na obraz po base64; zapora przed zapchaniem funkcji

// ZAPORA KOSZTOWA NA UŻYTKOWNIKA (audyt 2026-07-27).
// `maxInstances` ogranicza RÓWNOCZESNOŚĆ, ale nie sumę wywołań — ktoś, kto zna adres
// aplikacji, mógł zalogować się anonimowo (logowanie anonimowe jest tu automatyczne)
// i w pętli odpytywać model na nasz rachunek w OpenRouterze. Przy odczycie za ~0,0008 $
// nie jest to katastrofa, ale nie ma też żadnego sufitu — a rachunek płaci właściciel.
// Dzienny limit na uid stawia sufit, którego zwykły użytkownik nie zauważy: 30 paragonów
// dziennie to o rząd wielkości więcej, niż potrzebuje realna ekipa po kolacji.
const RECEIPTS_PER_USER_PER_DAY = 30;

async function assertWithinDailyQuota(uid) {
  const db = admin.firestore();
  const ref = db.doc(`artifacts/${APP_ID}/private/usage/receiptQuota/${uid}`);
  const today = new Date().toISOString().slice(0, 10); // UTC — wystarczy, doba to doba

  const exhausted = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const count = data && data.day === today ? Number(data.count || 0) : 0;
    if (count >= RECEIPTS_PER_USER_PER_DAY) return true;
    tx.set(ref, { day: today, count: count + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return false;
  });

  if (exhausted) {
    throw new HttpsError(
      "resource-exhausted",
      `Dzienny limit odczytów paragonu (${RECEIPTS_PER_USER_PER_DAY}) wyczerpany. Spróbuj jutro.`,
    );
  }
}

export const parseReceipt = onCall(
  {
    region: "europe-central2",
    secrets: [OPENROUTER_API_KEY],
    maxInstances: 3,      // zapora kosztowa: brak nagłego roju wywołań
    timeoutSeconds: 120,  // modele vision potrafią myśleć kilkadziesiąt sekund
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Zaloguj się, aby odczytać paragon.");
    }

    const images = Array.isArray(request.data?.images) ? request.data.images : [];
    if (images.length === 0) {
      throw new HttpsError("invalid-argument", "Brak zdjęć do odczytania.");
    }
    if (images.length > MAX_IMAGES) {
      throw new HttpsError("invalid-argument", `Maksymalnie ${MAX_IMAGES} zdjęć naraz.`);
    }
    for (const img of images) {
      if (typeof img !== "string" || !img.startsWith("data:image/")) {
        throw new HttpsError("invalid-argument", "Nieprawidłowy format zdjęcia.");
      }
      if (img.length > MAX_IMAGE_CHARS) {
        throw new HttpsError("invalid-argument", "Zdjęcie jest za duże — zmniejsz je przed wysłaniem.");
      }
    }

    // Limit sprawdzamy PO walidacji wejścia (żeby śmieciowe wywołanie nie zjadało puli),
    // ale PRZED zapytaniem do modelu — czyli przed poniesieniem kosztu.
    await assertWithinDailyQuota(request.auth.uid);

    const requested = request.data?.model;
    const model = (typeof requested === "string" && ALLOWED_MODELS.has(requested))
      ? requested
      : OPENROUTER_MODEL.value();

    const content = [
      { type: "text", text: receiptUserPrompt(request.data?.hint) },
      ...images.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    let response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY.value()}`,
          "Content-Type": "application/json",
          "X-Title": "BillSplitter",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: RECEIPT_SYSTEM_PROMPT },
            { role: "user", content },
          ],
          response_format: { type: "json_object" }, // wymuszamy JSON zamiast prozy
          temperature: 0,                           // odczyt paragonu ma być powtarzalny
          max_tokens: 4000,
        }),
      });
    } catch (err) {
      logger.error("OpenRouter — brak połączenia:", err);
      throw new HttpsError("unavailable", "Nie udało się połączyć z usługą odczytu.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(`OpenRouter HTTP ${response.status}: ${body.slice(0, 500)}`);
      throw new HttpsError("internal", `Usługa odczytu zwróciła błąd (${response.status}).`);
    }

    const payload = await response.json().catch(() => null);
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      logger.error("OpenRouter — pusta odpowiedź modelu.");
      throw new HttpsError("internal", "Model nie zwrócił odczytu.");
    }

    // Mimo response_format modele bywają uparte: opakowują JSON w blok ```json, poprzedzają
    // go zdaniem wyjaśniającym albo — jak claude-sonnet-5 na zdjęciu, które paragonem nie było
    // (audyt 2026-08-16) — odpowiadają samą prozą. Wyłuskujemy więc JSON z tekstu, zamiast
    // odrzucać całą odpowiedź: użytkownik ma dostać odczyt, a nie komunikat o złym formacie.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parseLoose = (s) => {
      try { return JSON.parse(s); } catch (_) { /* niżej */ }
      const first = s.indexOf("{");
      const last = s.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { return JSON.parse(s.slice(first, last + 1)); } catch (_) { /* niżej */ }
      }
      return null;
    };
    const parsed = parseLoose(cleaned);
    if (!parsed || typeof parsed !== "object") {
      logger.error(`OpenRouter — odpowiedź nie jest JSON-em: ${cleaned.slice(0, 300)}`);
      throw new HttpsError("internal", "Model zwrócił odpowiedź w złym formacie.");
    }

    const usage = payload?.usage || {};
    logger.info(`Odczyt paragonu modelem ${model}: ${images.length} zdjęć, tokeny ${usage.prompt_tokens || "?"}/${usage.completion_tokens || "?"}.`);

    return { raw: parsed, model, usage };
  },
);
