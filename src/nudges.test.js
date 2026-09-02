import { describe, it, expect } from 'vitest';
import { unreadNudgeCount, hasRecentNudge, inboxItems, badgeCount, hasDot } from './nudges.js';

describe('unreadNudgeCount', () => {
  it('pusta / błędna lista → 0', () => {
    expect(unreadNudgeCount([], 'm1', 'u1')).toBe(0);
    expect(unreadNudgeCount(null, 'm1', 'u1')).toBe(0);
    expect(unreadNudgeCount([{ to: 'm1' }], null, 'u1')).toBe(0);
  });

  it('liczy tylko przypomnienia DO MNIE i tylko nieprzeczytane', () => {
    const nudges = [
      { to: 'm1', readBy: [] },            // do mnie, nieprzeczytane
      { to: 'm1', readBy: ['u1'] },        // do mnie, przeczytane przeze mnie
      { to: 'm1' },                        // do mnie, brak readBy → nieprzeczytane
      { to: 'm2', readBy: [] },            // do kogoś innego
      { to: 'm1', readBy: ['u9'] },        // do mnie, przeczytane przez KOGOŚ innego → wciąż moje nieprzeczytane
    ];
    expect(unreadNudgeCount(nudges, 'm1', 'u1')).toBe(3);
  });

  it('gdy wszystkie przeczytane przeze mnie → 0', () => {
    const nudges = [
      { to: 'm1', readBy: ['u1'] },
      { to: 'm1', readBy: ['u1', 'u2'] },
    ];
    expect(unreadNudgeCount(nudges, 'm1', 'u1')).toBe(0);
  });
});

describe('hasRecentNudge', () => {
  const now = 1_000_000_000_000;
  const H = 3600_000;

  it('wykrywa świeże przypomnienie from→to w oknie', () => {
    const nudges = [{ from: 'm1', to: 'm2', createdAtMs: now - H }];
    expect(hasRecentNudge(nudges, 'm1', 'm2', now, 6 * H)).toBe(true);
  });

  it('poza oknem → false', () => {
    const nudges = [{ from: 'm1', to: 'm2', createdAtMs: now - 7 * H }];
    expect(hasRecentNudge(nudges, 'm1', 'm2', now, 6 * H)).toBe(false);
  });

  it('inna para from/to → false', () => {
    const nudges = [{ from: 'm1', to: 'm3', createdAtMs: now - H }];
    expect(hasRecentNudge(nudges, 'm1', 'm2', now, 6 * H)).toBe(false);
  });

  it('brak createdAtMs (świeży lokalny wpis) → ignorowany', () => {
    const nudges = [{ from: 'm1', to: 'm2' }];
    expect(hasRecentNudge(nudges, 'm1', 'm2', now, 6 * H)).toBe(false);
  });
});

describe('próg sygnału: inboxItems / badgeCount / hasDot', () => {
  const base = { myId: 'm1', myUid: 'u1' };

  it('bez tożsamości nie ma żadnego sygnału', () => {
    expect(inboxItems({ ...base, myId: null, nudges: [{ to: 'm1' }] })).toEqual([]);
  });

  it('przypomnienie do mnie jest poziomem 1, przeczytane znika', () => {
    const nudges = [
      { id: 'n1', to: 'm1', from: 'm2' },
      { id: 'n2', to: 'm1', from: 'm3', readBy: ['u1'] },
      { id: 'n3', to: 'm2', from: 'm1' },
    ];
    const items = inboxItems({ ...base, nudges });
    expect(items.map((x) => x.id)).toEqual(['n1']);
    expect(badgeCount(items)).toBe(1);
  });

  it('cudza wpłata do mnie czeka na potwierdzenie, moja własna nie liczy się jako sygnał', () => {
    const settlements = [
      { id: 's1', from: 'm2', to: 'm1', confirmed: false },
      { id: 's2', from: 'm1', to: 'm2', confirmed: false },
      { id: 's3', from: 'm2', to: 'm1', confirmed: true },
    ];
    const items = inboxItems({ ...base, settlements });
    expect(items.map((x) => x.id)).toEqual(['s1']);
    expect(items[0].kind).toBe('confirm-payment');
  });

  it('potwierdzenie mojej wpłaty zamyka pętlę i gaśnie po obejrzeniu', () => {
    const settlements = [{ id: 's9', from: 'm1', to: 'm2', confirmed: true, confirmedBy: 'u2' }];
    expect(inboxItems({ ...base, settlements })[0].kind).toBe('payment-confirmed');
    expect(inboxItems({ ...base, settlements, seenConfirmations: ['s9'] })).toEqual([]);
  });

  it('nic, co zrobiłem sam, nie wraca do mnie jako sygnał', () => {
    const settlements = [{ id: 's5', from: 'm1', to: 'm2', confirmed: true, confirmedBy: 'u1' }];
    expect(inboxItems({ ...base, settlements })).toEqual([]);
  });

  it('rachunek czekający na mój ruch to poziom 2: kropka, nigdy liczba', () => {
    const items = inboxItems({ ...base, actionBills: [{ id: 'b1', title: 'Kolacja' }] });
    expect(items).toHaveLength(1);
    expect(badgeCount(items)).toBe(0);
    expect(hasDot(items)).toBe(true);
  });

  it('poziom 1 stoi nad poziomem 2, w poziomie najnowsze pierwsze', () => {
    const items = inboxItems({
      ...base,
      nudges: [{ id: 'n-stary', to: 'm1', from: 'm2', createdAtMs: 1 }, { id: 'n-nowy', to: 'm1', from: 'm2', createdAtMs: 9 }],
      actionBills: [{ id: 'b1', title: 'Kolacja' }],
    });
    expect(items.map((x) => x.id)).toEqual(['n-nowy', 'n-stary', 'b1']);
  });
});

