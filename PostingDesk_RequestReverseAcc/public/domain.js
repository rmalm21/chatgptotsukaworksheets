export const MAX_CREATE = 100;
export const MAX_BULK = 250;
export const PAGE_SIZE = 25;
export const TYPES = Object.freeze({ reverse: 'Request Reverse', cancel: 'Cancel Park' });
export const ACTIONS = Object.freeze({ done: 'selesai', reopen: 'buka kembali', archive: 'arsipkan', restore: 'pulihkan', delete: 'dipindahkan ke Sampah', undelete: 'dipulihkan dari Sampah' });

export function todayJakarta(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthRange(monthKey) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(monthKey))) throw new Error('Indeks bulan tidak valid.');
  const [year, month] = String(monthKey).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
}

export function shiftMonth(monthKey, offset) {
  const { from } = monthRange(monthKey);
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Number(offset || 0));
  return date.toISOString().slice(0, 7);
}

export function datePreset(preset, today = todayJakarta()) {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: shiftDate(today, -6), to: today };
  if (preset === 'month') return monthRange(today.slice(0, 7));
  return { from: '', to: '' };
}

export function parseDocuments(input) {
  const tokens = String(input).trim().split(/[\s,;]+/).filter(Boolean);
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!/^\d{10}$/.test(token)) invalid.push(token);
    else if (seen.has(token)) duplicates.push(token);
    else { seen.add(token); valid.push(token); }
  }
  return { tokens, valid, invalid, duplicates: [...new Set(duplicates)] };
}

