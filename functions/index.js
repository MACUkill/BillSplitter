// Cloud Function: przelicza podsumowania grupy OD ZERA przy każdej zmianie rachunku.
// Nazwa eksportu zachowana historycznie (deploy = aktualizacja w miejscu), ale logika
// NIE jest już przyrostowa — czytamy wszystkie rachunki i liczymy świeżo. To eliminuje
// dryf delt i problemy z at-least-once/retry, oraz używa TEJ SAMEJ matmy co front (calc.js).
import { onDocumentWritten } from "firebase-functions/v2/firestore";
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
