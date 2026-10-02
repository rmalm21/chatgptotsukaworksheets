import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBulk, canTransition, copyText, createRecord, datePreset, monthRange, shiftMonth, matchesScope, parseDocuments, recordId, todayJakarta, transitionPatch, validDate, validateDraft, visibleRows, openCounts, canEdit, canDelete, canRestoreTrash, editRecord, validateBatch } from '../public/domain.js';

const actor = { uid: 'nisa-uid', displayName: 'Nisa', role: 'poster' };
const draft = { operation: 'reverse', entity: 'AIO', fiscalYear: '2026', requester: 'Bing', requestDate: '2026-10-01', note: '', documents: '6300009033\n6300009034' };
const row = createRecord(draft, '6300009033', actor, 1000);
const scope = { operation: draft.operation, entity: draft.entity, archived: false, from: '', to: '' };

test('paste preserves leading zero, accepts Excel separators, and reports invalid values', () => {
  const parsed = parseDocuments('0000000001\t6300009033\n6300009033;6300009034,6.3E9');
  assert.deepEqual(parsed.valid, ['0000000001', '6300009033', '6300009034']);
  assert.deepEqual(parsed.duplicates, ['6300009033']);
  assert.deepEqual(parsed.invalid, ['6.3E9']);
});

test('draft rejects partial/invalid input and enforces batch limit', () => {
  assert.throws(() => validateDraft({ ...draft, documents: '6300009033\ninvalid' }), /tidak valid/);
  assert.throws(() => validateDraft({ ...draft, requestDate: '2026-02-30' }), /Tanggal/);
  assert.throws(() => validateDraft({ ...draft, fiscalYear: '26' }), /Tahun/);
  assert.throws(() => validateDraft({ ...draft, documents: Array.from({ length: 101 }, (_, i) => String(6300009000 + i)).join('\n') }), /Maksimal 100/);
  assert.equal(validateDraft({ ...draft, documents: '6300009033\n6300009033' }).documents.length, 1);
});

test('date boundaries use Jakarta day and inclusive request dates', () => {
  assert.equal(todayJakarta(new Date('2026-09-30T17:30:00Z')), '2026-10-01');
  assert.deepEqual(datePreset('week', '2026-10-01'), { from: '2026-09-25', to: '2026-10-01' });
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(matchesScope(row, { ...scope, from: '2026-10-01', to: '2026-10-01' }), true);
  assert.equal(matchesScope(row, { ...scope, from: '2026-10-02' }), false);
  assert.equal(matchesScope({ ...row, entity: 'ODI' }, scope), false);
  assert.equal(matchesScope({ ...row, fiscalYear: '2025' }, scope), true);
});

test('copy is plain newline text, excludes done/archive, and rejects mixed scope', () => {
  const other = { ...row, documentNumber: '6300009034' };
  assert.equal(copyText([row, other, row, { ...row, status: 'done' }], scope), '6300009033\n6300009034');
  assert.equal(copyText([row, { ...row, fiscalYear: '2025' }], scope), '6300009033\n6300009033');
  assert.equal(row.status, 'pending');
  assert.throws(() => copyText([row, { ...other, entity: 'ODI' }], scope), /sama/);
  assert.equal(copyText([{ ...row, archived: true, status: 'done' }], scope), '');
});

test('archive requires done, restores to done, and reopening clears completion', () => {
  assert.equal(canTransition(row, 'archive'), false);
  const done = { ...row, ...transitionPatch(row, 'done', actor, 2000) };
  const archived = { ...done, ...transitionPatch(done, 'archive', actor, 3000) };
  assert.equal(visibleRows([row, done, archived], 'pending').length, 1);
  assert.equal(visibleRows([row, done, archived], 'archive').length, 1);
  assert.equal(canTransition(archived, 'reopen'), false);
  const restored = { ...archived, ...transitionPatch(archived, 'restore', actor, 4000) };
  assert.equal(restored.status, 'done');
  assert.equal(restored.completedByName, 'Nisa');
  assert.equal(restored.completedAt, 2000);
  const reopened = { ...restored, ...transitionPatch(restored, 'reopen', actor, 5000) };
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.completedByUid, '');
  assert.equal(reopened.status, 'pending');
});

