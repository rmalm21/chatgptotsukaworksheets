import { APP_CONFIG } from './firebase-config.js';
import { ACTIONS, MAX_BULK, PAGE_SIZE, TRAIL_LABELS, TYPES, copyText, datePreset, formatDate, formatTimestamp, friendlyError, initials, matchesSearch, monthRange, shiftMonth, parseRequestPaste, parseSearch, rowView, sortRows, statusLabel, todayJakarta, traceOf, validDate, validateBatch, visibleRows, yearSummary, canEdit, canDelete, canRestoreTrash, timestampMillis } from './domain.js';
import { hydrateIcons, icon } from './icons.js';
import { mountControls, shouldSubmitPaste } from './controls.js';
const controls = mountControls();

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const today = todayJakarta();
const currentYear = today.slice(0, 4);
const currentMonth = today.slice(0, 7);
const initialMonthRange = monthRange(currentMonth);
const emptyCounts = () => ({ reverse: { total: 0, AIO: 0, ODI: 0 }, cancel: { total: 0, AIO: 0, ODI: 0 } });
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem('posting-desk-ui-v1') || '{}'); } catch { /* Preferensi lokal bersifat opsional. */ }
const state = {
  operation: ['reverse', 'cancel'].includes(params.get('room')) ? params.get('room') : ['reverse', 'cancel'].includes(prefs.operation) ? prefs.operation : 'reverse',
  entity: ['AIO', 'ODI'].includes(params.get('entity')) ? params.get('entity') : ['AIO', 'ODI'].includes(prefs.entity) ? prefs.entity : 'AIO',
  audience: prefs.audience === 'mine' ? 'mine' : 'team', counts: emptyCounts(), countsLoading: true, countsError: false,
  view: 'pending', density: prefs.density === 'compact' ? 'compact' : 'comfortable', monthIndex: currentMonth, preset: 'indexed', from: initialMonthRange.from, to: initialMonthRange.to, rows: [], selected: new Set(), page: 1,
  actor: null, repository: null, busy: false, loading: false, error: '', isDemo: false, dateInvalid: false,
  metadata: { cached: true, pendingWrites: false, mayHaveMore: false }, archiveLimit: 100, searchTerms: []
};
let authClient = null;
let demoClient = null;
let stopRows = null;
let countGeneration = 0;
let lastCountRefreshAt = 0;
let loginBusy = false;
let authConnecting = false;
let editOriginal = null;
let rowGeneration = 0;
let authGeneration = 0;
let toastTimer;
let confirmation = null;
let detailRecord = null;
let formattedDuplicates = 0;
let pasteDefaults = {};
let searchGeneration = 0;
let searchRows = [];

