// Czysta matematyka rachunków — bez Firebase, bez DOM. Testowalna w izolacji (Vitest).
// UWAGA (Faza 0): to WIERNA kopia dotychczasowej logiki, bez zmiany zachowania.
// W Fazie 1 zostanie przepisana: alokacja groszy w górę + testy jednostkowe.
// ===================================================
// ===== OBLICZENIA I FUNKCJE POMOCNICZE =====
// ===================================================
export const calculateAll = (bill) => {
    const participantsArray = Object.values(bill.participants || {});
    const activeParticipants = participantsArray.filter(p => p.status !== 'not_applicable');
    const numActiveParticipants = activeParticipants.length;
    
    const individualItemsSubtotal = activeParticipants.reduce((sum, p) => sum + (p.individualAmount || 0), 0);
    const sharedCostsTotal = (bill.sharedCosts || []).reduce((sum, sc) => sum + sc.amount, 0);
    const subtotalForGlobal = individualItemsSubtotal + sharedCostsTotal;


    let globalCostsTotal = 0;
    if (bill.globalCosts) {
        bill.globalCosts.forEach(gc => {
            globalCostsTotal += gc.type === 'percent' ? subtotalForGlobal * (gc.value / 100) : gc.value;
        });
    }
    const globalCostPerPerson = numActiveParticipants > 0 ? globalCostsTotal / numActiveParticipants : 0;

    const participantTotals = participantsArray.map(p => {
        if (p.status === 'not_applicable') {
            return { participant: p, individualAmount: 0, sharedAmount: 0, globalCostsAmount: 0, total: 0 };
        }
        const individualAmount = p.individualAmount || 0;
        const sharedAmount = (bill.sharedCosts || []).reduce((sum, sc) => {
            const activeSharers = sc.sharedBy.filter(sharerId => activeParticipants.some(ap => ap.id === sharerId));
            return sc.sharedBy.includes(p.id) && activeSharers.length > 0 ? sum + (sc.amount / activeSharers.length) : sum;
        }, 0);
        const total = individualAmount + sharedAmount + globalCostPerPerson;
        return { participant: p, individualAmount: individualAmount, sharedAmount, globalCostsAmount: globalCostPerPerson, total };
    });
    
    const controlSum = participantTotals.reduce((sum, pt) => sum + pt.total, 0);
    return { participantTotals, controlSum };
};

export const calculateAllForBill = (bill) => {
    if (bill.type === 'simple') {
        const participantsArray = Object.values(bill.participants || {});
        const activeParticipants = participantsArray.filter(p => p.status !== 'not_applicable');
        const includedCount = activeParticipants.length;
        const perPerson = includedCount > 0 ? (bill.totalAmount || 0) / includedCount : 0;
        
        const participantTotals = participantsArray.map(p => ({
            participant: p,
            total: p.status !== 'not_applicable' ? perPerson : 0
        }));
        const controlSum = participantTotals.reduce((sum, pt) => sum + pt.total, 0);
        return { participantTotals, controlSum };
    }
    return calculateAll(bill);
};
