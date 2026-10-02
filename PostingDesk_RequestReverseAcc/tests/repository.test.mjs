import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, recordId, transitionPatch } from '../public/domain.js';
import { createFirestoreRepository } from '../public/firestore-repository.js';

const actor = { uid: 'nisa', displayName: 'Nisa', role: 'poster' };
const input = { operation: 'reverse', entity: 'AIO', fiscalYear: '2026', requester: 'Bing', requestDate: '2026-10-01', note: '', documents: '6300009033\n6300009034' };
const scope = { operation: 'reverse', entity: 'AIO', archived: false, from: '', to: '' };

function mockDatabase(initial = [], activeActor = actor) {
  const records = new Map(initial.map(row => [recordId(row), structuredClone(row)]));
  const matchesQuery = parts => {
    let rows = [...records.entries()].map(([id, row]) => ({ id, row }));
    for (const part of parts.filter(p => p.kind === 'where')) {
      const [field, op, value] = part.value;
      if (field === '__name__' && op === 'in') rows = rows.filter(item => value.includes(item.id));
      else if (op === '==') rows = rows.filter(item => item.row[field] === value);
      else if (op === 'in') rows = rows.filter(item => value.includes(item.row[field]));
      else if (op === '>=') rows = rows.filter(item => item.row[field] >= value);
      else if (op === '<=') rows = rows.filter(item => item.row[field] <= value);
    }
    return rows;
  };
  const sdk = {
    collection: (...parts) => parts.slice(1).join('/'), doc: (_, id) => id,
    documentId: () => '__name__', serverTimestamp: () => 2000,
    where: (...value) => ({ kind: 'where', value }), orderBy: (...value) => ({ kind: 'orderBy', value }),
    limit: value => ({ kind: 'limit', value }), query: (_, ...parts) => parts,
    onSnapshot: (query, receiveOrOptions, maybeReceive) => {
      sdk.lastQuery = query;
      const receive = typeof receiveOrOptions === 'function' ? receiveOrOptions : maybeReceive;
      receive({ docs: [], size: 0, metadata: { fromCache: false, hasPendingWrites: false } }); return () => {};
    },
    async getDocsFromServer(query) {
      sdk.lastQuery = query;
      const rows = matchesQuery(query);
      return { forEach(fn) { rows.forEach(item => fn({ id: item.id, data: () => structuredClone(item.row) })); } };
    },
    async getCountFromServer(query) {
      sdk.lastQuery = query;
      return { data: () => ({ count: matchesQuery(query).length }) };
    },
    writeBatch() {
      const writes = [];
      return {
        set: (id, row) => writes.push({ type: 'set', id, row }),
        update: (id, patch) => writes.push({ type: 'update', id, row: patch }),
        async commit() { for (const write of writes) records.set(write.id, write.type === 'set' ? write.row : { ...records.get(write.id), ...write.row }); }
      };
    },
    async runTransaction(_, callback) {
      const writes = [];
      const transaction = {
        async get(id) {
          if (writes.length) throw new Error('Read after write');
          return { exists: () => records.has(id), data: () => structuredClone(records.get(id)), id };
        },
        set: (id, row) => writes.push({ type: 'set', id, row }),
        update: (id, patch) => writes.push({ type: 'update', id, row: patch })
      };
      const result = await callback(transaction);
      for (const write of writes) records.set(write.id, write.type === 'set' ? write.row : { ...records.get(write.id), ...write.row });
      return result;
    }
  };
  return { records, sdk, repo: createFirestoreRepository(sdk, {}, 'posting-team', activeActor) };
}

const known = rows => rows.map(row => ({ ...row, id: recordId(row) }));

test('duplicate existing request cancels the entire input transaction', async () => {
  const row = createRecord(input, '6300009033', actor, 1000);
  const mock = mockDatabase([row]);
  await assert.rejects(mock.repo.addRequests(input), /Sudah tercatat/);
  assert.equal(mock.records.size, 1);
  assert.equal(mock.records.has(recordId({ ...row, documentNumber: '6300009034' })), false);
});

test('new request duplicate-check query then batch write preserves creator audit', async () => {
  const mock = mockDatabase();
  const result = await mock.repo.addRequests(input);
  assert.equal(result.added, 2);
  assert.equal(mock.records.size, 2);
  for (const row of mock.records.values()) {
    assert.equal(row.requester, 'Nisa'); assert.equal(row.status, 'pending'); assert.equal(row.createdByUid, 'nisa'); assert.equal(row.completedAt, null);
  }
});

