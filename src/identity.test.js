// Kolor jest tożsamością człowieka w interfejsie, więc musi być POWTARZALNY (ten sam
// na każdym urządzeniu i po każdym wdrożeniu) i RÓŻNICUJĄCY (dwadzieścia pięć osób
// w grupie to dwadzieścia pięć rozróżnialnych awatarów).
import { describe, it, expect } from 'vitest';
import {
  hashSeed, identityColor, identityRgb, initials, IDENTITY_COLORS,
  hexToHsl, isReservedColor, readableInk, contrastRatio,
  colorFromControls, controlsFromColor, nearestAllowedHue,
} from './identity.js';

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

  it('paleta nie ma dwóch kolorów nie do odróżnienia', () => {
    // To jest test, którego brak kosztował realną usterkę: poprzednia paleta miała
    // szesnaście pozycji i PIĘTNAŚCIE par różniących się mniej niż o dwadzieścia stopni
    // odcienia przy niemal równej jasności. Dla oka były tym samym kolorem, a kolor
    // jest tu tożsamością człowieka.
    const dH = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    const bliskie = [];
    for (let i = 0; i < IDENTITY_COLORS.length; i++) {
      for (let j = i + 1; j < IDENTITY_COLORS.length; j++) {
        const a = hexToHsl(IDENTITY_COLORS[i]);
        const b = hexToHsl(IDENTITY_COLORS[j]);
        if (dH(a.h, b.h) < 20 && Math.abs(a.l - b.l) < 12) {
          bliskie.push(`${IDENTITY_COLORS[i]} vs ${IDENTITY_COLORS[j]}`);
        }
      }
    }
    expect(bliskie, `Pary nie do odróżnienia:\n  ${bliskie.join('\n  ')}`).toEqual([]);
  });

  it('żaden kolor tożsamości nie udaje barwy o znaczeniu', () => {
    // Limonka marki znaczy „naciśnij to", a trzy barwy pieniężne znaczą dług, należność
    // i „czeka na Ciebie". Człowiek w tych kolorach sprawiałby, że interfejs kłamie
    // przy każdej jego pozycji.
    const kolizje = IDENTITY_COLORS.filter((c) => isReservedColor(c));
    expect(kolizje, `Kolory na barwach znaczeniowych: ${kolizje.join(', ')}`).toEqual([]);
  });

  it('litera na znaku trzyma kontrast na KAŻDYM kolorze palety', () => {
    // Bez tego nie da się dopuścić jasnych barw: biała litera na żółtym jest nieczytelna.
    // Próg 4,5:1 to ten sam, który obowiązuje tekst w całej aplikacji.
    for (const c of IDENTITY_COLORS) {
      expect(contrastRatio(c, readableInk(c)), `kolor ${c}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('litera trzyma kontrast także na kolorze wybranym suwakami, w całym zakresie', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (let t = 0; t <= 100; t += 10) {
        const c = colorFromControls(hue, t);
        expect(contrastRatio(c, readableInk(c)), `kolor ${c} (odcień ${hue}, intensywność ${t})`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('suwak omija barwy o znaczeniu i zawsze znajduje dozwolony odcień', () => {
    for (let t = 0; t <= 100; t += 10) {
      for (let hue = 0; hue < 360; hue += 5) {
        const dozwolony = nearestAllowedHue(hue, t);
        expect(isReservedColor(colorFromControls(dozwolony, t)),
          `odcień ${hue} przy intensywności ${t} odesłał do zarezerwowanego ${dozwolony}`).toBe(false);
      }
    }
  });

  it('wybór suwakami i odczyt z koloru wracają do tego samego miejsca', () => {
    // Bez tego otwarcie arkusza ustawiałoby suwaki gdzie indziej niż kolor, który
    // człowiek widzi na swoim znaku.
    for (const hue of [0, 37, 128, 211, 305]) {
      for (const t of [10, 40, 75]) {
        const hex = colorFromControls(hue, t);
        const back = controlsFromColor(hex);
        expect(Math.abs(back.hue - hue), `odcień ${hue}`).toBeLessThanOrEqual(2);
        expect(Math.abs(back.intensity - t), `intensywność ${t}`).toBeLessThanOrEqual(3);
      }
    }
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