// Metadata pada baris dokumen berlaku untuk baris itu. Header berlaku ke baris berikutnya.
// Satu entitas/tahun global (termasuk footer) dapat mengisi baris tanpa label.
export function parseRequestPaste(input, defaults = {}) {
  const original = String(input ?? '').normalize('NFKC').replace(/\r\n?/g, '\n');
  const reverseRE = /\b(?:(?:rq|req|request)\s*)?(?:di\s*)?(?:rvs|revers(?:e|al|ing)?|rev|pembalikan)\b/gi;
  const cancelRE = /\b(?:(?:rq|req|request)\s*)?(?:(?:cancel(?:led|lation)?|cncl|cnle|batal(?:kan)?|pembatalan|hapus)\s*park(?:ed|ing)?|cancelpark(?:ed|ing)?|cancel(?:led|lation)?|cncl|cnle|cp|park(?:ed|ing)?)\b/gi;
  const politeRE = /\b(?:rq|req|request|requests|mohon|tolong|minta|please|untuk|di|dokumen|document|documents|doc|docs|nomor|number|no|daftar|list|entitas|entity|tahun|year|thn|fiscal|fy)\b\.?/gi;
  const operations = new Set(), entitySet = new Set(), yearSet = new Set();
  const lines = original.split('\n').map((text, index) => {
    let rest = text.replace(/^\s*(?:[-*•]\s+|\d{1,3}[.)]\s+)/, '').replace(/\b(AIO|ODI)(20\d{2})\b/gi, '$1 $2');
    const ops = [];
    if ([...rest.matchAll(reverseRE)].length) { ops.push('reverse'); operations.add('reverse'); }
    if ([...rest.matchAll(cancelRE)].length) { ops.push('cancel'); operations.add('cancel'); }
    rest = rest.replace(reverseRE, ' ').replace(cancelRE, ' ');
    const entities = [...new Set([...rest.matchAll(/\b(AIO|ODI)\b/gi)].map(m => m[1].toUpperCase()))];
    const years = [...new Set([...rest.matchAll(/\b20\d{2}\b/g)].map(m => m[0]))];
    entities.forEach(v => entitySet.add(v)); years.forEach(v => yearSet.add(v));
    rest = rest.replace(/\b(?:AIO|ODI)\b/gi, ' ').replace(/\b20\d{2}\b/g, ' ').replace(politeRE, ' ');
    const tokens = rest.trim().split(/[\s,;|:/()[\]{}"'=]+/).filter(Boolean);
    return { index: index + 1, ops, entities, years, documents: tokens.filter(v => /^\d{10}$/.test(v)), invalid: tokens.filter(v => !/^\d{10}$/.test(v)) };
  });
  const operation = operations.size === 1 ? [...operations][0] : defaults.operation || 'reverse';
  const globalEntity = entitySet.size === 1 ? [...entitySet][0] : null;
  const globalYear = yearSet.size === 1 ? [...yearSet][0] : null;
  const entries = [], errors = [], invalid = [], duplicates = [], seen = new Set(), normalized = [];
  let contextEntity = null, contextYear = null;
  if (operations.size > 1) errors.push('Ada Reverse dan Cancel Park sekaligus. Gunakan satu jenis request per input.');
  for (const line of lines) {
    invalid.push(...line.invalid);
    if (line.entities.length > 1) errors.push(`Baris ${line.index}: AIO dan ODI belum terpasang ke nomor masing-masing. Pisahkan per baris dan beri label entitas.`);
    if (line.years.length > 1) errors.push(`Baris ${line.index}: pisahkan tahun per baris dokumen.`);
    if (!line.documents.length) {
      if (line.entities.length === 1) contextEntity = line.entities[0];
      if (line.years.length === 1) contextYear = line.years[0];
      const meta = [...line.ops.map(v => v === 'reverse' ? 'req reverse' : 'cancel park'), ...line.entities.map(v => v.toLowerCase()), ...line.years].join(' ');
      if (meta) normalized.push(meta);
      continue;
    }
    const entity = line.entities[0] || contextEntity || globalEntity || defaults.entity || 'AIO';
    const fiscalYear = line.years[0] || contextYear || globalYear || String(defaults.fiscalYear || todayJakarta().slice(0, 4));
    if (entitySet.size > 1 && !line.entities.length && !contextEntity) errors.push(`Baris ${line.index}: beri label AIO atau ODI untuk nomor ini.`);
    if (yearSet.size > 1 && !line.years.length && !contextYear) errors.push(`Baris ${line.index}: beri tahun untuk nomor ini.`);
    if (line.ops.length) normalized.push(...line.ops.map(v => v === 'reverse' ? 'req reverse' : 'cancel park'));
    for (const documentNumber of line.documents) {
      const id = recordId({ operation, entity, fiscalYear, documentNumber });
      if (seen.has(id)) { duplicates.push(documentNumber); continue; }
      seen.add(id); entries.push({ documentNumber, entity, fiscalYear, sourceLine: line.index });
      // Hanya label yang benar-benar diketik yang ditulis kembali ke kotak.
      normalized.push([documentNumber, ...line.entities.map(v => v.toLowerCase()), ...line.years].join(' '));
    }
  }
  if (invalid.length) errors.push(`Belum terbaca: ${invalid.slice(0, 4).join(', ')}. Nomor dokumen harus 10 digit.`);
  if (entries.length > MAX_CREATE) errors.push(`Maksimal ${MAX_CREATE} dokumen per input.`);
  if (!Object.hasOwn(TYPES, operation)) errors.push('Pilih jenis request.');
  if (entries.some(v => !['AIO', 'ODI'].includes(v.entity))) errors.push('Pilih AIO atau ODI.');
  if (entries.some(v => !/^20\d{2}$/.test(v.fiscalYear))) errors.push('Tahun dokumen harus 2000–2099.');
  const entities = [...new Set(entries.map(v => v.entity))], years = [...new Set(entries.map(v => v.fiscalYear))];
  return {
    operation, entity: entities[0] || globalEntity || defaults.entity || 'AIO',
    fiscalYear: years[0] || globalYear || String(defaults.fiscalYear || todayJakarta().slice(0, 4)),
    entities, years, entries, documents: entries.map(v => v.documentNumber), invalid,
    duplicates: [...new Set(duplicates)], errors: [...new Set(errors)], mixedEntities: entities.length > 1,
    ambiguous: operations.size > 1 || lines.some(v => v.entities.length > 1 || v.years.length > 1),
    detected: { operation: operations.size === 1, entity: entitySet.size === 1, fiscalYear: yearSet.size === 1 },
    normalized: entries.length && !errors.length ? normalized.join('\n') : original
  };
}

export function yearSummary(rows, current = todayJakarta().slice(0, 4)) {
  const years = [...new Set(rows.map(row => String(row.fiscalYear)))].sort();
  const other = rows.filter(row => String(row.fiscalYear) !== current);
  return { years, nonCurrent: other.length, otherYears: [...new Set(other.map(row => String(row.fiscalYear)))].sort() };
}

export function recordId({ operation, entity, fiscalYear, documentNumber }) {
  return `${operation}_${entity}_${fiscalYear}_${documentNumber}`;
}

export function validateDraft(draft) {
  if (!Object.hasOwn(TYPES, draft.operation)) throw new Error('Pilih jenis request.');
  if (!['AIO', 'ODI'].includes(draft.entity)) throw new Error('Pilih entitas AIO atau ODI.');
  if (!/^20\d{2}$/.test(String(draft.fiscalYear))) throw new Error('Tahun dokumen harus 2000–2099.');
  if (!String(draft.requester || '').trim() || String(draft.requester).trim().length > 80) throw new Error('Isi nama requester, maksimal 80 karakter.');
  if (!validDate(draft.requestDate)) throw new Error('Tanggal request tidak valid.');
  if (String(draft.note || '').length > 500) throw new Error('Catatan maksimal 500 karakter.');
  const parsed = parseDocuments(draft.documents);
  if (!parsed.valid.length) throw new Error('Masukkan nomor dokumen 10 digit.');
  if (parsed.invalid.length) throw new Error(`Nomor tidak valid: ${parsed.invalid.slice(0, 3).join(', ')}. Gunakan 10 digit tanpa judul kolom.`);
  if (parsed.valid.length > MAX_CREATE) throw new Error(`Maksimal ${MAX_CREATE} dokumen untuk satu kali input.`);
  return {
    operation: draft.operation, entity: draft.entity, fiscalYear: String(draft.fiscalYear),
    requester: String(draft.requester).trim(), requestDate: draft.requestDate,
    note: String(draft.note || '').trim(), documents: parsed.valid, duplicates: parsed.duplicates
  };
}

export function validateBatch(input) {
  if (!Array.isArray(input.entries)) {
    const draft = validateDraft(input);
    return { operation: draft.operation, requestDate: draft.requestDate, duplicates: draft.duplicates,
      records: draft.documents.map(documentNumber => ({ ...draft, documentNumber })) };
  }
  if (!input.entries.length || input.entries.length > MAX_CREATE) throw new Error(`Masukkan 1–${MAX_CREATE} dokumen.`);
  const mixed = new Set(input.entries.map(v => v.entity)).size > 1;
  const records = [], duplicates = [], seen = new Set();
  for (const entry of input.entries) {
    if (!/^\d{10}$/.test(String(entry.documentNumber))) throw new Error('Nomor dokumen harus tepat 10 digit.');
    const annotation = mixed ? `Input campuran AIO/ODI · dokumen ini ${entry.entity}.` : '';
    const note = [String(input.note || '').trim(), annotation].filter(Boolean).join('\n');
    const draft = validateDraft({ ...input, entity: entry.entity, fiscalYear: entry.fiscalYear, documents: entry.documentNumber, note });
    const record = { ...draft, documentNumber: entry.documentNumber };
    const id = recordId(record);
    if (seen.has(id)) { duplicates.push(entry.documentNumber); continue; }
    seen.add(id); records.push(record);
  }
  return { operation: input.operation, requestDate: input.requestDate, records, duplicates };
}

export function matchesScope(row, scope) {
  const explicitView = scope.view || '';
  const view = explicitView || (scope.trash ? 'trash' : scope.archived ? 'archive' : 'legacy');
  const statusMatch = view === 'trash' ? row.status === 'deleted' :
    view === 'archive' ? row.status !== 'deleted' && Boolean(row.archived) :
    view === 'done' ? row.status === 'done' && !row.archived :
    view === 'pending' ? row.status === 'pending' && !row.archived :
    row.status !== 'deleted' && Boolean(row.archived) === Boolean(scope.archived);
  // Scope lama tanpa `view` tetap menghormati tanggal untuk kompatibilitas helper/test.
  // UI v3.0.7 selalu mengirim `view`, sehingga Antrean tidak pernah dibatasi periode.
  const applyPeriod = !explicitView || view === 'done' || view === 'archive';
  return row.operation === scope.operation && row.entity === scope.entity &&
    (!scope.ownerUid || row.createdByUid === scope.ownerUid) &&
    (!scope.fiscalYear || row.fiscalYear === String(scope.fiscalYear)) &&
    statusMatch &&
    (!applyPeriod || ((!scope.from || row.requestDate >= scope.from) && (!scope.to || row.requestDate <= scope.to)));
}

export function visibleRows(rows, view) {
  return rows.filter(row => view === 'trash' ? row.status === 'deleted' : row.status !== 'deleted' && (view === 'archive' ? row.archived : !row.archived && row.status === (view === 'done' ? 'done' : 'pending')));
}

export function openCounts(rows, ownerUid = '') {
  const open = rows.filter(row => row.status === 'pending' && !row.archived && (!ownerUid || row.createdByUid === ownerUid));
  return Object.fromEntries(['reverse', 'cancel'].map(operation => [operation,
    { total: open.filter(v => v.operation === operation).length, ...Object.fromEntries(['AIO', 'ODI'].map(entity => [entity, open.filter(v => v.operation === operation && v.entity === entity).length])) }
  ]));
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => b.requestDate.localeCompare(a.requestDate) || timestampMillis(b.createdAt) - timestampMillis(a.createdAt) || a.documentNumber.localeCompare(b.documentNumber));
}