test('bulk done uses reviewed rows, skips done/missing records, and preserves first processor', async () => {
  const pending = createRecord(input, '6300009033', actor, 1000);
  const alreadyDone = createRecord(input, '6300009034', actor, 1000);
  Object.assign(alreadyDone, transitionPatch(alreadyDone, 'done', { uid: 'other', displayName: 'Other' }, 1500));
  const mock = mockDatabase([pending, alreadyDone]);
  const result = await mock.repo.mutate([recordId(pending), recordId(alreadyDone), 'missing'], 'done', scope, known([pending, alreadyDone]));
  assert.deepEqual(result, { changed: 1, skipped: 2 });
  assert.equal(mock.records.get(recordId(alreadyDone)).completedByUid, 'other');
  assert.equal(mock.records.get(recordId(pending)).completedByUid, 'nisa');
});

test('bulk mutation cannot reach a different entity or a date outside the reviewed scope', async () => {
  const good = createRecord(input, '6300009033', actor, 1000);
  const other = { ...good, entity: 'ODI' };
  const old = { ...good, documentNumber: '6300009034', requestDate: '2026-09-30' };
  const previousYear = { ...good, documentNumber: '6300009035', fiscalYear: '2025' };
  const mock = mockDatabase([good, other, old, previousYear]);
  const result = await mock.repo.mutate([recordId(good), recordId(other), recordId(old), recordId(previousYear)], 'done', { ...scope, from: '2026-10-01', to: '2026-10-01' }, known([good, other, old, previousYear]));
  assert.deepEqual(result, { changed: 2, skipped: 2 });
  assert.equal(mock.records.get(recordId(previousYear)).status, 'done');
  assert.equal(mock.records.get(recordId(other)).status, 'pending');
});

test('archive query is on demand and bounded; active query explicitly excludes archive', () => {
  const mock = mockDatabase();
  mock.repo.subscribe(scope, () => {}, () => {});
  assert.equal(mock.sdk.lastQuery.some(part => part.kind === 'limit'), false);
  assert.equal(mock.sdk.lastQuery.some(part => part.kind === 'where' && part.value[0] === 'fiscalYear'), false);
  assert.equal(mock.sdk.lastQuery.some(part => part.kind === 'where' && part.value[0] === 'archived' && part.value[2] === false), true);
  mock.repo.subscribe({ ...scope, archived: true, archiveLimit: 200 }, () => {}, () => {});
  assert.equal(mock.sdk.lastQuery.find(part => part.kind === 'limit').value, 200);
});


test('mixed entity batch writes atomically, annotates records, and aborts if either entity already exists', async () => {
  const mixed={...input,entries:[{documentNumber:'6300009033',entity:'AIO',fiscalYear:'2026'},{documentNumber:'6300009033',entity:'ODI',fiscalYear:'2026'}]};
  const mock=mockDatabase(); await mock.repo.addRequests(mixed);
  assert.equal(mock.records.size,2);
  for (const row of mock.records.values()) { assert.match(row.note,new RegExp('dokumen ini '+row.entity)); assert.equal(row.requester,'Nisa'); }
  const clash=mockDatabase([createRecord(input,'6300009033',actor,1000)]);
  await assert.rejects(clash.repo.addRequests(mixed),/Sudah tercatat/); assert.equal(clash.records.size,1);
});

test('personal queries include UID, trash is bounded, and open counters use aggregation queries', async () => {
  const row=createRecord(input,'6300009033',actor,1000), mock=mockDatabase([row]);
  mock.repo.subscribe({...scope,ownerUid:'nisa'},()=>{},()=>{});
  assert.ok(mock.sdk.lastQuery.some(p=>p.kind==='where' && p.value[0]==='createdByUid' && p.value[2]==='nisa'));
  mock.repo.subscribe({...scope,trash:true},()=>{},()=>{});
  assert.ok(mock.sdk.lastQuery.some(p=>p.kind==='where' && p.value[0]==='status' && p.value[2]==='deleted'));
  assert.ok(mock.sdk.lastQuery.some(p=>p.kind==='limit'));
  const counts=await mock.repo.getOpenCounts('nisa');
  assert.equal(counts.reverse.AIO,1); assert.equal(counts.reverse.total,1);
  assert.ok(mock.sdk.lastQuery.some(p=>p.kind==='where' && p.value[0]==='status' && p.value[2]==='pending'));
  assert.ok(mock.sdk.lastQuery.some(p=>p.kind==='where' && p.value[0]==='createdByUid' && p.value[2]==='nisa'));
});



