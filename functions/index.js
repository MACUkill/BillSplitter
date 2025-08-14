// Importujemy potrzebne moduły z Firebase
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

// Inicjalizujemy aplikację admina, aby mieć dostęp do bazy danych
admin.initializeApp();

/**
 * Funkcja pomocnicza do obliczania wszystkich kosztów dla danego rachunku.
 * Ta logika jest dokładnym odzwierciedleniem funkcji 'calculateAll' z Twojego frontendu,
 * co zapewnia spójność obliczeń między backendem a frontendem.
 * @param {object} bill - Obiekt rachunku z Firestore.
 * @returns {object} - Zwraca obiekt z obliczonymi sumami dla każdego uczestnika.
 */
function calculateBillTotals(bill) {
    // REFACTOR: Handle both old array structure and new map structure for graceful migration.
    // The main logic now expects a map (object).
    if (!bill || !bill.participants) {
        return { participantTotals: {}, billTotal: 0 };
    }

    // Convert participants map to an array for easier processing.
    const participantsArray = Array.isArray(bill.participants) 
        ? bill.participants 
        : Object.values(bill.participants);

    const totals = {};
    const currency = bill.currency || "PLN";

    participantsArray.forEach(p => {
        totals[p.id] = { [currency]: 0 };
    });

    const activeParticipants = participantsArray.filter(p => p.status !== 'not_applicable');
    if (activeParticipants.length === 0) {
        return { participantTotals: totals, billTotal: 0 };
    }

    if (bill.type === 'simple') {
        const amountPerPerson = (bill.totalAmount || 0) / activeParticipants.length;
        activeParticipants.forEach(p => {
            totals[p.id][currency] = (totals[p.id][currency] || 0) + amountPerPerson;
        });
    } else {
        const individualItemsSubtotal = activeParticipants.reduce((sum, p) => sum + (p.individualAmount || 0), 0);
        const sharedCostsTotal = (bill.sharedCosts || []).reduce((sum, sc) => sum + (sc.amount || 0), 0);
        const subtotalForGlobal = individualItemsSubtotal + sharedCostsTotal;

        let globalCostsTotal = 0;
        if (bill.globalCosts) {
            bill.globalCosts.forEach(gc => {
                globalCostsTotal += gc.type === 'percent' ? subtotalForGlobal * ((gc.value || 0) / 100) : (gc.value || 0);
            });
        }
        const globalCostPerPerson = globalCostsTotal / activeParticipants.length;

        activeParticipants.forEach(p => {
            const sharedAmount = (bill.sharedCosts || []).reduce((sum, sc) => {
                const activeSharers = (sc.sharedBy || []).filter(sharerId => activeParticipants.some(ap => ap.id === sharerId));
                return (sc.sharedBy || []).includes(p.id) && activeSharers.length > 0 ? sum + ((sc.amount || 0) / activeSharers.length) : sum;
            }, 0);

            const finalTotalForParticipant = (p.individualAmount || 0) + sharedAmount + globalCostPerPerson;
            totals[p.id][currency] = (totals[p.id][currency] || 0) + finalTotalForParticipant;
        });
    }

    const billTotal = Object.values(totals).reduce((sum, userTotals) => {
        return sum + (userTotals[currency] || 0);
    }, 0);

    return { participantTotals: totals, billTotal, currency };
}


/**
 * Główna funkcja Cloud Function, która uruchamia się przy każdej zmianie w dokumencie rachunku.
 * Oblicza różnicę w wydatkach (deltę) i aktualizuje podsumowanie grupy w sposób przyrostowy.
 * ZMIANA: Teraz oblicza 3 wartości: bilans (expenseSummary), sumę udziałów użytkowników (userGrossSpend)
 * i sumę całych rachunków (groupGrossSpend).
 */
