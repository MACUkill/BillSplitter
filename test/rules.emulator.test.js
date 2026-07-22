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
      members: { m1: { id: 'm1', name: 'M', claimedBy: null } },
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