export function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export function copyText(rows, scope) {
  if (rows.some(row => row.operation !== scope.operation || row.entity !== scope.entity || (scope.fiscalYear && row.fiscalYear !== String(scope.fiscalYear)))) throw new Error('Copy harus dari jenis request dan entitas yang sama.');
  const unique = new Map(rows.filter(row => row.status === 'pending' && !row.archived).map(row => [recordId(row), row.documentNumber]));
  return [...unique.values()].join('\n');
}

export function canEdit(row, actor) {
  return row.status === 'pending' && !row.archived && (actor?.role === 'poster' || row.createdByUid === actor?.uid);
}

export function canDelete(row, actor) {
  return row.status !== 'deleted' && (actor?.role === 'poster' || canEdit(row, actor));
}

export function canRestoreTrash(row, actor) {
  return row.status === 'deleted' && (actor?.role === 'poster' || (row.previousStatus === 'pending' && !row.archived && row.createdByUid === actor?.uid));
}

export function canTransition(row, action) {
  if (action === 'delete') return row.status !== 'deleted';
  if (action === 'undelete') return row.status === 'deleted';
  if (action === 'done') return !row.archived && row.status === 'pending';
  if (action === 'reopen') return !row.archived && row.status === 'done';
  if (action === 'archive') return !row.archived && row.status === 'done';
  if (action === 'restore') return row.archived && row.status === 'done';
  return false;
}