// TRZY RODZAJE PRZYPOMNIEŃ (brama rozliczeń, 2026-08-26). Dwa nowe NIE proszą o pieniądze,
// więc muszą dojechać do skrzynki rozróżnialne — inaczej wiersz podstawi pod nie „Ureguluj"
// i każe płacić komuś, kto nic nie jest winien.
describe('rodzaje przypomnień', () => {
  const base = { myId: 'm1', myUid: 'u1' };

  it('przypomnienie o zaległości zostaje domyślne', () => {
    const [x] = inboxItems({ ...base, nudges: [{ id: 'n1', to: 'm1', from: 'm2', amountG: 5000 }] });
    expect(x.nudgeKind).toBe('debt');
  });

  it('prośba o uzupełnienie niesie rachunek, do którego prowadzi', () => {
    const [x] = inboxItems({
      ...base,
      nudges: [{ id: 'n2', to: 'm1', from: 'm2', kind: 'fill', billId: 'b7', billName: 'Kolacja' }],
    });
    expect(x.nudgeKind).toBe('fill');
    expect(x.billId).toBe('b7');
    expect(x.billName).toBe('Kolacja');
  });

  it('prośba o otwarcie rachunku („To nie moje") ma własny rodzaj', () => {
    const [x] = inboxItems({
      ...base,
      nudges: [{ id: 'n3', to: 'm1', from: 'm2', kind: 'reopen', billId: 'b7' }],
    });
    expect(x.nudgeKind).toBe('reopen');
  });

  it('wszystkie trzy to poziom 1 — za każdym stoi czekający człowiek', () => {
    const items = inboxItems({
      ...base,
      nudges: [
        { id: 'n1', to: 'm1', from: 'm2' },
        { id: 'n2', to: 'm1', from: 'm3', kind: 'fill' },
        { id: 'n3', to: 'm1', from: 'm4', kind: 'reopen' },
      ],
    });
    expect(badgeCount(items)).toBe(3);
  });

  it('nieznany rodzaj z przyszłej wersji nie wywraca skrzynki — traktujemy jak zaległość', () => {
    const [x] = inboxItems({ ...base, nudges: [{ id: 'n9', to: 'm1', from: 'm2', kind: 'cos-nowego' }] });
    expect(x.nudgeKind).toBe('debt');
  });
});