test('pending query ignores period while done/archive apply it, and each tab queries one status only', () => {
  const mock = mockDatabase();
  mock.repo.subscribe({ ...scope, view: 'pending', from: '2026-10-01', to: '2026-10-31' }, () => {}, () => {});
  assert.ok(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'status' && p.value[1] === '==' && p.value[2] === 'pending'));
  assert.equal(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'requestDate'), false);

  mock.repo.subscribe({ ...scope, view: 'done', from: '2026-10-01', to: '2026-10-31' }, () => {}, () => {});
  assert.ok(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'status' && p.value[2] === 'done'));
  assert.ok(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'requestDate' && p.value[1] === '>='));
  assert.ok(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'requestDate' && p.value[1] === '<='));

  mock.repo.subscribe({ ...scope, view: 'trash', trash: true, from: '2026-10-01', to: '2026-10-31' }, () => {}, () => {});
  assert.equal(mock.sdk.lastQuery.some(p => p.kind === 'where' && p.value[0] === 'requestDate'), false);
});

test('in-place edit preserves creator and rejects an edit made against stale data', async () => {
  const row=createRecord(input,'6300009033',actor,1000), mock=mockDatabase([row]);
  await mock.repo.editRequest(recordId(row),{...input,documentNumber:row.documentNumber,note:'corrected',expectedUpdatedAt:1000});
  const edited=mock.records.get(recordId(row));
  assert.equal(edited.note,'corrected'); assert.equal(edited.createdAt,1000); assert.equal(edited.editedByUid,'nisa'); assert.equal(edited.editRevision,1);
  await assert.rejects(mock.repo.editRequest(recordId(row),{...input,documentNumber:row.documentNumber,note:'stale',expectedUpdatedAt:1000}),/sudah berubah/);
  assert.equal(mock.records.get(recordId(row)).note,'corrected');
});

test('identity correction is atomic and moves the original to recoverable trash with original author preserved', async () => {
  const owner={uid:'bing',displayName:'Bing',role:'requester'}, row=createRecord(input,'6300009033',owner,1000), mock=mockDatabase([row],owner);
  const result=await mock.repo.editRequest(recordId(row),{...input,entity:'ODI',documentNumber:'6300009044',expectedUpdatedAt:1000});
  const source=mock.records.get(recordId(row)), corrected=mock.records.get(result.id);
  assert.equal(source.status,'deleted'); assert.equal(source.deleteKind,'edit'); assert.equal(source.replacementId,result.id);
  assert.equal(corrected.status,'pending'); assert.equal(corrected.createdByUid,'bing'); assert.equal(corrected.requester,'Bing');
  assert.equal(corrected.createdAt,1000); assert.equal(corrected.editSourceId,recordId(row)); assert.equal(corrected.editedAt,2000);
  await mock.repo.mutate([result.id],'delete',{...scope,entity:'ODI',ownerUid:'bing'},[{...corrected,id:result.id}]);
  assert.equal(mock.records.get(result.id).status,'deleted');
  await mock.repo.mutate([result.id],'undelete',{...scope,entity:'ODI',ownerUid:'bing',trash:true},[{...mock.records.get(result.id),id:result.id}]);
  assert.equal(mock.records.get(result.id).status,'pending');
});

test('identity clash and another requester cannot overwrite a request or partially move it', async () => {
  const row=createRecord(input,'6300009033',actor,1000), target={...row,entity:'ODI'}, mock=mockDatabase([row,target]);
  await assert.rejects(mock.repo.editRequest(recordId(row),{...input,entity:'ODI',documentNumber:row.documentNumber}),/sudah tercatat/);
  assert.equal(mock.records.get(recordId(row)).status,'pending'); assert.equal(mock.records.size,2);
  const other=mockDatabase([row],{uid:'other',displayName:'Nisa',role:'requester'});
  await assert.rejects(other.repo.editRequest(recordId(row),{...input,documentNumber:row.documentNumber}),/Edit/);
  await assert.rejects(other.repo.mutate([recordId(row)],'delete',scope,known([row])),/menghapus/);
  assert.equal(other.records.get(recordId(row)).status,'pending');
});