export function transitionPatch(row, action, actor, now) {
  if (!canTransition(row, action)) return null;
  if (action === 'delete' && !canDelete(row, actor)) throw new Error('Hanya pemilik request yang masih open atau pemosting yang boleh menghapus.');
  if (action === 'undelete' && !canRestoreTrash(row, actor)) throw new Error('Akun ini belum boleh memulihkan dokumen tersebut.');
  const patch = { updatedAt: now, updatedByUid: actor.uid, updatedByName: actor.displayName };
  if (action === 'delete') return { ...patch, status: 'deleted', previousStatus: row.status, deletedAt: now, deletedByUid: actor.uid, deletedByName: actor.displayName, deleteKind: 'user', replacementId: '' };
  if (action === 'undelete') return { ...patch, status: row.previousStatus, previousStatus: '', deletedAt: null, deletedByUid: '', deletedByName: '', deleteKind: '', replacementId: '' };
  if (action === 'done') return { ...patch, status: 'done', completedAt: now, completedByUid: actor.uid, completedByName: actor.displayName };
  if (action === 'reopen') return { ...patch, status: 'pending', completedAt: null, completedByUid: '', completedByName: '' };
  if (action === 'archive') return { ...patch, archived: true, archivedAt: now, archivedByUid: actor.uid, archivedByName: actor.displayName };
  return { ...patch, archived: false, archivedAt: null, archivedByUid: '', archivedByName: '' };
}

