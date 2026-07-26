import { describe, it, expect } from 'vitest';
import { unreadNudgeCount, hasRecentNudge } from './nudges.js';

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