exports.recalculateGroupSummaryIncrementally = onDocumentWritten(
    {
        document: "artifacts/bill-splitter-public/public/data/groups/{groupId}/bills/{billId}",
        region: "europe-central2",
    },
    async (event) => {
        const { groupId } = event.params;
        const groupDocRef = admin.firestore().doc(`artifacts/bill-splitter-public/public/data/groups/${groupId}`);

        const beforeData = event.data.before.data();
        const afterData = event.data.after.data();

        // 1. Obliczenia dla BILANSU (expenseSummary) - tak jak wcześniej
        const beforeTotals = calculateBillTotals(beforeData);
        const afterTotals = calculateBillTotals(afterData);
        const balanceDeltas = {};
        const allParticipantIds = new Set([...Object.keys(beforeTotals.participantTotals), ...Object.keys(afterTotals.participantTotals)]);
        allParticipantIds.forEach(id => {
            balanceDeltas[id] = {};
            const allCurrencies = new Set([...Object.keys(beforeTotals.participantTotals[id] || {}), ...Object.keys(afterTotals.participantTotals[id] || {})]);
            allCurrencies.forEach(currency => {
                const beforeAmount = (beforeTotals.participantTotals[id] && beforeTotals.participantTotals[id][currency]) || 0;
                const afterAmount = (afterTotals.participantTotals[id] && afterTotals.participantTotals[id][currency]) || 0;
                balanceDeltas[id][currency] = afterAmount - beforeAmount;
            });
        });

        // 2. Obliczenia dla SUMY UDZIAŁÓW UŻYTKOWNIKÓW (userGrossSpend)
        // Ta logika jest taka sama jak dla bilansu, ponieważ 'calculateBillTotals' zwraca koszt na osobę.
        const userGrossDeltas = balanceDeltas;

        // 3. Obliczenia dla SUMY CAŁYCH RACHUNKÓW (groupGrossSpend)
        const groupGrossDelta = {};
        if (beforeData && beforeData.totalAmount > 0) {
            const currency = beforeData.currency || 'PLN';
            groupGrossDelta[currency] = (groupGrossDelta[currency] || 0) - beforeData.totalAmount;
        }
        if (afterData && afterData.totalAmount > 0) {
            const currency = afterData.currency || 'PLN';
            groupGrossDelta[currency] = (groupGrossDelta[currency] || 0) + afterData.totalAmount;
        }

        return admin.firestore().runTransaction(async (transaction) => {
            const groupDoc = await transaction.get(groupDocRef);
            if (!groupDoc.exists) {
                logger.error(`Grupa ${groupId} nie istnieje. Przerywam.`);
                return;
            }

            const groupData = groupDoc.data();
            const currentSummary = groupData.expenseSummary || {};
            const currentUserGross = groupData.userGrossSpend || {};
            const currentGroupGross = groupData.groupGrossSpend || {};

            // Aplikowanie delt do bilansu (expenseSummary)
            Object.keys(balanceDeltas).forEach(participantId => {
                if (!currentSummary[participantId]) currentSummary[participantId] = {};
                Object.keys(balanceDeltas[participantId]).forEach(currency => {
                    currentSummary[participantId][currency] = (currentSummary[participantId][currency] || 0) + balanceDeltas[participantId][currency];
                    if (Math.abs(currentSummary[participantId][currency]) < 0.001) {
                        delete currentSummary[participantId][currency];
                    }
                });
            });

            // Aplikowanie delt do sumy udziałów użytkowników (userGrossSpend)
            Object.keys(userGrossDeltas).forEach(participantId => {
                if (!currentUserGross[participantId]) currentUserGross[participantId] = {};
                Object.keys(userGrossDeltas[participantId]).forEach(currency => {
                    currentUserGross[participantId][currency] = (currentUserGross[participantId][currency] || 0) + userGrossDeltas[participantId][currency];
                    if (Math.abs(currentUserGross[participantId][currency]) < 0.001) {
                        delete currentUserGross[participantId][currency];
                    }
                });
            });

            // Aplikowanie delt do sumy całych rachunków (groupGrossSpend)
            Object.keys(groupGrossDelta).forEach(currency => {
                currentGroupGross[currency] = (currentGroupGross[currency] || 0) + groupGrossDelta[currency];
                if (Math.abs(currentGroupGross[currency]) < 0.001) {
                    delete currentGroupGross[currency];
                }
            });

            logger.info(`Aktualizuję podsumowania dla grupy ${groupId}.`);
            transaction.update(groupDocRef, {
                expenseSummary: currentSummary,
                userGrossSpend: currentUserGross,
                groupGrossSpend: currentGroupGross
            });
        });
    }
);