test('record identity separates rooms, entities, and fiscal years; requester cannot bulk mutate', () => {
  assert.notEqual(recordId(row), recordId({ ...row, operation: 'cancel' }));
  assert.notEqual(recordId(row), recordId({ ...row, entity: 'ODI' }));
  assert.notEqual(recordId(row), recordId({ ...row, fiscalYear: '2027' }));
  assert.throws(() => assertBulk(['id'], { ...actor, role: 'requester' }), /pemosting/);
  assert.throws(() => assertBulk(Array.from({ length: 251 }, (_, i) => String(i)), actor), /250/);
});


test('private rooms and counts use creator UID, including users with identical display names', () => {
  const twin = { ...row, createdByUid: 'other-user' };
  assert.equal(matchesScope(row, {...scope,ownerUid:actor.uid}), true);
  assert.equal(matchesScope(twin, {...scope,ownerUid:actor.uid}), false);
  const counts = openCounts([row,twin,{...row,entity:'ODI'},{...row,status:'done'},{...row,status:'deleted'}, {...row,operation:'cancel'}],actor.uid);
  assert.equal(counts.reverse.total,2); assert.equal(counts.reverse.AIO,1); assert.equal(counts.reverse.ODI,1); assert.equal(counts.cancel.total,1);
});

test('mixed input annotations and logged-in requester are retained for every record', () => {
  const batch=validateBatch({...draft, entries:[{documentNumber:'6300009033',entity:'AIO',fiscalYear:'2026'},{documentNumber:'6300009033',entity:'ODI',fiscalYear:'2026'}]});
  assert.equal(batch.records.length,2);
  assert.match(batch.records[0].note,/dokumen ini AIO/); assert.match(batch.records[1].note,/dokumen ini ODI/);
});

test('owner can edit or recover open requests; a same-name colleague and non-poster cannot change someone else', () => {
  const owner={...actor,role:'requester'}, other={...owner,uid:'other-user'};
  assert.equal(canEdit(row,owner),true); assert.equal(canEdit(row,other),false);
  assert.equal(canDelete({...row,status:'done'},owner),false);
  const edited=editRecord(row,{...draft,documentNumber:row.documentNumber,note:'updated'},owner,2000);
  assert.equal(edited.createdAt,1000); assert.equal(edited.createdByUid,actor.uid);
  assert.equal(edited.editedAt,2000); assert.equal(edited.editRevision,1); assert.equal(edited.requester,row.requester);
  assert.throws(()=>editRecord(row,{...draft,documentNumber:row.documentNumber},other,2000),/Edit/);
  assert.throws(()=>editRecord(row,{...draft,documentNumber:'6300009033 6300009034'},owner,2000),/10 digit/);
  const deleted={...edited,...transitionPatch(edited,'delete',owner,3000)};
  assert.equal(visibleRows([deleted],'pending').length,0); assert.equal(visibleRows([deleted],'trash').length,1);
  assert.equal(canRestoreTrash(deleted,owner),true); assert.equal(canRestoreTrash(deleted,other),false);
  const restored={...deleted,...transitionPatch(deleted,'undelete',owner,4000)};
  assert.equal(restored.status,'pending'); assert.equal(restored.deletedAt,null); assert.equal(restored.editedAt,2000);
});

test('deleting and restoring a processed archive keeps completion history', () => {
  const done={...row,...transitionPatch(row,'done',actor,2000)};
  const archived={...done,...transitionPatch(done,'archive',actor,3000)};
  const deleted={...archived,...transitionPatch(archived,'delete',actor,4000)};
  const restored={...deleted,...transitionPatch(deleted,'undelete',actor,5000)};
  assert.equal(restored.status,'done'); assert.equal(restored.archived,true); assert.equal(restored.completedAt,2000); assert.equal(restored.archivedAt,3000);
});


test('monthly index spans full calendar month and shifts across year boundaries', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});
