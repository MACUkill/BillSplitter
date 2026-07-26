// Cloud Function: przelicza podsumowania grupy OD ZERA przy każdej zmianie rachunku.
// Nazwa eksportu zachowana historycznie (deploy = aktualizacja w miejscu), ale logika
// NIE jest już przyrostowa — czytamy wszystkie rachunki i liczymy świeżo. To eliminuje
// dryf delt i problemy z at-least-once/retry, oraz używa TEJ SAMEJ matmy co front (calc.js).
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import admin from "firebase-admin";
import { aggregateGroupSummary } from "./calc.js";

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
