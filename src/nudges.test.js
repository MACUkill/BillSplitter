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