const monthLabel = monthKey => {
  const value = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey}-01T00:00:00Z`));
  return value.charAt(0).toUpperCase() + value.slice(1);
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const periodFilteredView = () => ['done', 'archive'].includes(state.view);
const getScope = () => ({ operation: state.operation, entity: state.entity, view: state.view, archived: state.view === 'archive', trash: state.view === 'trash', ownerUid: state.audience === 'mine' ? state.actor?.uid : '', from: periodFilteredView() ? state.from : '', to: periodFilteredView() ? state.to : '', archiveLimit: state.archiveLimit });
// Filter nomor bekerja di data yang sudah dimuat: tidak ada read Firestore tambahan.
const getVisible = () => visibleRows(state.rows, state.view).filter(row => matchesSearch(row, state.searchTerms));
const ready = () => !state.loading && !state.error && !state.busy && !state.dateInvalid && (state.isDemo || (navigator.onLine && !state.metadata.cached));
const isPoster = () => state.actor?.role === 'poster';

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('is-error', error === true);
  $('toast').classList.toggle('is-warning', error === 'warning');
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 5000);
}

function savePrefs() {
  try { localStorage.setItem('posting-desk-ui-v1', JSON.stringify({ operation: state.operation, entity: state.entity, audience: state.audience, density: state.density })); } catch { /* Tampilan tetap bekerja tanpa penyimpanan preferensi. */ }
}

function gateMessage(message, error = false) {
  $('gate-message').textContent = message;
  $('gate-message').classList.toggle('notice-error', error);
  $('gate-message').hidden = !message;
}

function syncLabel() {
  const node = $('sync-state');
  node.className = 'sync-label';
  if (state.isDemo) { node.textContent = 'Demo'; node.classList.add('is-demo'); return; }
  if (!navigator.onLine) { node.textContent = 'Offline'; node.classList.add('is-offline'); return; }
  if (state.loading || state.metadata.cached || state.error) { node.textContent = 'Menyambungkan'; node.classList.add('is-loading'); return; }
  node.textContent = state.metadata.pendingWrites || state.busy ? 'Menyimpan' : 'Tersambung';
}

function rowMarkup(row) {
  const selected = state.selected.has(row.id);
  let status;
  if (row.status === 'deleted') status = `<span class="status-badge is-deleted">${icon('trash')}Sampah</span><span class="completion-meta">${row.deleteKind === 'edit' ? 'Diganti saat edit' : escape(row.deletedByName)}</span>`;
  else if (row.archived) status = `<span class="status-badge is-archive">${icon('archive')}Arsip</span><span class="completion-meta">${escape(row.archivedByName)}</span>`;
  else if (row.status === 'done') status = `<span class="status-badge">${icon('check')}Selesai</span><span class="completion-meta">${escape(row.completedByName)}</span>${isPoster() ? `<button type="button" class="row-inline-action" data-archive="${escape(row.id)}" aria-label="Arsipkan dokumen ${escape(row.documentNumber)}" ${ready() ? '' : 'disabled'}>${icon('archive')}<span>Arsip</span></button>` : ''}`;
  else if (isPoster()) status = `<button type="button" class="row-check" data-complete="${escape(row.id)}" aria-label="Tandai ${escape(row.documentNumber)} selesai" ${ready() ? '' : 'disabled'}>${icon('circleCheck')}Selesaikan</button>`;
  else status = '<span class="status-badge is-pending">Menunggu</span>';
  return `<tr class="${selected ? 'is-selected' : ''} ${row.fiscalYear !== currentYear ? 'has-other-year' : ''}">
    <td class="row-select"><label><input type="checkbox" data-select="${escape(row.id)}" aria-label="Pilih dokumen ${escape(row.documentNumber)}" ${selected ? 'checked' : ''} ${state.loading || state.busy ? 'disabled' : ''}></label></td>
    <td class="row-doc"><button type="button" class="document-button" data-doc-drag="${escape(row.id)}" aria-label="Detail dokumen ${escape(row.documentNumber)}">${escape(row.documentNumber)}</button>${row.note ? `<span class="doc-note" title="Ada catatan">${icon('info')}</span>` : ''}</td>
    <td class="row-entity"><span class="entity-tag">${escape(row.entity)}</span></td>
    <td class="row-year">${row.fiscalYear !== currentYear ? `<span class="year-tag is-other-year" title="Bukan tahun berjalan (${currentYear})">${escape(row.fiscalYear)}<span class="sr-only"> · tahun lain</span></span>` : `<span class="year-tag">${escape(row.fiscalYear)}</span>`}</td>
    <td class="row-requester"><span class="requester-label"><span class="avatar" aria-hidden="true">${escape(initials(row.requester))}</span><span>${escape(row.requester)}</span></span></td>
    <td class="row-date"><span class="date-label">${escape(formatDate(row.requestDate, true))}</span>${row.editedAt ? `<span class="edit-meta" title="${escape(row.editedByName)} · ${escape(formatTimestamp(row.editedAt))}">Diedit ${escape(formatTimestamp(row.editedAt))}</span>` : ''}</td>
    <td class="row-status">${status}</td><td class="row-actions"><button type="button" class="button-icon" data-detail="${escape(row.id)}" aria-label="Tindakan dokumen ${escape(row.documentNumber)}">${icon('more')}</button></td>
  </tr>`;
}

function render() {
  if (!state.actor) return;
  const rows = getVisible();
  const allowed = new Set(rows.map(row => row.id));
  state.selected.forEach(id => { if (!allowed.has(id)) state.selected.delete(id); });
  const count = rows.length;
  $('request-board').classList.toggle('is-compact', state.density === 'compact');
  document.querySelectorAll('[data-density]').forEach(button => {
    const active = button.dataset.density === state.density;
    button.setAttribute('aria-pressed', String(active)); button.classList.toggle('is-active', active);
  });
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  state.page = Math.max(1, Math.min(state.page, pages));
  const start = (state.page - 1) * PAGE_SIZE;
  $('page-title').textContent = TYPES[state.operation];
  $('room-eyebrow').textContent = state.operation === 'reverse' ? 'REVERSE' : 'CANCEL PARK';
  document.title = `${TYPES[state.operation]} · Posting Desk`;
  $('workspace-name').textContent = state.audience === 'mine' ? `Ruang ${state.actor.displayName}` : 'Antrean tim posting';
  $('audience-caption').textContent = state.audience === 'mine' ? `Request yang kamu submit · ${state.actor.displayName}` : 'Semua request tim posting';
  document.querySelectorAll('[data-audience]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audience === state.audience)));
  renderCounts();
  $('month-index-label').textContent = monthLabel(state.monthIndex);
  $('month-current').classList.toggle('is-active', state.preset === 'indexed' && state.monthIndex === currentMonth);
  const periodActive = periodFilteredView();
  $('period-filter').hidden = !periodActive;
  $('scope-caption').textContent = state.view === 'pending' ? `${state.entity} · semua pengajuan belum selesai` : state.view === 'trash' ? `${state.entity} · semua data Sampah` : state.preset === 'indexed' ? `${state.entity} · ${monthLabel(state.monthIndex)}` : `${state.entity} · filter tanggal`;
  $('pending-count').textContent = state.loading ? '—' : state.rows.filter(row => !row.archived && row.status === 'pending').length;
  $('done-count').textContent = state.loading ? '—' : state.rows.filter(row => !row.archived && row.status === 'done').length;
  // Query tiap tab hanya membaca status yang sedang dibuka agar hemat Firestore read.
  // Karena itu badge tab nonaktif disembunyikan daripada menampilkan angka 0 yang menyesatkan.
  $('pending-count').hidden = state.view !== 'pending';
  $('done-count').hidden = state.view !== 'done';
  document.querySelectorAll('[data-room]').forEach(button => {
    const active = button.dataset.room === state.operation;
    button.setAttribute('aria-selected', String(active)); button.setAttribute('tabindex', active ? '0' : '-1'); button.classList.toggle('is-active', active);
  });
  $('request-workspace').setAttribute('aria-labelledby', `tab-${state.operation}`);
  document.querySelectorAll('[data-entity]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entity === state.entity)));
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.setAttribute('aria-pressed', String(active)); button.classList.toggle('is-active', active);
  });
  $('list-title').textContent = { pending: 'Dokumen siap diproses', done: 'Dokumen sudah diproses', archive: 'Riwayat yang diarsipkan', trash: 'Request di Sampah' }[state.view];
  const years = yearSummary(rows, currentYear);
  $('year-awareness').hidden = !years.nonCurrent || state.loading;
  $('year-awareness-text').textContent = `${years.nonCurrent} dokumen dari tahun ${years.otherYears.join(', ')} · tahun berjalan ${currentYear}.`;
  $('request-rows').innerHTML = rows.slice(start, start + PAGE_SIZE).map(rowMarkup).join('');
  const searching = state.searchTerms.length > 0;
  $('empty-state').hidden = count > 0;
  $('empty-title').textContent = state.error ? 'Daftar belum tersedia' : state.loading ? 'Memuat dokumen' : searching ? 'Nomor tidak ada di daftar ini' : { pending: 'Antrean bersih', done: 'Belum ada dokumen selesai', archive: 'Arsip masih kosong', trash: 'Sampah masih kosong' }[state.view];
  $('empty-description').textContent = state.error ? state.error : state.loading ? 'Mengambil daftar dari workspace tim.' : searching ? 'Tekan Enter di kotak cari untuk melacak nomor di semua jenis, entitas, tahun, dan status, termasuk Arsip dan Sampah.' : periodActive && state.preset !== 'all' ? 'Tidak ada dokumen pada periode ini.' : { pending: 'Semua pengajuan yang belum selesai akan tampil di Antrean tanpa dibatasi periode.', done: 'Dokumen yang ditandai selesai akan muncul di sini.', archive: 'Arsipkan dokumen dari daftar Selesai untuk merapikan riwayat.', trash: 'Request yang dihapus dapat dipulihkan dari sini.' }[state.view];
  $('empty-add').hidden = state.view !== 'pending' || state.loading || Boolean(state.error) || searching;
  $('table-range').textContent = count ? `${start + 1}–${Math.min(start + PAGE_SIZE, count)} dari ${count} dokumen` : '0 dokumen';
  $('page-label').textContent = `${state.page} / ${pages}`;
  $('pagination').hidden = pages <= 1;
  $('page-prev').disabled = state.page <= 1;
  $('page-next').disabled = state.page >= pages;
  $('load-archive').hidden = !['archive','trash'].includes(state.view) || !state.metadata.mayHaveMore;
  $('load-archive').textContent = state.view === 'trash' ? 'Muat Sampah lebih lama' : 'Muat arsip lebih lama';
  $('load-archive').disabled = state.loading;
  $('data-error').textContent = state.error;
  $('data-error').hidden = !state.error;
  $('context-hint').textContent = state.view === 'trash' ? 'Sampah menampilkan semua request yang dihapus dan dapat dipulihkan sesuai hak akses.' : state.view === 'archive' ? `Arsip difilter berdasarkan periode request. ${state.preset === 'indexed' ? `Periode aktif: ${monthLabel(state.monthIndex)}.` : ''}` : state.view === 'done' ? `Selesai difilter berdasarkan periode request. ${state.preset === 'indexed' ? `Periode aktif: ${monthLabel(state.monthIndex)}.` : ''}` : 'Antrean selalu menampilkan semua pengajuan yang belum selesai. Filter periode hanya berlaku di Selesai dan Arsip.';
  syncLabel();
  for (const id of ['date-preset', 'date-from', 'date-to', 'month-prev', 'month-next', 'month-current']) $(id).disabled = state.busy || !periodActive;
  $('search-number').disabled = state.busy; $('search-all').disabled = state.busy;
  renderSelection(rows);
  controls.sync();
}

// Bagian yang berubah saat checkbox dipilih. Dipisah agar centang satu baris tidak
// membangun ulang seluruh tabel.
function renderSelection(rows = getVisible()) {
  const count = rows.length;
  const selected = state.selected.size;
  const periodActive = periodFilteredView();
  $('request-board').classList.toggle('has-selection', selected > 0);
  $('selection-bar').classList.toggle('has-selection', selected > 0);
  const periodSummary = periodActive ? (state.preset === 'indexed' ? ` · ${monthLabel(state.monthIndex)}` : state.preset === 'all' ? ' · semua tanggal request' : ' · periode terpilih') : '';
  const searchSummary = state.searchTerms.length ? ` · cocok “${state.searchTerms.slice(0, 3).join(', ')}${state.searchTerms.length > 3 ? '…' : ''}” dari ${visibleRows(state.rows, state.view).length}` : '';
  $('list-summary').textContent = state.loading ? 'Memuat dokumen…' : `${count} dokumen${searchSummary}${selected ? ` · ${selected} dipilih` : ''}${periodSummary}`;
  $('select-all').checked = count > 0 && selected === count;
  $('select-all').indeterminate = selected > 0 && selected < count;
  $('select-all').disabled = !count || state.loading || state.busy;
  $('selection-label').textContent = selected ? `${selected} dokumen dipilih` : count > MAX_BULK ? `Pilih ${MAX_BULK} hasil pertama` : 'Pilih semua hasil filter';
  $('clear-selection').hidden = !selected;
  $('bulk-done').hidden = !isPoster() || state.view !== 'pending';
  $('bulk-done').disabled = !selected || !ready();
  $('bulk-archive').hidden = !isPoster() || state.view !== 'done';
  $('bulk-archive').disabled = !selected || !ready();
  $('bulk-reopen').hidden = !isPoster() || state.view !== 'done';
  $('bulk-reopen').disabled = !selected || !ready();
  $('bulk-restore').hidden = !isPoster() || state.view !== 'archive';
  $('bulk-restore').disabled = !selected || !ready();
  $('bulk-undelete').hidden = state.view !== 'trash';
  $('bulk-undelete').disabled = !selected || !ready() || rows.filter(row => state.selected.has(row.id)).some(row => !canRestoreTrash(row, state.actor));
  const selectedRows = rows.filter(row => state.selected.has(row.id));
  $('bulk-delete').hidden = state.view === 'trash' || !selected;
  $('bulk-delete').disabled = !selected || !ready() || selectedRows.some(row => !canDelete(row, state.actor));
  $('bulk-delete').title = selected && selectedRows.some(row => !canDelete(row, state.actor)) ? 'Requester hanya dapat menghapus request Pending miliknya sendiri.' : '';
  $('copy-filter').hidden = state.view !== 'pending';
  $('copy-filter').disabled = !count || !ready();
  $('copy-filter-label').textContent = selected ? `Copy ${selected} nomor` : `Copy hasil filter (${count})`;
  $('new-request').disabled = state.busy; $('logout-button').disabled = state.busy;
}

function renderCounts() {
  if (!state.actor) return;
  const counts = state.counts;
  for (const [id, value] of [['reverse-open-count',counts.reverse.total],['cancel-open-count',counts.cancel.total],['aio-open-count',counts[state.operation].AIO],['odi-open-count',counts[state.operation].ODI]]) {
    $(id).textContent = state.countsLoading || state.countsError ? '—' : value;
    $(id).title = state.countsError ? 'Jumlah belum bisa dibaca. Coba sambungkan lagi.' : 'Jumlah open dihitung via agregasi ringan, bukan membaca seluruh dokumen.';
  }
}

async function refreshCounts() {
  if (!state.repository) return;
  const generation = ++countGeneration;
  state.countsLoading = true; state.countsError = false; renderCounts();
  try {
    const counts = await state.repository.getOpenCounts(state.audience === 'mine' ? state.actor.uid : '');
    if (generation !== countGeneration) return;
    state.counts = counts; state.countsLoading = false; state.countsError = false; lastCountRefreshAt = Date.now(); renderCounts();
  } catch {
    if (generation !== countGeneration) return;
    state.countsLoading = false; state.countsError = true; renderCounts();
  }
}

function refreshRows(clearSelection = true) {
  if (!state.repository) return;
  if (stopRows) stopRows();
  const generation = ++rowGeneration;
  state.loading = true; state.error = ''; state.rows = []; state.metadata = { cached: true, pendingWrites: false, mayHaveMore: false };
  if (clearSelection) state.selected.clear();
  state.page = 1; render();
  stopRows = state.repository.subscribe(getScope(), (rows, metadata) => {
    if (generation !== rowGeneration) return;
    state.rows = sortRows(rows); state.metadata = metadata; state.loading = false; state.error = '';
    render();
  }, error => {
    if (generation !== rowGeneration) return;
    state.loading = false; state.error = friendlyError(error); render();
  });
}

function switchScope(changes) {
  if (state.busy) return;
  const audienceChanged = changes.audience !== undefined && changes.audience !== state.audience;
  Object.assign(state, changes);
  state.archiveLimit = 100; state.selected.clear(); state.page = 1;
  const parsed = readPaste();
  if (!parsed.detected.operation) $('form-operation').value = state.operation;
  else if (changes.operation !== undefined) pasteDefaults.operation = state.operation;
  if (!parsed.detected.entity) $('form-entity').value = state.entity;
  else if (changes.entity !== undefined) pasteDefaults.entity = state.entity;
  updatePastePreview();
  savePrefs(); refreshRows(); if (audienceChanged || Date.now() - lastCountRefreshAt > 60000) refreshCounts();
}

function setDateFilters() {
  const preset = $('date-preset').value;
  $('custom-range').hidden = preset !== 'custom';
  $('reset-date').hidden = preset === 'indexed';
  let range;
  if (preset === 'indexed') range = monthRange(state.monthIndex);
  else if (preset === 'custom') {
    if (!$('date-from').value) $('date-from').value = todayJakarta();
    if (!$('date-to').value) $('date-to').value = todayJakarta();
    range = { from: $('date-from').value, to: $('date-to').value };
    if (!validDate(range.from) || !validDate(range.to) || range.from > range.to) {
      $('filter-error').textContent = 'Tanggal awal harus sama atau sebelum tanggal akhir.';
      $('filter-error').hidden = false;
      state.dateInvalid = true;
      render();
      return;
    }
  } else range = datePreset(preset);
  $('filter-error').hidden = true;
  state.dateInvalid = false;
  state.preset = preset;
  switchScope({ from: range.from, to: range.to });
}

function activateMonth(monthKey) {
  if (state.busy) return;
  state.monthIndex = monthKey;
  state.preset = 'indexed';
  const range = monthRange(monthKey);
  $('date-preset').value = 'indexed';
  $('custom-range').hidden = true;
  $('reset-date').hidden = true;
  controls.sync();
  switchScope({ from: range.from, to: range.to });
}

function setWriteBusy(value) {
  state.busy = value;
  document.querySelectorAll('dialog [data-close]').forEach(button => { button.disabled = value; });
  $('save-request').disabled = value;
  $('composer-fields').disabled = value;
  $('confirm-action').disabled = value;
  $('edit-fields').disabled = value; $('save-edit').disabled = value;
  controls.close();
  render(); updatePastePreview();
}

function closeDialog(id) {
  if (state.busy) return;
  $(id).close();
}

function openRequest() {
  if (!state.actor || state.busy) return;
  $('request-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('form-documents').focus();
}

function resetComposer() {
  pasteDefaults = {};
  $('request-form').reset();
  $('form-documents').value = ''; $('form-note').value = '';
  $('form-operation').value = state.operation; $('form-entity').value = state.entity;
  $('form-year').value = currentYear; $('form-date').value = todayJakarta();
  $('form-error').hidden = true; formattedDuplicates = 0;
  updatePastePreview();
}

function readPaste() {
  return parseRequestPaste($('form-documents').value, {
    operation: pasteDefaults.operation || $('form-operation').value || state.operation,
    entity: pasteDefaults.entity || $('form-entity').value || state.entity,
    fiscalYear: pasteDefaults.fiscalYear || $('form-year').value || currentYear
  });
}

function readDraft() {
  const parsed = readPaste();
  if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
  return {
    operation: parsed.operation, entity: parsed.entity, fiscalYear: parsed.fiscalYear,
    requester: state.actor.displayName, requestDate: $('form-date').value,
    entries: parsed.entries, note: $('form-note').value
  };
}

function updatePastePreview() {
  const parsed = readPaste(), count = parsed.entries.length;
  const duplicates = Math.max(parsed.duplicates.length, formattedDuplicates);
  $('paste-routing').classList.toggle('has-error', parsed.errors.length > 0);
  $('paste-preview').classList.toggle('has-error', parsed.errors.length > 0);
  $('paste-destination').textContent = !count ? 'Belum ada nomor' : parsed.errors.length ? 'Periksa input dulu' : `${TYPES[parsed.operation]} · ${parsed.entities.join(' + ')} · ${parsed.years.join(' / ')}`;
  $('paste-preview').textContent = !count && !parsed.errors.length ? 'Tujuan akan terlihat di sini setelah nomor dimasukkan.' : `${count} dokumen siap${duplicates ? ` · ${duplicates} nomor berulang disisihkan` : ''}${parsed.mixedEntities ? ' · entitas campuran dicatat per dokumen' : ''}${parsed.errors.length ? ` · ${parsed.errors.join(' ')}` : ''}`;
  for (const [field, id] of [['operation','form-operation'], ['entity','form-entity'], ['fiscalYear','form-year']]) {
    if (parsed.detected[field]) {
      if (!Object.hasOwn(pasteDefaults, field)) pasteDefaults[field] = $(id).value;
      $(id).value = parsed[field];
    } else if (Object.hasOwn(pasteDefaults, field)) { $(id).value = pasteDefaults[field]; delete pasteDefaults[field]; }
    $(id).disabled = parsed.detected[field] || state.busy;
    $(id).title = parsed.detected[field] ? 'Terbaca dari teks. Ubah label pada teks untuk menggantinya.' : '';
  }
  $('detected-fields').textContent = 'Pilihan ini dipakai untuk bagian yang belum diberi label. Untuk input campuran, beri AIO/ODI pada tiap baris atau sebagai judul blok.';
  $('paste-entries').hidden = !count;
  $('paste-entries').innerHTML = parsed.entries.slice(0,8).map(entry => `<div class="paste-entry"><strong>${escape(entry.documentNumber)}</strong><span class="entity-tag">${escape(entry.entity)}</span><span class="year-tag ${entry.fiscalYear !== currentYear ? 'is-other-year' : ''}">${escape(entry.fiscalYear)}</span></div>`).join('') + (count > 8 ? `<span class="paste-more">+${count - 8} dokumen lainnya</span>` : '');
  const otherYears = parsed.years.filter(year => year !== currentYear);
  $('paste-year-hint').hidden = !count || !otherYears.length;
  $('paste-year-hint').textContent = `Ada tahun ${otherYears.join(', ')} · tahun berjalan ${currentYear}.`;
  $('save-request').disabled = state.busy || !state.actor || !count || parsed.errors.length > 0;
  $('save-request').textContent = state.busy ? 'Menyimpan…' : count ? `Kirim ${count} dokumen` : 'Kirim request';
  controls.sync();
}

function normalizePaste(showError = false) {
  const parsed = readPaste();
  if (parsed.errors.length || !parsed.documents.length) {
    updatePastePreview();
    if (showError) { $('form-error').textContent = parsed.errors.join(' ') || 'Masukkan nomor dokumen terlebih dahulu.'; $('form-error').hidden = false; }
    return;
  }
  formattedDuplicates = Math.max(formattedDuplicates, parsed.duplicates.length);
  $('form-documents').value = parsed.normalized;
  $('form-error').hidden = true;
  updatePastePreview();
}

async function saveRequest(event) {
  event.preventDefault();
  if (state.busy || !state.actor) return;
  $('form-error').hidden = true;
  try {
    const input = readDraft();
    const draft = validateBatch(input);
    setWriteBusy(true);
    const before = { operation: state.operation, entity: state.entity, view: state.view };
    const result = await state.repository.addRequests(input);
    const targetMonth = draft.requestDate.slice(0, 7);
    const range = monthRange(targetMonth);
    state.operation = draft.operation; state.entity = draft.records[0].entity; state.view = 'pending';
    state.monthIndex = targetMonth; state.preset = 'indexed'; state.from = range.from; state.to = range.to;
    $('date-preset').value = 'indexed'; $('custom-range').hidden = true; $('reset-date').hidden = true;
    const queryChanged = before.operation !== state.operation || before.entity !== state.entity || before.view !== 'pending';
    resetComposer(); savePrefs();
    if (queryChanged) refreshRows(); else render();
    refreshCounts();
    const related = (result.related || []).filter(row => !draft.records.some(record => record.documentNumber === row.documentNumber && record.operation === row.operation && record.entity === row.entity && record.fiscalYear === row.fiscalYear));
    const relatedNote = related.length ? ` · Perhatian: ${new Set(related.map(row => row.documentNumber)).size} nomor juga tercatat di jenis/entitas/tahun lain (${related.slice(0, 2).map(row => `${row.documentNumber} ${TYPES[row.operation]} ${row.entity} ${row.fiscalYear}`).join('; ')}${related.length > 2 ? '; …' : ''}). Lacak lewat kotak cari.` : '';
    toast(`${result.added} dokumen ditambahkan ke ${TYPES[draft.operation]} · ${[...new Set(draft.records.map(row => row.entity))].join(' + ')}.${relatedNote}`, relatedNote ? 'warning' : false);
  } catch (error) {
    $('form-error').textContent = friendlyError(error); $('form-error').hidden = false;
  } finally { setWriteBusy(false); updatePastePreview(); }
}

function openConfirmation(action, ids = [...state.selected]) {
  if (!ready() || !ids.length || (!['delete','undelete'].includes(action) && !isPoster())) return;
  if (ids.length > MAX_BULK) { toast(`Maksimal ${MAX_BULK} dokumen per tindakan.`, true); return; }
  const chosen = getVisible().filter(row => ids.includes(row.id));
  if (!chosen.length) return;
  if (action === 'delete' && chosen.some(row => !canDelete(row, state.actor))) { toast('Hanya request open milik sendiri atau pemosting yang dapat menghapus.', true); return; }
  if (action === 'undelete' && chosen.some(row => !canRestoreTrash(row, state.actor))) { toast('Ada request yang belum boleh dipulihkan oleh akun ini.', true); return; }
  confirmation = { action, ids: chosen.map(row => row.id), rows: chosen.map(row => ({ ...row })), scope: { ...getScope() } };
  const labels = {
    delete: ['HAPUS REQUEST', `Hapus ${chosen.length} dokumen?`, 'Dokumen masuk ke Sampah dan dapat dipulihkan jika salah hapus.', `Hapus ${chosen.length} dokumen`],
    undelete: ['PULIHKAN SAMPAH', `Pulihkan ${chosen.length} dokumen?`, 'Dokumen kembali ke status dan ruangnya sebelum dihapus. Cek penanda jika dokumen sebelumnya diganti saat edit.', `Pulihkan ${chosen.length} dokumen`],
    done: ['BULK SELESAI', `Tandai ${chosen.length} dokumen selesai?`, 'Lakukan setelah proses dokumen berhasil. Dokumen akan pindah ke daftar Selesai.', `Selesaikan ${chosen.length} dokumen`],
    archive: ['ARSIP DOKUMEN', `Arsipkan ${chosen.length} dokumen?`, 'Dokumen tetap tersimpan di Arsip dan bisa dipulihkan lagi.', `Arsipkan ${chosen.length} dokumen`],
    restore: ['PULIHKAN ARSIP', `Pulihkan ${chosen.length} dokumen?`, 'Dokumen kembali ke daftar Selesai. Status proses tetap selesai.', `Pulihkan ${chosen.length} dokumen`],
    reopen: ['BUKA KEMBALI', `Buka kembali ${chosen.length} dokumen?`, 'Cek selesai akan dibatalkan dan dokumen kembali ke Antrean.', `Buka ${chosen.length} dokumen`]
  }[action];
  if (!labels) return;
  $('confirm-eyebrow').textContent = labels[0]; $('confirm-title').textContent = labels[1];
  $('confirm-description').textContent = labels[2]; $('confirm-action').textContent = labels[3];
  $('confirm-scope').textContent = `${TYPES[state.operation]} · ${state.entity} · tahun ${yearSummary(chosen).years.join(' / ')}`;
  $('confirm-numbers').innerHTML = chosen.slice(0, 8).map(row => `<span>${escape(row.documentNumber)} · ${escape(row.fiscalYear)}</span>`).join('') + (chosen.length > 8 ? `<span>+${chosen.length - 8} lainnya</span>` : '');
  $('confirm-error').hidden = true;
  $('confirm-dialog').showModal();
}

async function confirmAction() {
  if (!confirmation || state.busy) return;
  const request = confirmation;
  $('confirm-error').hidden = true;
  setWriteBusy(true); $('confirm-action').textContent = 'Menyimpan…';
  try {
    const result = await state.repository.mutate(request.ids, request.action, request.scope, request.rows);
    $('confirm-dialog').close();
    state.selected.clear(); confirmation = null; render(); refreshCounts();
    toast(`${result.changed} dokumen berhasil ${ACTIONS[request.action]}${result.skipped ? ` · ${result.skipped} dilewati karena sudah berubah` : ''}.`);
  } catch (error) {
    $('confirm-error').textContent = friendlyError(error); $('confirm-error').hidden = false;
  } finally {
    setWriteBusy(false);
    if (confirmation) $('confirm-action').textContent = 'Coba lagi';
  }
}

async function copyClipboard() {
  const textarea = $('copy-text');
  textarea.focus(); textarea.select();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(textarea.value);
    else if (!document.execCommand('copy')) throw new Error('Clipboard belum tersedia.');
    $('copy-result').textContent = 'Nomor tersalin. Siap ditempel ke kolom dokumen.';
  } catch {
    textarea.focus(); textarea.select();
    $('copy-result').textContent = 'Daftar sudah dipilih. Tekan Ctrl+C / Cmd+C, atau tahan teks untuk menyalin.';
  }
}

function openCopy() {
  if (!ready()) return;
  const rows = getVisible().filter(row => !state.selected.size || state.selected.has(row.id));
  try {
    const text = copyText(rows, getScope());
    if (!text) return;
    const count = text.split('\n').length;
    $('copy-title').textContent = `${count} nomor siap diproses`;
    const years = yearSummary(rows, currentYear);
    $('copy-year-hint').hidden = !years.nonCurrent;
    $('copy-year-hint').textContent = `Termasuk ${years.nonCurrent} dokumen tahun ${years.otherYears.join(', ')}. Perhatikan tahun dokumen saat memproses.`;
    const scope = getScope();
    $('copy-scope').textContent = `${TYPES[state.operation]} · ${state.entity} · tahun ${years.years.join(' / ')}${scope.from ? ` · ${formatDate(scope.from, true)} – ${formatDate(scope.to, true)}` : ' · semua tanggal request'}${state.searchTerms.length ? ' · sesuai filter nomor' : ''}`;
    $('copy-text').value = text; $('copy-result').textContent = '';
    $('copy-dialog').showModal();
    copyClipboard();
  } catch (error) { toast(friendlyError(error), true); }
}

function trailMarkup(row) {
  return traceOf(row).map(entry => `<li class="${entry.legacy ? 'is-legacy' : ''}"><span class="trail-dot" aria-hidden="true"></span><div><strong>${escape(TRAIL_LABELS[entry.action] || entry.action)}</strong><span>${escape(entry.name || '—')} · ${escape(formatTimestamp(entry.at))}${entry.legacy ? ' · data lama' : ''}</span>${entry.info ? `<small>${escape(entry.info)}</small>` : ''}</div></li>`).join('');
}

// Detail bisa dibuka dari daftar (id) atau dari hasil lacak nomor (objek baris).
function openDetail(target) {
  const listed = getVisible().find(item => item.id === (typeof target === 'string' ? target : target?.id));
  const row = listed || (typeof target === 'object' ? target : searchRows.find(item => item.id === target));
  if (!row) return;
  detailRecord = row;
  $('detail-number').textContent = row.documentNumber;
  $('detail-status').innerHTML = row.status === 'deleted' ? `<span class="status-badge is-deleted">${icon('trash')}Di Sampah</span>` : row.archived ? `<span class="status-badge is-archive">${icon('archive')}Diarsipkan</span>` : row.status === 'done' ? `<span class="status-badge">${icon('check')}Selesai</span>` : '<span class="status-badge is-pending">Belum diproses</span>';
  // Siapa/kapan per kejadian ada di Riwayat aktivitas; fakta di sini hanya identitas dokumen.
  const facts = [
    ['Jenis request', TYPES[row.operation]], ['Entitas / tahun', `${row.entity} / ${row.fiscalYear}`],
    ['Requester', row.requester], ['Tanggal request', formatDate(row.requestDate)],
    ['Status', `${statusLabel(row)}${row.status === 'done' || row.archived ? ` · selesai oleh ${row.completedByName || '—'}` : ''}`],
    ...(row.status === 'deleted' ? [['Keterangan', row.deleteKind === 'edit' ? `Diganti saat edit · ${row.replacementId}` : `Dihapus ${row.deletedByName} · sebelumnya ${statusLabel({ ...row, status: row.previousStatus })}`]] : []),
    ...(row.editSourceId ? [['Pengganti dari', row.editSourceId]] : []),
    ['ID dokumen', row.id]
  ];
  $('detail-facts').innerHTML = facts.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('');
  $('detail-note-section').hidden = !row.note; $('detail-note').textContent = row.note;
  $('detail-trail').innerHTML = trailMarkup(row);
  // Tindakan hanya untuk dokumen di daftar aktif agar scope konfirmasi dan data tetap sinkron.
  $('detail-outside').hidden = Boolean(listed); $('detail-jump').hidden = Boolean(listed);
  $('detail-edit').hidden = !listed || !canEdit(row, state.actor); $('detail-edit').disabled = !ready();
  $('detail-delete').hidden = !listed || !canDelete(row, state.actor); $('detail-delete').disabled = !ready();
  $('detail-action').hidden = !listed || (row.status === 'deleted' ? !canRestoreTrash(row, state.actor) : !isPoster()); $('detail-action').disabled = !ready();
  $('detail-action').textContent = row.status === 'deleted' ? 'Pulihkan dari Sampah' : row.archived ? 'Pulihkan arsip' : row.status === 'done' ? 'Arsipkan' : 'Selesaikan';
  $('detail-dialog').showModal();
}

function applySearchFilter() {
  const terms = parseSearch($('search-number').value).terms;
  if (terms.join(' ') === state.searchTerms.join(' ')) return;
  state.searchTerms = terms; state.page = 1; render();
}

function searchResultMarkup(row) {
  const trace = traceOf(row), last = trace[trace.length - 1];
  const statusClass = { trash: 'is-deleted', archive: 'is-archive', pending: 'is-pending', done: '' }[rowView(row)];
  return `<li class="search-result"><div class="search-result-main"><button type="button" class="document-button" data-search-detail="${escape(row.id)}">${escape(row.documentNumber)}</button><span class="status-badge ${statusClass}">${escape(statusLabel(row))}</span></div>
    <div class="search-result-tags"><span>${escape(TYPES[row.operation] || row.operation)}</span><span class="entity-tag">${escape(row.entity)}</span><span class="year-tag ${row.fiscalYear !== currentYear ? 'is-other-year' : ''}">${escape(row.fiscalYear)}</span><span>${escape(row.requester)} · ${escape(formatDate(row.requestDate, true))}</span></div>
    ${last ? `<p class="search-result-last">Terakhir: <strong>${escape(TRAIL_LABELS[last.action] || last.action)}</strong> · ${escape(last.name || '—')} · ${escape(formatTimestamp(last.at))}</p>` : ''}
    <div class="search-result-actions"><button type="button" class="button button-link compact" data-search-detail="${escape(row.id)}"><span>${icon('history')}</span>Riwayat</button><button type="button" class="button button-secondary compact" data-search-jump="${escape(row.id)}">${icon('target')}Buka di daftar</button></div></li>`;
}

// Lacak nomor di seluruh workspace: jenis, entitas, tahun, status, termasuk Arsip & Sampah.
async function openSearch() {
  if (!state.repository || !state.actor) return;
  const text = $('search-number').value;
  const parsed = parseSearch(text);
  $('search-error').hidden = true; $('search-missing').hidden = true;
  if (parsed.error) { toast(parsed.error, true); $('search-number').focus(); return; }
  const generation = ++searchGeneration;
  searchRows = [];
  $('search-title').textContent = parsed.exact.length ? `Lacak ${parsed.exact.length} nomor` : `Nomor berawalan ${parsed.prefix}`;
  $('search-summary').textContent = 'Mencari di semua data…';
  $('search-results').innerHTML = '';
  if (!$('search-dialog').open) $('search-dialog').showModal();
  try {
    const result = await state.repository.findDocuments(text);
    if (generation !== searchGeneration) return;
    searchRows = result.rows;
    const numbers = new Set(result.rows.map(row => row.documentNumber)).size;
    $('search-summary').textContent = result.rows.length
      ? `${result.rows.length} catatan untuk ${numbers} nomor${result.truncated ? ' · hanya 50 pertama, ketik lebih banyak digit' : ''}. Nomor yang sama bisa ada di jenis, entitas, atau tahun berbeda.`
      : 'Tidak ada catatan untuk pencarian ini di jenis, entitas, tahun, maupun status mana pun.';
    $('search-missing').hidden = !result.missing.length;
    $('search-missing').textContent = `Belum pernah tercatat: ${result.missing.slice(0, 12).join(', ')}${result.missing.length > 12 ? ` +${result.missing.length - 12} lainnya` : ''}.`;
    $('search-results').innerHTML = result.rows.map(searchResultMarkup).join('');
  } catch (error) {
    if (generation !== searchGeneration) return;
    $('search-summary').textContent = '';
    $('search-error').textContent = friendlyError(error); $('search-error').hidden = false;
  }
}

function jumpTo(row) {
  if (!row || state.busy) return;
  const month = validDate(row.requestDate) ? row.requestDate.slice(0, 7) : currentMonth, range = monthRange(month);
  state.monthIndex = month; state.preset = 'indexed';
  $('date-preset').value = 'indexed'; $('custom-range').hidden = true; $('reset-date').hidden = true;
  $('search-number').value = row.documentNumber; state.searchTerms = [row.documentNumber];
  for (const id of ['search-dialog', 'detail-dialog']) if ($(id).open) $(id).close();
  switchScope({ operation: row.operation, entity: row.entity, view: rowView(row), audience: 'team', from: range.from, to: range.to });
}

function openEdit(row) {
  if (!ready() || !row || !canEdit(row, state.actor)) return;
  editOriginal = { ...row, expectedUpdatedAt: timestampMillis(row.updatedAt) };
  $('edit-number').value = row.documentNumber; $('edit-operation').value = row.operation;
  $('edit-entity').value = row.entity; $('edit-year').value = row.fiscalYear;
  $('edit-date').value = row.requestDate; $('edit-note').value = row.note;
  $('edit-owner').textContent = `Requester: ${row.requester} · pemilik request tetap sama`;
  $('edit-audit').textContent = row.editedAt ? `Terakhir diedit ${row.editedByName} · ${formatTimestamp(row.editedAt)}` : 'Belum pernah diedit. Waktu dan editor dicatat saat perubahan disimpan.';
  $('edit-error').hidden = true; controls.sync(); $('edit-dialog').showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editOriginal || state.busy) return;
  $('edit-error').hidden = true; setWriteBusy(true);
  try {
    const result = await state.repository.editRequest(editOriginal.id, {
      documentNumber: $('edit-number').value.trim(), operation: $('edit-operation').value,
      entity: $('edit-entity').value, fiscalYear: $('edit-year').value,
      requestDate: $('edit-date').value, note: $('edit-note').value,
      expectedUpdatedAt: editOriginal.expectedUpdatedAt
    });
    $('edit-dialog').close(); editOriginal = null;
    const targetMonth = (result.requestDate || todayJakarta()).slice(0, 7), range = monthRange(targetMonth);
    state.operation = result.operation; state.entity = result.entity; state.view = 'pending';
    state.monthIndex = targetMonth; state.preset = 'indexed'; state.from = range.from; state.to = range.to; $('date-preset').value = 'indexed';
    $('custom-range').hidden = true; $('reset-date').hidden = true;
    savePrefs(); refreshRows(); refreshCounts(); toast('Perubahan disimpan. Waktu edit dan editor sudah dicatat.');
  } catch (error) { $('edit-error').textContent = friendlyError(error); $('edit-error').hidden = false; }
  finally { setWriteBusy(false); }
}

function activateSession(session, demo = false) {
  if (stopRows) stopRows();
  state.actor = session.actor; state.repository = session.repository; state.isDemo = demo;
  $('gate').hidden = true; $('app').hidden = false;
  $('demo-banner').hidden = !demo;
  $('profile-name').textContent = session.actor.displayName;
  $('profile-avatar').textContent = initials(session.actor.displayName);
  $('profile-role').textContent = session.actor.role === 'poster' ? 'Pemosting' : 'Requester';
  $('requester-name').textContent = session.actor.displayName;
  $('requester-avatar').textContent = initials(session.actor.displayName);
  resetComposer(); refreshRows(); refreshCounts();
}

function clearSession() {
  rowGeneration++; countGeneration++;
  if (stopRows) stopRows(); stopRows = null;
  state.actor = null; state.repository = null; state.rows = []; state.selected.clear(); state.searchTerms = []; searchRows = [];
  $('search-number').value = '';
  $('app').hidden = true; $('gate').hidden = false; $('access-denied').hidden = true;
  $('login-form').hidden = !configured();
  $('form-documents').value = ''; $('form-note').value = '';
  controls.close(); editOriginal = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
}

function configured() {
  const values = [APP_CONFIG.firebaseConfig.apiKey, APP_CONFIG.firebaseConfig.projectId, APP_CONFIG.firebaseConfig.authDomain];
  return values.every(value => value && !/ISI_|PROJECT_ID|YOUR_/.test(value));
}

async function startDemo() {
  authGeneration++; authConnecting = false;
  if (authClient) { authClient.destroy(); authClient = null; }
  const { connectDemo } = await import('./demo-store.js');
  demoClient = connectDemo();
  const url = new URL(location.href); url.searchParams.set('demo', '1');
  history.replaceState(null, '', url);
  activateSession(demoClient, true);
}

async function logout() {
  if (state.isDemo) {
    const url = new URL(location.href); url.searchParams.delete('demo'); location.href = url.href; return;
  }
  try { await authClient?.logout(); } catch (error) { toast(friendlyError(error), true); }
}

async function boot() {
  hydrateIcons();
  if (params.get('demo') === '1') { await startDemo(); return; }
  if (!configured()) {
    $('gate-title').textContent = 'Posting Desk siap disambungkan.';
    $('gate-description').textContent = 'Isi konfigurasi Firebase di paket web, lalu deploy. Tampilan dan alurnya bisa dicoba lewat demo.';
    gateMessage('Mulai dari BACA-DULU.html di dalam ZIP untuk setup Firebase.');
    return;
  }
  if (authConnecting) return;
  authConnecting = true;
  if (authClient) { authClient.destroy(); authClient = null; }
  $('login-form').hidden = false; $('login-button').disabled = true; $('reset-password').disabled = true;
  $('retry-connection').hidden = true; $('access-denied').hidden = true;
  gateMessage('Menghubungkan workspace…');
  const generation = ++authGeneration;
  try {
    const { connectFirebase } = await import('./firebase-store.js');
    const connection = await connectFirebase(APP_CONFIG, session => {
      if (generation !== authGeneration) return;
      if (!session) { clearSession(); gateMessage(''); $('retry-connection').hidden = true; return; }
      if (session.connectionError) {
        clearSession(); gateMessage(friendlyError(session.error), true); $('retry-connection').hidden = false;
        if (session.uid) { $('denied-description').textContent = 'Akun sudah masuk, tetapi profil tim belum bisa dibaca. Coba sambungkan lagi atau gunakan akun lain.'; $('login-form').hidden = true; $('access-denied').hidden = false; $('denied-uid').textContent = session.uid; }
        return;
      }
      if (session.denied) {
        clearSession(); $('denied-description').textContent = 'Akun ini belum mendapat akses ke workspace. Berikan UID berikut kepada admin:'; $('login-form').hidden = true; $('access-denied').hidden = false;
        $('denied-uid').textContent = session.uid;
        gateMessage(session.error ? friendlyError(session.error) : 'Akun sudah masuk, tetapi akses workspace belum aktif.', true);
        return;
      }
      gateMessage(''); $('retry-connection').hidden = true; activateSession(session);
    });
    if (generation !== authGeneration) { connection.destroy(); return; }
    authClient = connection; $('login-button').disabled = false; $('reset-password').disabled = false;
  } catch (error) {
    if (generation !== authGeneration) return;
    gateMessage(error instanceof TypeError ? 'Firebase belum bisa dimuat. Periksa internet lalu coba sambungkan lagi.' : friendlyError(error), true);
    $('retry-connection').hidden = false;
  } finally { if (generation === authGeneration) authConnecting = false; }
}


let docDrag = null;
let suppressDocClick = false;

function documentButtonsOnPage() {
  return [...document.querySelectorAll('#request-rows [data-doc-drag]')];
}
function clearDocDragHighlight() {
  document.querySelectorAll('[data-doc-drag].is-drag-picked').forEach(node => node.classList.remove('is-drag-picked'));
}
function paintDocDragRange(target) {
  if (!docDrag) return;
  const buttons = documentButtonsOnPage();
  const start = buttons.indexOf(docDrag.start);
  const end = buttons.indexOf(target);
  if (start < 0 || end < 0) return;
  clearDocDragHighlight();
  const [a,b] = start <= end ? [start,end] : [end,start];
  buttons.slice(a,b+1).forEach(node => node.classList.add('is-drag-picked'));
  docDrag.end = target;
  if (a !== b) docDrag.moved = true;
}
async function finishDocDrag() {
  if (!docDrag) return;
  const drag = docDrag; docDrag = null;
  const picked = documentButtonsOnPage().filter(node => node.classList.contains('is-drag-picked'));
  suppressDocClick = true;
  if (drag.moved && picked.length > 1) {
    const numbers = picked.map(node => node.textContent.trim()).join('\n');
    try { await navigator.clipboard.writeText(numbers); toast(`${picked.length} nomor dokumen dicopy.`); }
    catch { toast(`${picked.length} nomor dipilih. Gunakan tombol Copy jika clipboard browser diblokir.`, true); }
    setTimeout(() => { clearDocDragHighlight(); suppressDocClick = false; }, 900);
  } else {
    clearDocDragHighlight();
    openDetail(drag.start.dataset.docDrag);
    setTimeout(() => { suppressDocClick = false; }, 0);
  }
}

document.addEventListener('pointerdown', event => {
  const target = event.target.closest('[data-doc-drag]');
  if (!target || event.button !== 0 || state.busy || (event.pointerType && event.pointerType !== 'mouse')) return;
  docDrag = { start: target, end: target, moved: false };
  clearDocDragHighlight(); target.classList.add('is-drag-picked');
  target.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
document.addEventListener('pointerover', event => {
  const target = event.target.closest('[data-doc-drag]');
  if (docDrag && target) paintDocDragRange(target);
});
document.addEventListener('pointermove', event => {
  if (!docDrag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-doc-drag]');
  if (target) paintDocDragRange(target);
});
document.addEventListener('pointerup', () => { if (docDrag) finishDocDrag(); });
document.addEventListener('pointercancel', () => { docDrag = null; clearDocDragHighlight(); });
document.addEventListener('keydown', event => {
  // `/` membuka kotak cari nomor dari mana saja selama tidak sedang mengetik.
  if (event.key === '/' && state.actor && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest?.('input, textarea, [contenteditable], dialog')) {
    event.preventDefault(); $('search-number').focus(); $('search-number').select?.(); return;
  }
  const target = event.target.closest?.('[data-doc-drag]');
  if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetail(target.dataset.docDrag); }
});

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]'); if (close) closeDialog(close.dataset.close);
  const audience = event.target.closest('[data-audience]'); if (audience && audience.dataset.audience !== state.audience) switchScope({ audience: audience.dataset.audience });
  const density = event.target.closest('[data-density]');
  if (density && ['comfortable','compact'].includes(density.dataset.density) && density.dataset.density !== state.density) { state.density = density.dataset.density; savePrefs(); render(); }
  if (state.busy) return;
  const room = event.target.closest('[data-room]'); if (room && room.dataset.room !== state.operation) switchScope({ operation: room.dataset.room, view: 'pending' });
  const entity = event.target.closest('[data-entity]'); if (entity && entity.dataset.entity !== state.entity) switchScope({ entity: entity.dataset.entity });
  const view = event.target.closest('[data-view]');
  if (view && view.dataset.view !== state.view) {
    state.view = view.dataset.view; state.selected.clear(); state.page = 1;
    refreshRows();
  }
  const doc = event.target.closest('[data-doc-drag]'); if (doc && !suppressDocClick) openDetail(doc.dataset.docDrag);
  const detail = event.target.closest('[data-detail]'); if (detail && !suppressDocClick) openDetail(detail.dataset.detail);
  const searchDetail = event.target.closest('[data-search-detail]'); if (searchDetail) openDetail(searchRows.find(row => row.id === searchDetail.dataset.searchDetail));
  const searchJump = event.target.closest('[data-search-jump]'); if (searchJump) jumpTo(searchRows.find(row => row.id === searchJump.dataset.searchJump));
  const complete = event.target.closest('[data-complete]'); if (complete) openConfirmation('done', [complete.dataset.complete]);
  const archive = event.target.closest('[data-archive]'); if (archive) openConfirmation('archive', [archive.dataset.archive]);
});

document.addEventListener('change', event => {
  const input = event.target.closest('[data-select]');
  if (!input) return;
  if (input.checked && state.selected.size >= MAX_BULK) { input.checked = false; toast(`Maksimal ${MAX_BULK} pilihan untuk satu tindakan.`, true); return; }
  input.checked ? state.selected.add(input.dataset.select) : state.selected.delete(input.dataset.select);
  input.closest?.('tr')?.classList.toggle('is-selected', input.checked);
  renderSelection();
});

$('select-all').addEventListener('change', event => {
  state.selected = event.target.checked ? new Set(getVisible().slice(0, MAX_BULK).map(row => row.id)) : new Set();
  render();
});
$('clear-selection').addEventListener('click', () => { state.selected.clear(); render(); });
$('date-preset').addEventListener('change', setDateFilters);
$('date-from').addEventListener('change', setDateFilters);
$('date-to').addEventListener('change', setDateFilters);
$('reset-date').addEventListener('click', () => { $('date-preset').value = 'indexed'; setDateFilters(); });
$('month-prev').addEventListener('click', () => activateMonth(shiftMonth(state.monthIndex, -1)));
$('month-next').addEventListener('click', () => activateMonth(shiftMonth(state.monthIndex, 1)));
$('month-current').addEventListener('click', () => activateMonth(currentMonth));
$('page-prev').addEventListener('click', () => { state.page--; render(); });
$('page-next').addEventListener('click', () => { state.page++; render(); });
$('load-archive').addEventListener('click', () => { state.archiveLimit += 100; refreshRows(); });
$('new-request').addEventListener('click', openRequest);
$('empty-add').addEventListener('click', openRequest);
$('request-form').addEventListener('submit', saveRequest);
$('form-documents').addEventListener('input', () => { formattedDuplicates = 0; $('form-error').hidden = true; updatePastePreview(); });
$('form-documents').addEventListener('paste', event => {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  const node = $('form-documents');
  node.setRangeText(text, node.selectionStart, node.selectionEnd, 'end');
  formattedDuplicates = 0; normalizePaste();
});
$('form-documents').addEventListener('keydown', event => {
  if (!shouldSubmitPaste(event)) return;
  event.preventDefault();
  if (!$('save-request').disabled) $('request-form').requestSubmit();
});
$('format-paste').addEventListener('click', () => normalizePaste(true));
$('clear-paste').addEventListener('click', () => { if (!state.busy) { resetComposer(); $('form-documents').focus(); } });
for (const id of ['form-operation', 'form-entity', 'form-year']) $(id).addEventListener('change', updatePastePreview);
for (const operation of ['reverse', 'cancel']) $(`tab-${operation}`).addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'reverse' : event.key === 'End' ? 'cancel' : operation === 'reverse' ? 'cancel' : 'reverse';
  if (!state.busy) { switchScope({ operation: next, view: 'pending' }); $(`tab-${next}`).focus(); }
});
$('copy-filter').addEventListener('click', openCopy);
$('search-number').addEventListener('input', applySearchFilter);
$('search-form').addEventListener('submit', event => { event.preventDefault(); applySearchFilter(); openSearch(); });
$('detail-jump').addEventListener('click', () => jumpTo(detailRecord));
$('copy-again').addEventListener('click', copyClipboard);
$('bulk-done').addEventListener('click', () => openConfirmation('done'));
$('bulk-archive').addEventListener('click', () => openConfirmation('archive'));
$('bulk-reopen').addEventListener('click', () => openConfirmation('reopen'));
$('bulk-restore').addEventListener('click', () => openConfirmation('restore'));
$('bulk-undelete').addEventListener('click', () => openConfirmation('undelete'));
$('bulk-delete').addEventListener('click', () => openConfirmation('delete'));
$('edit-form').addEventListener('submit', saveEdit);
$('detail-edit').addEventListener('click', () => { if (!detailRecord) return; $('detail-dialog').close(); openEdit(detailRecord); });
$('detail-delete').addEventListener('click', () => { if (!detailRecord) return; $('detail-dialog').close(); openConfirmation('delete', [detailRecord.id]); });
$('confirm-action').addEventListener('click', confirmAction);
$('detail-action').addEventListener('click', () => {
  if (!detailRecord) return;
  const action = detailRecord.status === 'deleted' ? 'undelete' : detailRecord.archived ? 'restore' : detailRecord.status === 'done' ? 'archive' : 'done';
  $('detail-dialog').close(); openConfirmation(action, [detailRecord.id]);
});
$('demo-button').addEventListener('click', startDemo);
$('reset-demo').addEventListener('click', () => { state.selected.clear(); demoClient?.reset(); toast('Data demo dikembalikan ke contoh awal.'); });
$('exit-demo').addEventListener('click', logout);
$('logout-button').addEventListener('click', logout);
$('denied-logout').addEventListener('click', logout);
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authClient || loginBusy) return;
  loginBusy = true;
  $('login-button').disabled = true; $('login-button').textContent = 'Masuk…'; gateMessage('');
  try { await authClient.login($('login-email').value.trim(), $('login-password').value, $('remember-me').checked); $('login-password').value = ''; }
  catch (error) { gateMessage(friendlyError(error), true); }
  finally { loginBusy = false; $('login-button').disabled = !authClient; $('login-button').textContent = 'Masuk'; }
});
$('retry-connection').addEventListener('click', () => boot().catch(error => gateMessage(friendlyError(error), true)));
$('reset-password').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  if (!email || !$('login-email').checkValidity()) { gateMessage('Isi email akun terlebih dahulu.', true); $('login-email').focus(); return; }
  if (!authClient) return;
  try { await authClient.resetPassword(email); gateMessage('Jika akun tersedia, tautan reset password akan dikirim ke email tersebut.'); }
  catch (error) { gateMessage(friendlyError(error), true); }
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog.id); } });
});
window.addEventListener('online', () => { render(); if (state.actor) { if (state.error) refreshRows(); if (state.countsError) refreshCounts(); } });
window.addEventListener('focus', () => { if (state.actor && Date.now() - lastCountRefreshAt > 60000) refreshCounts(); });
window.addEventListener('offline', render);
boot().catch(error => gateMessage(friendlyError(error), true));
