import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, editRecord, matchesSearch, parseSearch, recordId, rowView, statusLabel, traceOf, transitionPatch } from '../public/domain.js';
import { connectDemo } from '../public/demo-store.js';
import { describeRecord, trailFieldUpdate } from '../public/firestore-repository.js';

const poster = { uid: 'nisa', displayName: 'Nisa', role: 'poster' };
const requester = { uid: 'bing', displayName: 'Bing', role: 'requester' };
const base = { operation: 'reverse', entity: 'AIO', fiscalYear: '2026', requestDate: '2026-10-01', note: '' };

test('parseSearch: exact 10-digit numbers (many at once), 4–9 digit prefix, and guidance errors', () => {
  assert.deepEqual(parseSearch('5000043992, 5000043992\n3000035398 aio').exact, ['5000043992', '3000035398']);
  assert.equal(parseSearch('50000').prefix, '50000');
  assert.equal(parseSearch('500').error, 'Ketik minimal 4 digit awal, atau nomor lengkap 10 digit.');
  assert.match(parseSearch('').error, /Ketik/);
  assert.match(parseSearch(Array.from({ length: 101 }, (_, i) => 5000000000 + i).join(' ')).error, /Maksimal 100/);
  assert.equal(parseSearch('0000000001').exact[0], '0000000001');
});

test('matchesSearch filters loaded rows by partial or exact numbers', () => {
  const row = { documentNumber: '5000043992' };
  assert.equal(matchesSearch(row, []), true);
  assert.equal(matchesSearch(row, ['4399']), true);
  assert.equal(matchesSearch(row, ['1111', '3992']), true);
  assert.equal(matchesSearch(row, ['6300']), false);
});

test('every transition appends a numbered trail entry and never rewrites old ones', () => {
  let row = { ...createRecord(base, '5000043992', requester, 1000), id: 'x' };
  assert.equal(row.trailCount, 1);
  assert.deepEqual(row.trail.e1, { a: 'create', at: 1000, uid: 'bing', name: 'Bing' });
  for (const [action, at] of [['done', 2000], ['reopen', 3000], ['done', 4000], ['archive', 5000], ['restore', 6000], ['delete', 7000], ['undelete', 8000]]) {
    row = { ...row, ...transitionPatch(row, action, poster, at) };
  }
  assert.equal(row.trailCount, 8);
  assert.deepEqual(row.trail.e1, { a: 'create', at: 1000, uid: 'bing', name: 'Bing' });
  assert.deepEqual(traceOf(row).map(entry => entry.action), ['create', 'done', 'reopen', 'done', 'archive', 'restore', 'delete', 'undelete']);
  // Reopen dulu menghapus completedBy; jejak tetap menyimpan siapa yang pernah menyelesaikan.
  assert.equal(traceOf(row).filter(entry => entry.action === 'done').length, 2);
});

test('edit trail summarises changed fields including identity correction', () => {
  const row = createRecord(base, '5000043992', requester, 1000);
  const edited = editRecord(row, { ...base, documentNumber: '5000043993', entity: 'ODI', requestDate: '2026-10-02', note: 'baru' }, requester, 2000);
  assert.equal(edited.trail.e2.a, 'edit');
  assert.match(edited.trail.e2.info, /^Nomor 5000043992 → 5000043993 · Entitas AIO → ODI · Tanggal 2026-10-01 → 2026-10-02 · Catatan diubah · dari reverse_AIO_2026_5000043992$/);
  assert.ok(edited.trail.e2.info.length <= 300);
});

test('legacy rows without trail still show a derived history', () => {
  const legacy = { ...createRecord(base, '5000043992', requester, 1000), trail: undefined, trailCount: undefined,
    status: 'done', completedAt: 3000, completedByName: 'Nisa', editedAt: 2000, editedByName: 'Bing' };
  const trace = traceOf(legacy);
  assert.deepEqual(trace.map(entry => entry.action), ['create', 'edit', 'done']);
  assert.ok(trace.every(entry => entry.legacy));
});

test('status labels and view routing for search results', () => {
  const row = createRecord(base, '5000043992', requester, 1000);
  assert.equal(statusLabel(row), 'Antrean'); assert.equal(rowView(row), 'pending');
  assert.equal(statusLabel({ ...row, status: 'done', archived: true }), 'Arsip'); assert.equal(rowView({ ...row, status: 'done', archived: true }), 'archive');
  assert.equal(statusLabel({ ...row, status: 'deleted' }), 'Sampah'); assert.equal(rowView({ ...row, status: 'deleted' }), 'trash');
  assert.equal(describeRecord(row), '5000043992 (Request Reverse AIO 2026 · Antrean)');
});

test('trailFieldUpdate writes only the new entry as a field path', () => {
  const row = createRecord(base, '5000043992', requester, 1000);
  const patch = transitionPatch(row, 'done', poster, 2000);
  const update = trailFieldUpdate(patch);
  assert.equal(update.trail, undefined);
  assert.deepEqual(update['trail.e2'], { a: 'done', at: 2000, uid: 'nisa', name: 'Nisa' });
  assert.equal(update.trailCount, 2);
});

test('demo store: lacak nomor across types/statuses, missing numbers, prefix', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const { repository } = connectDemo();
  const year = new Date().toISOString().slice(0, 4);
  const exact = await repository.findDocuments('5000044411 6300009033 5000099999');
  assert.deepEqual(exact.rows.map(row => row.documentNumber).sort(), ['5000044411', '6300009033']);
  assert.deepEqual(exact.missing, ['5000099999']);
  assert.equal(exact.rows.find(row => row.documentNumber === '5000044411').archived, true);
  const prefix = await repository.findDocuments('63000090');
  assert.equal(prefix.rows.length, 3);
  await assert.rejects(repository.findDocuments('12'), /minimal 4 digit/);
  assert.ok(recordId({ ...base, fiscalYear: year, documentNumber: '1' }));
});
