// Kolor jest tożsamością człowieka w interfejsie, więc musi być POWTARZALNY (ten sam
// na każdym urządzeniu i po każdym wdrożeniu) i RÓŻNICUJĄCY (dwadzieścia pięć osób
// w grupie to dwadzieścia pięć rozróżnialnych awatarów).
import { describe, it, expect } from 'vitest';
import { hashSeed, identityColor, identityRgb, initials, IDENTITY_COLORS } from './identity.js';

describe('tożsamość uczestnika', () => {
  it('ten sam identyfikator zawsze daje ten sam kolor', () => {
    expect(identityColor('abc123', 'Ania')).toBe(identityColor('abc123', 'Ania'));
  });

  it('imię nie wpływa na kolor, gdy jest identyfikator (zmiana ksywki nie zmienia tożsamości)', () => {
    expect(identityColor('abc123', 'Ania')).toBe(identityColor('abc123', 'Aniolek'));
  });

  it('kolor pochodzi z zamkniętej palety', () => {
    for (let i = 0; i < 50; i++) {
      expect(IDENTITY_COLORS).toContain(identityColor(`osoba-${i}`));
    }
  });

  it('dwadzieścia pięć osób dostaje kolory, które realnie się rozchodzą po palecie', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `member-${i}`);
    const used = new Set(ids.map((id) => identityColor(id)));
    // Powtórki są nieuniknione przy 16 kolorach na 25 osób — ratuje wtedy zdjęcie
    // i litera. Wymagamy natomiast, żeby paleta pracowała, a nie skupiała się w rogu.
    expect(used.size).toBeGreaterThanOrEqual(10);
  });

  it('rozkład na RGB zwraca składowe gotowe do wstawienia w rgb(... / alfa)', () => {
    expect(identityRgb('#6D28D9')).toBe('109 40 217');
    expect(identityRgb('6D28D9')).toBe('109 40 217');
  });

  it('rozkład na RGB nie wypuszcza śmieci przy złych danych z bazy', () => {
    // Kolor pochodzi z dokumentu grupy, do którego pisze każdy z linkiem. Wartość
    // spoza zapisu szesnastkowego ma wrócić kolorem domyślnym, nie fragmentem CSS.
    expect(identityRgb('red; background: url(x)')).toBe('109 40 217');
    expect(identityRgb(null)).toBe('109 40 217');
  });

  it('litera awatara radzi sobie z jednym i dwoma członami imienia', () => {
    expect(initials('Ania')).toBe('A');
    expect(initials('Anna Maria')).toBe('AM');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
  });

  it('hashSeed jest deterministyczny', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});
