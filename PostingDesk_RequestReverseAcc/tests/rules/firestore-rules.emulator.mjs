// Uji rules Firestore v3.1 terhadap emulator, memakai repository aplikasi yang asli.
// Jalankan: npm install && npm run test:rules   (butuh Java 11+)
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { createFirestoreRepository } from '../../public/firestore-repository.js';
import { createRecord, recordId, todayJakarta, traceOf } from '../../public/domain.js';

const WS = 'posting-team';
const people = {
  nisa: { uid: 'nisa', displayName: 'Nisa', role: 'poster' },
  bing: { uid: 'bing', displayName: 'Bing', role: 'requester' },
  rama: { uid: 'rama', displayName: 'Rama', role: 'requester' }
};
const today = todayJakarta();
const year = today.slice(0, 4);
let env;

const dbFor = who => env.authenticatedContext(who.uid).firestore();
const repoFor = who => createFirestoreRepository(sdk, dbFor(who), WS, who);
const ref = (db, id) => sdk.doc(db, 'workspaces', WS, 'requests', id);
const read = async id => {
  let data;
  await env.withSecurityRulesDisabled(async context => { data = (await sdk.getDoc(ref(context.firestore(), id))).data(); });
  return data;
};
const rowOf = async id => ({ ...(await read(id)), id });
const scope = (operation = 'reverse', entity = 'AIO') => ({ operation, entity, view: '' });

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-posting-desk',
    firestore: { host, port: Number(port), rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const person of Object.values(people)) {
      await sdk.setDoc(sdk.doc(db, 'workspaces', WS, 'members', person.uid), { displayName: person.displayName, role: person.role, active: true });
    }
  });
});

async function addAs(who, numbers, operation = 'reverse', entity = 'AIO') {
  return repoFor(who).addRequests({ operation, entity, fiscalYear: year, requestDate: today, note: '', documents: numbers.join('\n') });
}

test('create via repository writes trail e1; create without/forged trail is rejected', async () => {
  await assertSucceeds(addAs(people.bing, ['5000000001']));
  const row = await read(`reverse_AIO_${year}_5000000001`);
  assert.equal(row.trailCount, 1);
  assert.equal(row.trail.e1.a, 'create');
  assert.equal(row.trail.e1.uid, 'bing');
  assert.equal(row.trail.e1.name, 'Bing');

  const db = dbFor(people.bing);
  const base = createRecord({ operation: 'reverse', entity: 'AIO', fiscalYear: year, requestDate: today, note: '' }, '5000000002', people.bing, sdk.serverTimestamp());
  const { trail, trailCount, ...noTrail } = base;
  await assertFails(sdk.setDoc(ref(db, `reverse_AIO_${year}_5000000002`), noTrail));
  await assertFails(sdk.setDoc(ref(db, `reverse_AIO_${year}_5000000002`), { ...base, trail: { e1: { ...trail.e1, uid: 'nisa', name: 'Nisa' } } }));
  await assertFails(sdk.setDoc(ref(db, `reverse_AIO_${year}_5000000002`), { ...base, trailCount: 2, trail: { ...trail, e2: trail.e1 } }));
  await assertSucceeds(sdk.setDoc(ref(db, `reverse_AIO_${year}_5000000002`), base));
});

test('poster done → reopen → done → archive → restore each append one trail entry', async () => {
  await addAs(people.bing, ['5000000011']);
  const id = `reverse_AIO_${year}_5000000011`;
  const repo = repoFor(people.nisa);
  const viewFor = { done: 'pending', reopen: 'done', archive: 'done', restore: 'archive' };
  for (const action of ['done', 'reopen', 'done', 'archive', 'restore']) {
    const result = await assertSucceeds(repo.mutate([id], action, { ...scope(), view: viewFor[action] }, [await rowOf(id)]));
    assert.equal(result.changed, 1, action);
  }
  const row = await read(id);
  assert.equal(row.trailCount, 6);
  assert.deepEqual(traceOf(row).map(entry => entry.action), ['create', 'done', 'reopen', 'done', 'archive', 'restore']);
  assert.ok(Object.values(row.trail).every(entry => entry.at instanceof sdk.Timestamp));
  assert.equal(row.status, 'done'); assert.equal(row.archived, false);
});

