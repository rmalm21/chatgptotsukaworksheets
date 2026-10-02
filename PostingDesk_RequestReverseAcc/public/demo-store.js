import { assertBulk, createRecord, matchesScope, openCounts, parseSearch, recordId, shiftDate, sortRows, todayJakarta, transitionPatch, validateBatch, editRecord, timestampMillis } from './domain.js';

const KEY = 'posting-desk-demo-v31';
const actor = Object.freeze({ uid: 'demo-poster', displayName: 'Nisa', email: 'demo@posting.local', role: 'poster' });
const subscribers = new Set();
let memory = null;

function samples() {
  const today = todayJakarta();
  const year = today.slice(0, 4);
  const make = (operation, entity, numbers, requester, offset, status = 'pending', archived = false, fiscalYear = year) => numbers.map((number, index) => {
    const now = Date.now() - (offset * 24 * 3600 + index * 60) * 1000;
    let row = createRecord({ operation, entity, fiscalYear, requester, requestDate: shiftDate(today, -offset), note: '' }, number, { uid: requester === 'Nisa' ? actor.uid : `demo-${requester.toLowerCase()}`, displayName: requester }, now);
    if (status === 'done') row = { ...row, ...transitionPatch(row, 'done', actor, now + 30000) };
    if (archived) row = { ...row, ...transitionPatch(row, 'archive', actor, now + 60000) };
    return { ...row, id: recordId(row) };
  });
  return [
    ...make('reverse', 'AIO', ['5000043992', '3000035398', '5000044177'], 'Bing', 0),
    ...make('reverse', 'AIO', ['5000044176', '5000041587'], 'Nisa', 1),
    ...make('reverse', 'AIO', ['5000038721'], 'Rama', 2, 'pending', false, String(Number(year) - 1)),
    ...make('reverse', 'AIO', ['5000041588', '5000041589'], 'Bing', 2, 'done'),
    ...make('reverse', 'AIO', ['5000044411'], 'Nisa', 8, 'done', true),
    ...make('reverse', 'ODI', ['6300009033', '6300009034'], 'Bing', 0),
    ...make('cancel', 'AIO', ['5000044181', '5000044182'], 'Bing', 0),
    ...make('cancel', 'AIO', ['5000044060'], 'Nisa', 1, 'done'),
    ...make('cancel', 'ODI', ['6300009035'], 'Nisa', 0)
  ];
}

function load() {
  if (memory) return memory;
  try { memory = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { memory = null; }
  if (!Array.isArray(memory)) memory = samples();
  return memory;
}

function notify() { subscribers.forEach(fn => fn()); }
function save(rows) {
  memory = rows;
  try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* Demo tetap bisa berjalan di memori. */ }
  notify();
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === KEY) { memory = null; notify(); }
});

export function connectDemo() {
  const repository = {
    subscribe(scope, receive) {
      const emit = () => {
        const rows = sortRows(load().filter(row => matchesScope(row, scope)));
        const limit = scope.archiveLimit || 100;
        const bounded = scope.archived || scope.trash;
        receive(bounded ? rows.slice(0, limit) : rows, { cached: false, pendingWrites: false, mayHaveMore: bounded && rows.length > limit });
      };
      subscribers.add(emit); emit();
      return () => subscribers.delete(emit);
    },
    async getOpenCounts(ownerUid = '') {
      return openCounts(load(), ownerUid);
    },
    async addRequests(input) {
      const draft = validateBatch({ ...input, requester: actor.displayName });
      const current = load();
      const records = draft.records.map(row => createRecord(row, row.documentNumber, actor, Date.now()));
      const duplicate = records.find(record => current.some(row => row.id === recordId(record)));
      if (duplicate) throw new Error(`Dokumen ${duplicate.documentNumber} sudah tercatat. Cek Antrean, Selesai, Arsip, atau Sampah.`);
      const numbers = new Set(records.map(record => record.documentNumber));
      const related = current.filter(row => numbers.has(row.documentNumber) && row.status !== 'deleted');
      save([...current, ...records.map(record => ({ ...record, id: recordId(record) }))]);
      return { added: records.length, duplicates: draft.duplicates.length, related };
    },
    async mutate(ids, action, scope, knownRows = []) {
      assertBulk(ids, actor, action);
      let changed = 0;
      const rows = load().map(row => {
        if (!ids.includes(row.id) || !matchesScope(row, scope)) return row;
        const patch = transitionPatch(row, action, actor, Date.now());
        if (!patch) return row;
        changed++; return { ...row, ...patch };
      });
      save(rows); return { changed, skipped: ids.length - changed };
    },
    async editRequest(id, input) {
      const rows = load(), current = rows.find(row => row.id === id);
      if (!current) throw new Error('Dokumen sudah tidak tersedia.');
      if (input.expectedUpdatedAt !== undefined && timestampMillis(current.updatedAt) !== input.expectedUpdatedAt) throw new Error('Data sudah berubah sejak editor dibuka. Tutup lalu buka lagi.');
      const now = Date.now(), corrected = editRecord(current, input, actor, now), nextId = recordId(corrected);
      if (nextId !== id && rows.some(row => row.id === nextId)) throw new Error('Dokumen tersebut sudah tercatat. Cek juga Arsip dan Sampah.');
      if (nextId === id) save(rows.map(row => row.id === id ? corrected : row));
      else save([...rows.map(row => row.id === id ? { ...row, ...transitionPatch(row, 'delete', actor, now, `Diganti saat edit → ${nextId}`), deleteKind: 'edit', replacementId: nextId } : row), { ...corrected, id: nextId, editSourceId: id }]);
      return { id: nextId, operation: corrected.operation, entity: corrected.entity, requestDate: corrected.requestDate };
    },
    async findDocuments(text) {
      const search = parseSearch(text);
      if (search.error) throw new Error(search.error);
      if (search.exact.length) {
        const wanted = new Set(search.exact), rows = load().filter(row => wanted.has(row.documentNumber));
        const hit = new Set(rows.map(row => row.documentNumber));
        return { rows: sortRows(rows), missing: search.exact.filter(number => !hit.has(number)), truncated: false, search };
      }
      const rows = load().filter(row => row.documentNumber.startsWith(search.prefix)).sort((a, b) => a.documentNumber.localeCompare(b.documentNumber));
      return { rows: rows.slice(0, 50), missing: [], truncated: rows.length > 50, search };
    }
  };
  return { actor, repository, reset() { save(samples()); } };
}