export function editRecord(row, input, actor, now) {
  if (!canEdit(row, actor)) throw new Error('Edit hanya tersedia untuk request open milik sendiri atau oleh pemosting.');
  if (!/^\d{10}$/.test(String(input.documentNumber))) throw new Error('Nomor dokumen harus tepat 10 digit.');
  const note = String(input.note || '').replace(/Input campuran AIO\/ODI · dokumen ini (?:AIO|ODI)\./g, `Input campuran AIO/ODI · dokumen ini ${input.entity}.`);
  const draft = validateDraft({ ...input, note, documents: input.documentNumber, requester: row.requester });
  return { ...row, operation: draft.operation, entity: draft.entity, fiscalYear: draft.fiscalYear,
    documentNumber: draft.documents[0], requestDate: draft.requestDate, note: draft.note,
    updatedAt: now, updatedByUid: actor.uid, updatedByName: actor.displayName,
    editedAt: now, editedByUid: actor.uid, editedByName: actor.displayName, editRevision: (row.editRevision || 0) + 1 };
}

export function createRecord(draft, documentNumber, actor, now) {
  return {
    operation: draft.operation, entity: draft.entity, fiscalYear: String(draft.fiscalYear),
    documentNumber, requester: actor.displayName, requestDate: draft.requestDate, note: draft.note,
    status: 'pending', archived: false,
    createdAt: now, createdByUid: actor.uid, createdByName: actor.displayName,
    updatedAt: now, updatedByUid: actor.uid, updatedByName: actor.displayName,
    completedAt: null, completedByUid: '', completedByName: '',
    archivedAt: null, archivedByUid: '', archivedByName: '',
    editedAt: null, editedByUid: '', editedByName: '', editRevision: 0, editSourceId: '',
    previousStatus: '', deletedAt: null, deletedByUid: '', deletedByName: '', deleteKind: '', replacementId: ''
  };
}

export function assertBulk(ids, actor, action = 'done') {
  if (!actor?.uid) throw new Error('Masuk terlebih dahulu.');
  if (!['delete', 'undelete'].includes(action) && actor.role !== 'poster') throw new Error('Hanya pemosting yang bisa mengubah cek selesai dan arsip.');
  if (!ids.length || ids.length > MAX_BULK) throw new Error(`Pilih 1–${MAX_BULK} dokumen untuk satu tindakan.`);
  if (new Set(ids).size !== ids.length) throw new Error('Pilihan dokumen berulang.');
}

export function formatDate(value, compact = false) {
  if (!validDate(value)) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: compact ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function formatTimestamp(value) {
  const millis = timestampMillis(value);
  if (!millis) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(millis)) + ' WIB';
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

export function friendlyError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email atau password belum cocok.';
  if (code.includes('invalid-email')) return 'Format email tidak valid.';
  if (code.includes('too-many-requests')) return 'Terlalu banyak percobaan. Coba lagi beberapa saat.';
  if (code.includes('permission-denied')) return 'Akses akun belum terdaftar atau perannya belum mengizinkan tindakan ini.';
  if (code.includes('failed-precondition')) return 'Indeks database belum siap. Admin perlu deploy firestore.indexes.json dan menunggu indeks aktif.';
  if (code.includes('timeout')) return 'Koneksi terlalu lama. Coba lagi atau periksa koneksi internet.';
  if (code.includes('network') || code.includes('unavailable')) return 'Koneksi terputus. Sambungkan internet lalu coba lagi.';
  if (code.includes('web-storage-unsupported')) return 'Browser belum mengizinkan penyimpanan sesi. Izinkan penyimpanan situs atau matikan Ingat saya untuk masuk sekali.';
  if (code.includes('operation-not-allowed')) return 'Login Email/Password belum diaktifkan oleh admin.';
  return error?.message || 'Tindakan belum berhasil. Coba lagi.';
}