test('status change without trail, with wrong action, or rewriting old entries is rejected', async () => {
  await addAs(people.bing, ['5000000021']);
  const id = `reverse_AIO_${year}_5000000021`;
  const db = dbFor(people.nisa);
  const now = sdk.serverTimestamp();
  const done = { status: 'done', completedAt: now, completedByUid: 'nisa', completedByName: 'Nisa', updatedAt: now, updatedByUid: 'nisa', updatedByName: 'Nisa' };
  await assertFails(sdk.updateDoc(ref(db, id), done));
  await assertFails(sdk.updateDoc(ref(db, id), { ...done, trailCount: 2, 'trail.e2': { a: 'archive', at: now, uid: 'nisa', name: 'Nisa' } }));
  await assertFails(sdk.updateDoc(ref(db, id), { ...done, trailCount: 2, 'trail.e2': { a: 'done', at: now, uid: 'nisa', name: 'Nisa' }, 'trail.e1.name': 'Palsu' }));
  await assertFails(sdk.updateDoc(ref(db, id), { ...done, trailCount: 3, 'trail.e3': { a: 'done', at: now, uid: 'nisa', name: 'Nisa' } }));
  await assertSucceeds(sdk.updateDoc(ref(db, id), { ...done, trailCount: 2, 'trail.e2': { a: 'done', at: now, uid: 'nisa', name: 'Nisa' } }));
});

test('requester cannot process; requester deletes and recovers own pending request with trail', async () => {
  await addAs(people.bing, ['5000000031']);
  await addAs(people.rama, ['5000000032']);
  const own = `reverse_AIO_${year}_5000000031`, other = `reverse_AIO_${year}_5000000032`;
  const bing = repoFor(people.bing);
  await assert.rejects(bing.mutate([own], 'done', scope(), [await rowOf(own)]), /pemosting/);
  await assert.rejects(bing.mutate([other], 'delete', scope(), [await rowOf(other)]), /pemilik/);
  // Lewati pemeriksaan klien: server tetap menolak hapus request milik orang lain.
  const now = sdk.serverTimestamp();
  await assertFails(sdk.updateDoc(ref(dbFor(people.bing), other), { status: 'deleted', previousStatus: 'pending', deletedAt: now, deletedByUid: 'bing', deletedByName: 'Bing', deleteKind: 'user', replacementId: '', updatedAt: now, updatedByUid: 'bing', updatedByName: 'Bing', trailCount: 2, 'trail.e2': { a: 'delete', at: now, uid: 'bing', name: 'Bing' } }));
  await assertSucceeds(bing.mutate([own], 'delete', scope(), [await rowOf(own)]));
  let row = await read(own);
  assert.equal(row.status, 'deleted'); assert.equal(row.trail.e2.a, 'delete');
  await assertSucceeds(bing.mutate([own], 'undelete', { ...scope(), trash: true }, [await rowOf(own)]));
  row = await read(own);
  assert.equal(row.status, 'pending'); assert.equal(row.trailCount, 3); assert.equal(row.trail.e3.a, 'undelete');
});

test('edit keeps trail with change summary; identity edit moves trail to the new document', async () => {
  await addAs(people.bing, ['5000000041']);
  const id = `reverse_AIO_${year}_5000000041`;
  const bing = repoFor(people.bing);
  const current = await rowOf(id);
  await assertSucceeds(bing.editRequest(id, { documentNumber: '5000000041', operation: 'reverse', entity: 'AIO', fiscalYear: year, requestDate: today, note: 'catatan baru', expectedUpdatedAt: current.updatedAt.toMillis() }));
  let row = await read(id);
  assert.equal(row.trail.e2.a, 'edit'); assert.match(row.trail.e2.info, /Catatan diubah/);

  const result = await assertSucceeds(bing.editRequest(id, { documentNumber: '5000000042', operation: 'reverse', entity: 'ODI', fiscalYear: year, requestDate: today, note: 'catatan baru', expectedUpdatedAt: row.updatedAt.toMillis() }));
  assert.equal(result.id, `reverse_ODI_${year}_5000000042`);
  const old = await read(id), moved = await read(result.id);
  assert.equal(old.status, 'deleted'); assert.equal(old.trail.e3.a, 'delete'); assert.match(old.trail.e3.info, /Diganti saat edit/);
  assert.deepEqual(traceOf(moved).map(entry => entry.action), ['create', 'edit', 'edit']);
  assert.match(moved.trail.e3.info, /Nomor 5000000041 → 5000000042 · Entitas AIO → ODI/);
  assert.equal(moved.createdByUid, 'bing');
});

