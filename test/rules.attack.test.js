// AUDYT BEZPIECZEŃSTWA — reguły od strony napastnika.
//
// Poprzedni zestaw testów sprawdzał, że dozwolone operacje DZIAŁAJĄ. Ten sprawdza coś
// odwrotnego i ważniejszego: że operacje, których interfejs nie oferuje, są NIEMOŻLIWE
// także z konsoli przeglądarki. Model zagrożeń jest tu skromny, ale realny — link do grupy
// jest kluczem dostępu, więc „napastnik" to zwykle ktoś z ekipy, kto ma link i ciekawość.
//
// Uruchomienie: `npm run test:rules` przy działającym emulatorze.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(here, '..', 'firestore.rules'), 'utf8');
// Patrz uwaga w test/rules.emulator.test.js — pozwala ominąć cudzą instancję emulatora.
const FIRESTORE_PORT = Number(process.env.FIRESTORE_EMULATOR_PORT) || 8770;
const APP = 'bill-splitter-public';
const G = 'atk';
const g = `artifacts/${APP}/public/data/groups/${G}`;

// Ala jest wierzycielem, Bob dłużnikiem, Ewa postronnym członkiem grupy.
const ALA = 'uid-ala', BOB = 'uid-bob', EWA = 'uid-ewa';

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'billsplitter-attack-test',
    firestore: { host: '127.0.0.1', port: FIRESTORE_PORT, rules },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

// Świeży stan przed KAŻDYM testem — inaczej udana próba ataku w jednym teście
// zmieniałaby warunki następnego i wynik zależałby od kolejności.
beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, g), {
      adminId: ALA,
      groupName: 'Wyjazd',
      members: {
        'm-ala': { id: 'm-ala', name: 'Ala', claimedBy: ALA, paymentMethods: [{ type: 'account', value: 'PL-ALA-1111' }] },
        'm-bob': { id: 'm-bob', name: 'Bob', claimedBy: BOB },
        'm-ewa': { id: 'm-ewa', name: 'Ewa', claimedBy: EWA },
      },
      expenseSummary: {}, userGrossSpend: {}, groupGrossSpend: {}, totalStorageUsed: 0,
    });
    // Wpłata zgłoszona przez Boba do Ali — czeka na potwierdzenie odbiorcy.
    await setDoc(doc(db, `${g}/settlements/s1`), {
      from: 'm-bob', to: 'm-ala', amount: 50, currency: 'PLN', createdBy: BOB, confirmed: false,
    });
    // Przypomnienie Ali do Boba.
    await setDoc(doc(db, `${g}/nudges/n1`), {
      from: 'm-ala', to: 'm-bob', amountG: 5000, currency: 'PLN', createdBy: ALA, readBy: [],
    });
    // Rachunek z potwierdzonym płatnikiem Alą.
    await setDoc(doc(db, `${g}/bills/b1`), {
      billName: 'Kolacja', type: 'simple', totalAmount: 150, currency: 'PLN',
      payerId: 'm-ala', payerConfirmed: true,
      participants: {
        'm-ala': { id: 'm-ala', name: 'Ala', status: 'unpaid' },
        'm-bob': { id: 'm-bob', name: 'Bob', status: 'unpaid' },
      },
    });
  });
});

describe('atak: potwierdzanie wpłat', () => {
  it('odbiorca (Ala) potwierdza wpłatę do siebie', async () => {
    await assertSucceeds(updateDoc(doc(as(ALA), `${g}/settlements/s1`), {
      confirmed: true, confirmedBy: ALA,
    }));
  });

  it('dłużnik NIE potwierdzi własnej wpłaty (inaczej „potwierdzona" nic nie znaczy)', async () => {
    await assertFails(updateDoc(doc(as(BOB), `${g}/settlements/s1`), {
      confirmed: true, confirmedBy: BOB,
    }));
  });

  it('postronny członek grupy NIE potwierdzi cudzej wpłaty', async () => {
    await assertFails(updateDoc(doc(as(EWA), `${g}/settlements/s1`), {
      confirmed: true, confirmedBy: EWA,
    }));
  });

  it('nawet odbiorca nie przemyci zmiany kwoty razem z potwierdzeniem', async () => {
    await assertFails(updateDoc(doc(as(ALA), `${g}/settlements/s1`), {
      confirmed: true, amount: 5,
    }));
  });
});