// WIERSZ NIE ZNIKA POD PALCEM (2026-09-02). „Mam" i „Wysłałem na pewno" zdejmują sprawę,
// więc wiersz wypadał z listy w tej samej sekundzie, w której go stuknięto: przy kilku
// wpłatach od tej samej osoby drugie stuknięcie trafiało w cel, który właśnie przeskoczył
// w górę. `keepSettlements` trzyma taką wpłatę na liście do następnego otwarcia skrzynki.
describe('wpłaty trzymane po rozstrzygnięciu', () => {
  const base = { myId: 'm1', myUid: 'u1' };

  it('potwierdzona przeze mnie wpłata zostaje na liście jako wiersz bez czynności', () => {
    const settlements = [{ id: 's1', from: 'm2', to: 'm1', confirmed: true, confirmedBy: 'u1', amountG: 12000, createdAtMs: 5 }];
    expect(inboxItems({ ...base, settlements })).toEqual([]);

    const items = inboxItems({ ...base, settlements, keepSettlements: ['s1'] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'settlement-resolved', id: 's1', level: 1, resolved: true,
      from: 'm2', mine: false, state: 'confirmed', amountG: 12000,
    });
  });

  it('trzymany wiersz NIE liczy się do odznaki — sprawa już nie czeka', () => {
    const settlements = [{ id: 's1', from: 'm2', to: 'm1', confirmed: true, confirmedBy: 'u1' }];
    const items = inboxItems({ ...base, settlements, keepSettlements: ['s1'] });
    expect(items).toHaveLength(1);
    expect(badgeCount(items)).toBe(0);
    expect(hasDot(items)).toBe(false);
  });

  it('„Wysłałem na pewno" zdejmuje sprawę, ale wiersz zostaje ze stanem `insisted`', () => {
    const settlements = [{ id: 's2', from: 'm1', to: 'm2', disputed: true, insisted: true, createdAtMs: 5 }];
    expect(inboxItems({ ...base, settlements })).toEqual([]);

    const [x] = inboxItems({ ...base, settlements, keepSettlements: ['s2'] });
    expect(x).toMatchObject({ kind: 'settlement-resolved', from: 'm2', mine: true, state: 'insisted' });
  });

  it('wycofana wpłata trzyma się na ekranie ze stanem `withdrawn`', () => {
    const settlements = [{ id: 's3', from: 'm1', to: 'm2', withdrawn: true, createdAtMs: 5 }];
    const [x] = inboxItems({ ...base, settlements, keepSettlements: ['s3'] });
    expect(x.state).toBe('withdrawn');
  });

  it('„Cofnij" nie potrzebuje własnej obsługi: sprawa wraca, a z nią przyciski', () => {
    // Ta sama wpłata i ta sama lista trzymanych — zmieniły się WYŁĄCZNIE dane.
    const settlements = [{ id: 's1', from: 'm2', to: 'm1', confirmed: false }];
    const items = inboxItems({ ...base, settlements, keepSettlements: ['s1'] });
    expect(items[0].kind).toBe('confirm-payment');
    expect(items[0].resolved).toBeUndefined();
    expect(badgeCount(items)).toBe(1);
  });

  // Wyścig, który zdarza się naprawdę: podtrzymuję („Wysłałem na pewno"), a odbiorca
  // w ciągu sześciu sekund cofa swoje zgłoszenie braku przelewu. Spór znika BEZ mojego
  // udziału i wpłata jest znów zwykła, czekająca. Wiersz nie ma prawa powiedzieć wtedy
  // „załatwione" — stąd osobny stan zamiast wspólnego worka.
  it('gdy druga strona cofnie swoje zgłoszenie, trzymana wpłata wraca do stanu `open`', () => {
    const settlements = [{ id: 's4', from: 'm1', to: 'm2', insisted: true, disputed: false, createdAtMs: 5 }];
    const [x] = inboxItems({ ...base, settlements, keepSettlements: ['s4'] });
    expect(x).toMatchObject({ kind: 'settlement-resolved', state: 'open', mine: true });
  });

  it('cudza wpłata między dwiema innymi osobami nie wchodzi, choćby ktoś wpisał jej numer', () => {
    const settlements = [{ id: 's8', from: 'm2', to: 'm3', confirmed: true, confirmedBy: 'u2' }];
    expect(inboxItems({ ...base, settlements, keepSettlements: ['s8'] })).toEqual([]);
  });

  it('trzymany wiersz stoi tam, gdzie stał: czas ZGŁOSZENIA, nie rozstrzygnięcia', () => {
    const settlements = [
      { id: 's-stara', from: 'm2', to: 'm1', confirmed: true, confirmedBy: 'u1', createdAtMs: 1, confirmedAtMs: 9999 },
      { id: 's-nowa', from: 'm2', to: 'm1', confirmed: false, createdAtMs: 100 },
    ];
    const items = inboxItems({ ...base, settlements, keepSettlements: ['s-stara'] });
    expect(items.map((x) => x.id)).toEqual(['s-nowa', 's-stara']);
  });
});
