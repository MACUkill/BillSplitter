// Test reguł Firestore na emulatorze (uruchom: `npm run test:rules` z działającym emulatorem).
// Ładuje firestore.rules niezależnie i sprawdza allow/deny — definitywny dowód, że
// security pass Fazy 2 działa (m.in. klient NIE może fałszować pól podsumowań).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { beforeAll, afterAll, describe, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(here, '..', 'firestore.rules'), 'utf8');
// Port emulatora Firestore. Domyślnie ten z `firebase.json`, ale da się wskazać inny
// przez `FIRESTORE_EMULATOR_PORT`. Potrzebne, gdy na 8770 stoi CUDZA instancja emulatora
// — na przykład uruchomiona z innego drzewa roboczego. Audyt 2026-08-16 stracił na tym
// sporo czasu: testy padały na regułach, których ten katalog w ogóle nie wgrywał.
const FIRESTORE_PORT = Number(process.env.FIRESTORE_EMULATOR_PORT) || 8770;

const APP = 'bill-splitter-public';
const g = (id) => `artifacts/${APP}/public/data/groups/${id}`;

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'billsplitter-rules-test',
    firestore: { host: '127.0.0.1', port: FIRESTORE_PORT, rules },
  });
  // CZYSTA BAZA NA KAŻDY PRZEBIEG — inaczej suita przechodzi tylko za pierwszym razem.
  // `env.cleanup()` w `afterAll` zamyka aplikacje testowe, ale NIE kasuje dokumentów;
  // przy drugim uruchomieniu na tym samym emulatorze `setDoc` trafia w istniejący wpis,
  // czyli reguły oceniają go jako UPDATE, a nie CREATE — i test "zalogowany może dodać
  // wpłatę" pada, choć reguły są w porządku. Fałszywy alarm w suicie bezpieczeństwa jest
  // gorszy niż brak testu: uczy, że czerwone bywa normalne.
  await env.clearFirestore();
  // Zasiew grupy g1 z pominięciem reguł (baza pod testy update/delete).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), g('g1')), {
      adminId: 'user-a',
      groupName: 'X',
      // m2 ma przypisaną sesję user-b, bo reguły potwierdzania wpłat i oznaczania
      // przypomnień sprawdzają teraz, czy to REALNIE odbiorca (members.{id}.claimedBy).
      members: {
        m1: { id: 'm1', name: 'M', claimedBy: null },
        m2: { id: 'm2', name: 'B', claimedBy: 'user-b' },
      },
      expenseSummary: {},
      userGrossSpend: {},
      groupGrossSpend: {},
      totalStorageUsed: 0,
    });
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('reguły Firestore — security pass Fazy 2', () => {
  it('niezalogowany NIE odczyta grupy', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), g('g1'))));
  });

  it('zalogowany odczyta grupę (link = klucz dostępu)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('user-x').firestore(), g('g1'))));
  });

  it('tworzenie grupy dozwolone tylko jako własny admin', async () => {
    const okDb = env.authenticatedContext('creator').firestore();
    await assertSucceeds(setDoc(doc(okDb, g('g-ok')), {
      adminId: 'creator', groupName: 'N', expenseSummary: {}, userGrossSpend: {}, groupGrossSpend: {},
    }));
    const badDb = env.authenticatedContext('creator').firestore();
    await assertFails(setDoc(doc(badDb, g('g-bad')), { adminId: 'ktos-inny', groupName: 'N' }));
  });

  it('można aktualizować pola inne niż podsumowania', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(db, g('g1')), { 'members.m1.claimedBy': 'user-a' }));
    await assertSucceeds(updateDoc(doc(db, g('g1')), { totalStorageUsed: 500 }));
  });

  it('klient NIE może ruszać pól podsumowań (obrona bilansów)', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(db, g('g1')), { userGrossSpend: { hack: { PLN: 999 } } }));
    await assertFails(updateDoc(doc(db, g('g1')), { groupGrossSpend: { PLN: 999 } }));
    await assertFails(updateDoc(doc(db, g('g1')), { expenseSummary: { hack: { PLN: 1 } } }));
  });

  it('grupy nie można skasować z klienta', async () => {
    await assertFails(deleteDoc(doc(env.authenticatedContext('user-a').firestore(), g('g1'))));
  });

  it('rachunki: zalogowany ma CRUD, niezalogowany nie', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(db, `${g('g1')}/bills/b1`), { billName: 'T', type: 'simple', totalAmount: 10 }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${g('g1')}/bills/b1`)));
  });
});

describe('reguły Firestore — rejestr wpłat (model wpłat)', () => {
  const s = (id) => `${g('g1')}/settlements/${id}`;

  it('zalogowany może dodać i odczytać wpłatę', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(db, s('s1')), { from: 'm1', to: 'm2', amount: 20, currency: 'PLN', createdBy: 'user-a' }));
    await assertSucceeds(getDoc(doc(db, s('s1'))));
  });

  it('niezalogowany nie odczyta wpłat', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), s('s1'))));
  });

  it('wpłatę można POTWIERDZIĆ (pola confirmed), ale nie zmienić kwoty/stron', async () => {
    const db = env.authenticatedContext('user-b').firestore();
    await assertSucceeds(updateDoc(doc(db, s('s1')), { confirmed: true, confirmedBy: 'user-b' }));
    await assertFails(updateDoc(doc(db, s('s1')), { amount: 999 }));
    await assertFails(updateDoc(doc(db, s('s1')), { to: 'hacker' }));
  });

  // AUDYT 2026-08-16. Ten test padał, i to nie z winy reguł.
  // Sprawdzał kasowanie na `s1`, czyli na wpłacie, którą test poprzedni POTWIERDZA —
  // a reguła z 2026-08-15 pozwala kasować wyłącznie wpłatę jeszcze niepotwierdzoną.
  // Test był starszy od reguły i dodatkowo sprzężony ze stanem sąsiada, więc padał
  // niezależnie od tego, czy reguły są dobre. Teraz każdy przypadek dostaje własny
  // dokument, a warunek „tylko do potwierdzenia" ma własne pokrycie.
  it('usunąć niepotwierdzoną wpłatę może TYLKO twórca', async () => {
    const author = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(author, s('s-del')), {
      from: 'm1', to: 'm2', amount: 20, currency: 'PLN', createdBy: 'user-a', confirmed: false,
    }));
    await assertFails(deleteDoc(doc(env.authenticatedContext('user-b').firestore(), s('s-del'))));
    await assertSucceeds(deleteDoc(doc(author, s('s-del'))));
  });

  it('STARĄ wpłatę BEZ pola „confirmed" też skasuje jej autor', async () => {
    // Pole `confirmed` dokładamy przy tworzeniu dopiero od 2026-08-15. Reguła czytała je
    // wprost (`resource.data.confirmed`), a odwołanie do brakującego pola wywala regułę
    // błędem wykonania — czyli odmową. Efekt: wpłaty sprzed tej daty były nie do usunięcia
    // przez własnego autora, mimo że interfejs pokazywał kosz.
    const author = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(author, s('s-stara')), {
      from: 'm1', to: 'm2', amount: 20, currency: 'PLN', createdBy: 'user-a',
    }));
    await assertSucceeds(deleteDoc(doc(author, s('s-stara'))));
  });

  it('POTWIERDZONEJ wpłaty nie skasuje nawet jej twórca', async () => {
    // Po potwierdzeniu wpłata jest dowodem dla obu stron i znika wyłącznie wpłatą
    // w drugą stronę — kasowanie byłoby wycinaniem historii, nie naprawą pomyłki.
    const author = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(author, s('s-conf')), {
      from: 'm1', to: 'm2', amount: 20, currency: 'PLN', createdBy: 'user-a',
    }));
    await assertSucceeds(updateDoc(doc(env.authenticatedContext('user-b').firestore(), s('s-conf')), {
      confirmed: true, confirmedBy: 'user-b',
    }));
    await assertFails(deleteDoc(doc(author, s('s-conf'))));
  });

  // --- ODPOWIEDŹ „NIE WIDZĘ" I DROGA POWROTNA (2026-08-29) -------------------
  //
  // Każdą odpowiedź pisze INNA STRONA i to jest tu cała rzecz do pilnowania.
  // Bez rozdziału ról nadawca mógłby sam sobie potwierdzić wpłatę albo zdjąć cudzy
  // spór — czyli znaczek znów nie znaczyłby nic. W bazie zapisywalnej linkiem to nie
  // jest teoria: dokument da się ruszyć z konsoli.
  const sporna = async (id) => {
    const author = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(author, s(id)), {
      from: 'm1', to: 'm2', amount: 20, currency: 'PLN', createdBy: 'user-a', confirmed: false,
    }));
  };

  it('ODBIORCA może zgłosić brak przelewu', async () => {
    await sporna('s-disp');
    const odbiorca = env.authenticatedContext('user-b').firestore();
    await assertSucceeds(updateDoc(doc(odbiorca, s('s-disp')), {
      disputed: true, disputedBy: 'user-b',
    }));
  });

  it('NADAWCA nie może zgłosić braku przelewu na własnej wpłacie', async () => {
    await sporna('s-disp-self');
    const nadawca = env.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(nadawca, s('s-disp-self')), { disputed: true }));
  });

  it('NADAWCA może podtrzymać zgłoszenie i je wycofać', async () => {
    await sporna('s-insist');
    const nadawca = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(nadawca, s('s-insist')), { insisted: true }));
    await assertSucceeds(updateDoc(doc(nadawca, s('s-insist')), { withdrawn: true }));
  });

  it('ODBIORCA nie może podtrzymać ani wycofać cudzego zgłoszenia', async () => {
    await sporna('s-insist-nope');
    const odbiorca = env.authenticatedContext('user-b').firestore();
    await assertFails(updateDoc(doc(odbiorca, s('s-insist-nope')), { insisted: true }));
    await assertFails(updateDoc(doc(odbiorca, s('s-insist-nope')), { withdrawn: true }));
  });

  // Ten przypadek złapało dopiero klikanie w przeglądarce: kod próbował przy
  // potwierdzeniu zgasić też `insisted`, czyli POLE NADAWCY — i reguła słusznie
  // odrzucała cały zapis. Rozdział ról ma być nienaruszalny także wtedy, gdy
  // druga strona chce zrobić coś dobrego.
  it('odbiorca zamyka spór potwierdzeniem, ale NIE rusza pól nadawcy', async () => {
    await sporna('s-zamkniecie');
    const odbiorca = env.authenticatedContext('user-b').firestore();
    await assertSucceeds(updateDoc(doc(odbiorca, s('s-zamkniecie')), { disputed: true }));
    await assertSucceeds(updateDoc(doc(odbiorca, s('s-zamkniecie')), {
      confirmed: true, confirmedBy: 'user-b', disputed: false, stalled: false,
    }));
    await assertFails(updateDoc(doc(odbiorca, s('s-zamkniecie')), { insisted: false }));
  });

  it('POTWIERDZONA I SPORNA NARAZ to stan niemożliwy', async () => {
    // Saldo czyta oba pola, więc taki dokument znaczyłby dwie sprzeczne rzeczy
    // o tych samych pieniądzach. Ekran nigdy tego nie zapisze — reguła pilnuje,
    // żeby nie dało się tego zrobić z boku.
    await sporna('s-oba');
    const odbiorca = env.authenticatedContext('user-b').firestore();
    await assertFails(updateDoc(doc(odbiorca, s('s-oba')), { confirmed: true, disputed: true }));
  });

  it('przy sporze nadal nie da się ruszyć kwoty ani stron', async () => {
    await sporna('s-kwota');
    const odbiorca = env.authenticatedContext('user-b').firestore();
    await assertFails(updateDoc(doc(odbiorca, s('s-kwota')), { disputed: true, amount: 999 }));
    const nadawca = env.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(nadawca, s('s-kwota')), { insisted: true, to: 'hacker' }));
  });

  it('OBCY (ani nadawca, ani odbiorca) nie ruszy żadnego z tych pól', async () => {
    await sporna('s-obcy');
    const obcy = env.authenticatedContext('user-c').firestore();
    await assertFails(updateDoc(doc(obcy, s('s-obcy')), { disputed: true }));
    await assertFails(updateDoc(doc(obcy, s('s-obcy')), { insisted: true }));
    await assertFails(updateDoc(doc(obcy, s('s-obcy')), { confirmed: true }));
  });
});

describe('reguły Firestore — przypomnienia (nudge-windykator)', () => {
  const n = (id) => `${g('g1')}/nudges/${id}`;

  it('zalogowany tworzy przypomnienie jako on sam i je odczytuje', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertSucceeds(setDoc(doc(db, n('n1')), { from: 'm1', to: 'm2', amountG: 2000, currency: 'PLN', createdBy: 'user-a', readBy: [] }));
    await assertSucceeds(getDoc(doc(db, n('n1'))));
  });

  it('NIE można utworzyć przypomnienia podszywając się pod innego twórcę', async () => {
    const db = env.authenticatedContext('user-a').firestore();
    await assertFails(setDoc(doc(db, n('n-spoof')), { from: 'm1', to: 'm2', createdBy: 'ktos-inny', readBy: [] }));
  });

  it('niezalogowany nie odczyta przypomnień', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), n('n1'))));
  });

  it('można oznaczyć „przeczytane" (tylko readBy), ale nie zmienić treści', async () => {
    const db = env.authenticatedContext('user-b').firestore();
    await assertSucceeds(updateDoc(doc(db, n('n1')), { readBy: ['user-b'] }));
    await assertFails(updateDoc(doc(db, n('n1')), { amountG: 999 }));
    await assertFails(updateDoc(doc(db, n('n1')), { to: 'hacker' }));
    await assertFails(updateDoc(doc(db, n('n1')), { readBy: ['user-b'], amountG: 999 }));
  });

  it('usunąć przypomnienie może TYLKO twórca', async () => {
    await assertFails(deleteDoc(doc(env.authenticatedContext('user-b').firestore(), n('n1'))));
    await assertSucceeds(deleteDoc(doc(env.authenticatedContext('user-a').firestore(), n('n1'))));
  });
});
