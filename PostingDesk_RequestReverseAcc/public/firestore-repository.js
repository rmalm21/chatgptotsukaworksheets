import { assertBulk, createRecord, editRecord, matchesScope, recordId, timestampMillis, transitionPatch, validateBatch } from './domain.js';

// Repository v3.0.7: Antrean membaca hanya status pending tanpa batas periode.
// Selesai dan Arsip memakai rentang tanggal aktif; Sampah tetap on-demand dan bounded.
// Counter memakai aggregation count dan bulk mutation memakai writeBatch agar hemat read.
export function createFirestoreRepository(sdk, db, workspaceId, actor) {
  const collectionRef = sdk.collection(db, 'workspaces', workspaceId, 'requests');
  const refFor = id => sdk.doc(collectionRef, id);
  const online = () => { if (globalThis.navigator?.onLine === false) throw new Error('Hubungkan internet sebelum mengubah data.'); };

  function subscribe(scope, receive, fail) {
    const filters = [sdk.where('operation', '==', scope.operation), sdk.where('entity', '==', scope.entity)];
    if (scope.ownerUid) filters.push(sdk.where('createdByUid', '==', scope.ownerUid));
    const view = scope.view || (scope.trash ? 'trash' : scope.archived ? 'archive' : 'pending');
    if (view === 'trash') {
      filters.push(sdk.where('status', '==', 'deleted'));
    } else if (view === 'archive') {
      filters.push(sdk.where('archived', '==', true), sdk.where('status', '==', 'done'));
    } else if (view === 'done') {
      filters.push(sdk.where('archived', '==', false), sdk.where('status', '==', 'done'));
    } else {
      // Antrean sengaja tidak diberi range tanggal: semua pengajuan yang belum selesai harus terlihat.
      filters.push(sdk.where('archived', '==', false), sdk.where('status', '==', 'pending'));
    }
    const periodFiltered = view === 'done' || view === 'archive';
    if (periodFiltered && scope.from) filters.push(sdk.where('requestDate', '>=', scope.from));
    if (periodFiltered && scope.to) filters.push(sdk.where('requestDate', '<=', scope.to));
    filters.push(sdk.orderBy('requestDate', 'desc'), sdk.orderBy('createdAt', 'desc'));
    const bounded = view === 'archive' || view === 'trash';
    if (bounded) filters.push(sdk.limit(scope.archiveLimit || 100));
    return sdk.onSnapshot(sdk.query(collectionRef, ...filters), snapshot => {
      receive(snapshot.docs.map(item => ({ ...item.data(), id: item.id })), {
        cached: snapshot.metadata.fromCache,
        pendingWrites: snapshot.metadata.hasPendingWrites,
        mayHaveMore: Boolean(bounded && snapshot.size >= (scope.archiveLimit || 100))
      });
    }, fail);
  }

  async function getOpenCounts(ownerUid = '') {
    const result = {
      reverse: { total: 0, AIO: 0, ODI: 0 },
      cancel: { total: 0, AIO: 0, ODI: 0 }
    };
    const jobs = [];
    for (const operation of ['reverse', 'cancel']) {
      for (const entity of ['AIO', 'ODI']) {
        const filters = [
          sdk.where('operation', '==', operation),
          sdk.where('entity', '==', entity),
          sdk.where('archived', '==', false),
          sdk.where('status', '==', 'pending')
        ];
        if (ownerUid) filters.push(sdk.where('createdByUid', '==', ownerUid));
        // Order sengaja sama dengan index daftar utama agar tidak butuh index counter tambahan.
        filters.push(sdk.orderBy('requestDate', 'desc'), sdk.orderBy('createdAt', 'desc'));
        jobs.push(sdk.getCountFromServer(sdk.query(collectionRef, ...filters)).then(snapshot => {
          result[operation][entity] = snapshot.data().count;
        }));
      }
    }
    await Promise.all(jobs);
    for (const operation of ['reverse', 'cancel']) result[operation].total = result[operation].AIO + result[operation].ODI;
    return result;
  }

  async function addRequests(input) {
    online();
    const draft = validateBatch({ ...input, requester: actor.displayName });
    const ids = draft.records.map(row => recordId(row));

    // Cek duplicate via documentId query dalam chunk. Dokumen yang tidak ada tidak
    // perlu dibaca satu per satu seperti transaction.get versi lama.
    const existing = [];
    for (let index = 0; index < ids.length; index += 30) {
      const chunk = ids.slice(index, index + 30);
      const q = sdk.query(collectionRef, sdk.where(sdk.documentId(), 'in', chunk));
      const snapshot = sdk.getDocsFromServer ? await sdk.getDocsFromServer(q) : await sdk.getDocs(q);
      snapshot.forEach(item => existing.push(item.data().documentNumber || item.id));
    }
    if (existing.length) throw new Error(`Sudah tercatat: ${existing.slice(0, 5).join(', ')}. Cek Antrean, Selesai, Arsip, atau Sampah. Belum ada nomor baru yang disimpan.`);

    const batch = sdk.writeBatch(db);
    const now = sdk.serverTimestamp();
    draft.records.forEach(row => batch.set(refFor(recordId(row)), createRecord(row, row.documentNumber, actor, now)));
    try {
      await batch.commit();
    } catch (error) {
      if (String(error?.code || '').includes('permission-denied')) {
        throw new Error('Simpan ditolak server. Salah satu dokumen mungkin baru saja tercatat oleh user lain, atau akses akun berubah. Muat ulang lalu coba lagi.');
      }
      throw error;
    }
    return { added: ids.length, duplicates: draft.duplicates.length };
  }

  async function mutate(ids, action, scope, knownRows = []) {
    online(); assertBulk(ids, actor, action);
    const rowMap = new Map(knownRows.map(row => [row.id, row]));
    const now = sdk.serverTimestamp();
    const batch = sdk.writeBatch(db);
    let changed = 0, skipped = 0;
    const deleteDebug = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row || !matchesScope(row, scope)) { skipped++; continue; }
      if (action === 'delete') deleteDebug.push({ ownerUid: row.createdByUid || '', status: row.status || '', archived: row.archived === true });
      const patch = transitionPatch(row, action, actor, now);
      if (!patch) { skipped++; continue; }
      batch.update(refFor(id), patch); changed++;
    }
    if (!changed) return { changed, skipped };
    try {
      await batch.commit();
      return { changed, skipped };
    } catch (error) {
      const code = String(error?.code || '');
      if (action === 'delete' && code.includes('permission-denied')) {
        const first = deleteDebug[0] || {};
        throw new Error(`Server masih menolak Hapus. Akun terbaca: ${actor.displayName} · role=${actor.role} · uid=${actor.uid}. Request terbaca: owner=${first.ownerUid || '—'} · status=${first.status || '—'} · archived=${String(first.archived ?? '—')}. Rules yang dibutuhkan: v3.0.4+.`);
      }
      if (code.includes('permission-denied') || code.includes('failed-precondition')) {
        throw new Error('Data di server berubah atau tindakan tidak lagi diizinkan. Daftar akan menyinkron otomatis; coba lagi setelah status terbaru muncul.');
      }
      throw error;
    }
  }

  async function editRequest(id, input) {
    online();
    // Edit tetap transaction karena perlu perlindungan konflik dan kemungkinan ganti document ID.
    return sdk.runTransaction(db, async transaction => {
      const source = await transaction.get(refFor(id));
      if (!source.exists()) throw new Error('Dokumen sudah tidak tersedia.');
      const current = source.data();
      if (input.expectedUpdatedAt !== undefined && timestampMillis(current.updatedAt) !== input.expectedUpdatedAt) throw new Error('Data sudah berubah sejak editor dibuka. Tutup lalu buka lagi agar perubahan terbaru terbaca.');
      const now = sdk.serverTimestamp();
      const corrected = editRecord(current, input, actor, now);
      const nextId = recordId(corrected);
      if (nextId === id) transaction.update(refFor(id), corrected);
      else {
        const target = await transaction.get(refFor(nextId));
        if (target.exists()) throw new Error('Nomor, entitas, jenis, dan tahun tersebut sudah tercatat. Cek juga Arsip dan Sampah.');
        transaction.update(refFor(id), { ...transitionPatch(current, 'delete', actor, now), deleteKind: 'edit', replacementId: nextId });
        transaction.set(refFor(nextId), { ...corrected, editSourceId: id });
      }
      return { id: nextId, operation: corrected.operation, entity: corrected.entity, requestDate: corrected.requestDate };
    });
  }

  return { subscribe, getOpenCounts, addRequests, mutate, editRequest };
}