describe('atak: przypomnienia', () => {
  it('adresat (Bob) oznacza swoje przypomnienie jako przeczytane', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), `${g}/nudges/n1`), { readBy: [BOB] }));
  });

  it('ktoś inny NIE uciszy cudzego przypomnienia', async () => {
    await assertFails(updateDoc(doc(as(EWA), `${g}/nudges/n1`), { readBy: [EWA] }));
  });

  it('nadawca NIE skasuje śladu, podmieniając adresata', async () => {
    await assertFails(updateDoc(doc(as(ALA), `${g}/nudges/n1`), { to: 'm-ewa' }));
  });
});

describe('atak: rachunki', () => {
  it('potwierdzony płatnik usuwa swój rachunek', async () => {
    await assertSucceeds(deleteDoc(doc(as(ALA), `${g}/bills/b1`)));
  });

  it('inny uczestnik NIE skasuje cudzego rachunku (a z nim czyjejś należności)', async () => {
    await assertFails(deleteDoc(doc(as(BOB), `${g}/bills/b1`)));
    await assertFails(deleteDoc(doc(as(EWA), `${g}/bills/b1`)));
  });

  it('uczestnicy nadal mogą edytować rachunek (kafelki, kwoty) — to sedno aplikacji', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), `${g}/bills/b1`), { totalAmount: 160 }));
  });
});

describe('atak: dokument grupy', () => {
  it('nikt nie przejmie grupy przez podmianę adminId', async () => {
    await assertFails(updateDoc(doc(as(EWA), g), { adminId: EWA }));
  });

  it('podsumowania pozostają poza zasięgiem klienta', async () => {
    await assertFails(updateDoc(doc(as(EWA), g), { groupGrossSpend: { PLN: 0 } }));
  });

  // ⚠️ ZNANA, ŚWIADOMIE ZAAKCEPTOWANA DZIURA — opisana w raporcie audytu.
  // Reguły nie mają jak rozdzielić zapisów per członek: `affectedKeys()` widzi całą mapę
  // `members` jako JEDEN klucz, więc „każdy edytuje tylko siebie" jest w tym modelu
  // niewyrażalne. Prawdziwe domknięcie to konta (Faza „tożsamość"), nie łatka w regułach.
  // Test istnieje po to, żeby dziura była WIDOCZNA i żeby jej zamknięcie od razu tu zaświeciło.
  it('ZNANY BRAK: obcy członek wciąż podmieni cudzy numer konta', async () => {
    await assertSucceeds(updateDoc(doc(as(EWA), g), {
      'members.m-ala.paymentMethods': [{ type: 'account', value: 'PL-EWA-9999' }],
    }));
  });
});

// DZIENNIK AKTYWNOŚCI — mechanizm zaufania przy grupie 12–25 osób. Wpis raz zapisany
// musi być nie do ruszenia z klienta: dziennik, który da się poprawić albo wyczyścić,
// nie jest dziennikiem, tylko notatnikiem.
describe('atak: dziennik aktywności', () => {
  const e = (id) => `${g}/events/${id}`;

  it('każdy członek dopisuje zdarzenie, ale tylko w swoim imieniu', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), e('ev-bob')), {
      type: 'bill-amount', createdBy: BOB, by: 'm-bob', label: 'zmienił kwotę',
    }));
    await assertFails(setDoc(doc(as(BOB), e('ev-podszycie')), {
      type: 'bill-amount', createdBy: ALA, by: 'm-ala', label: 'zmieniła kwotę',
    }));
  });

  it('zapisanego zdarzenia nie da się poprawić ani skasować — także własnego', async () => {
    await setDoc(doc(as(ALA), e('ev-ala')), {
      type: 'item-add', createdBy: ALA, by: 'm-ala', label: 'dodała pozycję',
    });
    await assertFails(updateDoc(doc(as(ALA), e('ev-ala')), { label: 'nic nie zrobiła' }));
    await assertFails(deleteDoc(doc(as(ALA), e('ev-ala'))));
    await assertFails(deleteDoc(doc(as(EWA), e('ev-ala'))));
  });

  it('dziennik czyta każdy z linkiem — na tym polega jawność', async () => {
    await setDoc(doc(as(ALA), e('ev-czytelne')), {
      type: 'item-add', createdBy: ALA, by: 'm-ala', label: 'dodała pozycję',
    });
    await assertSucceeds(getDoc(doc(as(EWA), e('ev-czytelne'))));
  });
});