test('duplicate check reports where the number already lives; other types are related info only', async () => {
  await addAs(people.bing, ['5000000051']);
  await assert.rejects(addAs(people.rama, ['5000000051']), /5000000051 \(Request Reverse AIO \d{4} · Antrean\)/);
  const result = await addAs(people.rama, ['5000000051'], 'cancel', 'AIO');
  assert.equal(result.added, 1);
  assert.equal(result.related.length, 1);
  assert.equal(result.related[0].operation, 'reverse');
});

test('search by number works for members across types and statuses; outsiders are denied', async () => {
  await addAs(people.bing, ['5000000061', '5000000062']);
  await addAs(people.bing, ['5000000061'], 'cancel', 'ODI');
  const id = `reverse_AIO_${year}_5000000062`;
  await repoFor(people.bing).mutate([id], 'delete', scope(), [await rowOf(id)]);
  const exact = await assertSucceeds(repoFor(people.rama).findDocuments('5000000061\n5000000062 5000000069'));
  assert.equal(exact.rows.length, 3);
  assert.deepEqual(exact.missing, ['5000000069']);
  const prefix = await repoFor(people.nisa).findDocuments('50000000');
  assert.equal(prefix.rows.length, 3);
  const outsider = { uid: 'outsider', displayName: 'X', role: 'poster' };
  await assertFails(repoFor(outsider).findDocuments('5000000061'));
});

test('legacy documents without trail can still be processed and start their trail', async () => {
  const legacy = createRecord({ operation: 'reverse', entity: 'AIO', fiscalYear: year, requestDate: today, note: '' }, '5000000071', people.bing, sdk.Timestamp.now());
  const { trail, trailCount, ...noTrail } = legacy;
  const id = recordId(legacy);
  await env.withSecurityRulesDisabled(context => sdk.setDoc(ref(context.firestore(), id), noTrail));
  await assertSucceeds(repoFor(people.nisa).mutate([id], 'done', scope(), [await rowOf(id)]));
  const row = await read(id);
  assert.equal(row.trailCount, 1);
  assert.deepEqual(traceOf(row).map(entry => [entry.action, entry.legacy]), [['create', true], ['done', false]]);
});

test('open counts aggregate still allowed for members', async () => {
  await addAs(people.bing, ['5000000081', '5000000082']);
  const counts = await assertSucceeds(repoFor(people.rama).getOpenCounts());
  assert.equal(counts.reverse.AIO, 2);
  const mine = await repoFor(people.rama).getOpenCounts('rama');
  assert.equal(mine.reverse.total, 0);
});

test('full-size batches stay within rules limits: 100-document create and 250-document bulk done/archive/delete', async () => {
  const numbers = Array.from({ length: 250 }, (_, index) => String(5100000000 + index));
  for (let index = 0; index < numbers.length; index += 100) await assertSucceeds(addAs(people.bing, numbers.slice(index, index + 100)));
  const ids = numbers.map(number => `reverse_AIO_${year}_${number}`);
  const rows = async () => Promise.all(ids.map(rowOf));
  const nisa = repoFor(people.nisa);
  assert.equal((await assertSucceeds(nisa.mutate(ids, 'done', { ...scope(), view: 'pending' }, await rows()))).changed, 250);
  assert.equal((await assertSucceeds(nisa.mutate(ids, 'archive', { ...scope(), view: 'done' }, await rows()))).changed, 250);
  assert.equal((await assertSucceeds(nisa.mutate(ids, 'delete', { ...scope(), view: 'archive' }, await rows()))).changed, 250);
  const sample = await read(ids[249]);
  assert.deepEqual(traceOf(sample).map(entry => entry.action), ['create', 'done', 'archive', 'delete']);
});
