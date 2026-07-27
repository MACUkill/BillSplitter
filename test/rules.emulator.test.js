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
const APP = 'bill-splitter-public';
const g = (id) => `artifacts/${APP}/public/data/groups/${id}`;

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'billsplitter-rules-test',
    firestore: { host: '127.0.0.1', port: 8770, rules },
  });
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

  it('usunąć wpłatę może TYLKO twórca', async () => {
    await assertFails(deleteDoc(doc(env.authenticatedContext('user-b').firestore(), s('s1'))));
    await assertSucceeds(deleteDoc(doc(env.authenticatedContext('user-a').firestore(), s('s1'))));
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
