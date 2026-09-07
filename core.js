// --- System Data Core ---
function onWorksheetReady(callback) {
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
}

/* Satu pintu untuk seluruh kalender. Instance yang sudah aktif tidak dibuat ulang,
   dan DOM internal Flatpickr tetap dimiliki Flatpickr (bukan dropdown aplikasi). */
function markWorksheetCalendarOwned(instance) {
    const container = instance && instance.calendarContainer;
    if(!container) return;
    container.dataset.i18nSkip = 'true';
    container.querySelectorAll('select').forEach(select => { select.dataset.nativeSelect = 'true'; });
}

function ensureWorksheetCalendar(target, config = {}) {
    const input = typeof target === 'string' ? document.querySelector(target) : target;
    if(!input) return null;
    if(input._flatpickr) {
        markWorksheetCalendarOwned(input._flatpickr);
        return input._flatpickr;
    }
    if(typeof window.flatpickr !== 'function') {
        console.error('[Kalender] Komponen tanggal belum tersedia.');
        return null;
    }
    const originalReady = Array.isArray(config.onReady) ? config.onReady : (typeof config.onReady === 'function' ? [config.onReady] : []);
    const calendarConfig = {
        ...config,
        onReady: [...originalReady, (_dates, _value, instance) => markWorksheetCalendarOwned(instance)]
    };
    try {
        const instance = window.flatpickr(input, calendarConfig);
        markWorksheetCalendarOwned(instance);
        return instance;
    } catch(error) {
        console.error('[Kalender] Gagal mengaktifkan pemilih tanggal:', error);
        return null;
    }
}
window.ensureWorksheetCalendar = ensureWorksheetCalendar;

// Kalender tanggal tunggal untuk isian formulir. Sengaja TANPA altInput:
// seluruh kode membaca dan menulis nilainya lewat id aslinya, dan altInput akan
// menggantikan elemen itu dengan elemen lain. allowInput dibiarkan menyala
// supaya tanggal tetap dapat diketik seperti sebelumnya, lengkap dengan
// autoFormatDate.
//
// Definisinya berada di tingkat atas, bukan di dalam callback autentikasi,
// supaya formulir yang mengosongkan atau mengisi tanggal tidak bergantung pada
// urutan login.
const FORM_DATE_CONFIG = {
    dateFormat: "d/m/Y", allowInput: true, disableMobile: true,
    locale: {
        months: {
            shorthand: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
            longhand: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
        },
        weekdays: {
            shorthand: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
            longhand: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
        },
        firstDayOfWeek: 1
    }
};
window.attachFormDatePicker = function(selector) {
    const el = document.querySelector(selector);
    if(!el || el._flatpickr) return null;
    return ensureWorksheetCalendar(selector, { ...FORM_DATE_CONFIG });
};
// Nilai yang diisi program (buka klaim, reset formulir) harus ikut disinkronkan,
// kalau tidak kalender masih menyorot tanggal lama.
window.setFormDateValue = function(id, value) {
    const el = document.getElementById(id);
    if(!el) return;
    el.value = value || '';
    if(el._flatpickr) {
        if(value) el._flatpickr.setDate(value, false, "d/m/Y");
        else el._flatpickr.clear(false);
    }
};

let currentDocTargetId = null;
        // Directory role saja. Password tidak pernah disimpan di browser;
        // kredensial tetap sepenuhnya dikelola Firebase Authentication.
        let masterUsers = [];
        let currentFirebaseUser = null;
        let logoutInProgress = false;
        const VALID_APP_ROLES = ['admin', 'accounting', 'finance', 'viewer'];
        const APP_LOGIN_DOMAIN = '@aio.co.id';

        function getShortUsername(value) {
            const raw = String(value === null || value === undefined ? '' : value).trim();
            if(!raw || raw === '-') return raw || '-';
            return raw.includes('@') ? raw.split('@')[0] : raw;
        }
        function getShortUsernameHtml(value) {
            return getShortUsername(value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        function getInternalLoginEmail(username) {
            const shortName = getShortUsername(username).toLowerCase();
            return shortName === '-' ? '' : `${shortName}${APP_LOGIN_DOMAIN}`;
        }
        function shortenActorEmailsInText(value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/\b([a-z0-9][a-z0-9._-]*)@aio\.co\.id\b/gi, '$1');
        }
        const ACTOR_DISPLAY_FIELDS = new Set(['inputBy', 'postedBy', 'paymentBy', 'holdBy', 'returnedBy', 'canceledBy', 'hardcopyBy', '_updatedBy']);
        function isActorDisplayField(key) { return ACTOR_DISPLAY_FIELDS.has(key); }

        function normalizeAppRole(value) { const role = String(value || 'viewer').toLowerCase(); return role === 'user' ? 'accounting' : role; }
        // Hak membuat pengajuan baru dipisahkan dari hak edit workflow Accounting.
        function canCreateClaims() { return ['admin', 'accounting', 'finance'].includes(sessionRole); }
        function canEditClaims() { return sessionRole === 'admin' || sessionRole === 'accounting'; }
        function isAppAdmin() { return sessionRole === 'admin'; }
        function isFinanceRole() { return sessionRole === 'finance'; }
        function canManageFinanceWorkflow() { return isAppAdmin() || isFinanceRole(); }
        window.canCreateClaims = canCreateClaims;
        // Finance membaca data Accounting secara read-only, tetapi memiliki dua
        // area tulis sendiri: Input Pengajuan Baru dan alur pembayaran.
        function isReadOnlyRole() { return isFinanceRole() || sessionRole === 'viewer'; }
        function canMarkClaimPaid() { return canManageFinanceWorkflow(); }
        // Batal Bayar (Paid -> Posted) terbuka untuk Finance dan Admin, tidak
        // dikunci ke pencatat pembayarannya: pembayaran keliru sering baru
        // ketahuan oleh rekan yang berbeda shift. Alasannya wajib diisi dan
        // pelakunya terekam pada lastPaymentCancellation.cancelledBy serta
        // historyLog. Batasan yang sama ditegakkan pada firestore.rules lewat
        // claimTransitionAllowed().
        function canCancelPayment() { return canManageFinanceWorkflow(); }
        function canCreateActivityLog() { return VALID_APP_ROLES.includes(sessionRole); }
        function getCurrentActorIdentity() {
            return currentFirebaseUser && currentFirebaseUser.email ? String(currentFirebaseUser.email).toLowerCase() : String(sessionUser || 'Sistem');
        }
        function getCurrentActorUsername() { return getShortUsername(getCurrentActorIdentity()); }
        function isFinalClaimStatus(status) { return status === 'Posted' || status === 'Paid' || status === 'Hold'; }
        function isCanceledClaim(item) { return !!item && (String(item.statusClaim || '') === 'Canceled' || item.isInactive === true); }
        function isClaimActiveForAnalytics(item) { return !!item && !isCanceledClaim(item); }
        // History Claim hanya menampilkan claim yang SAAT INI masih berada di
        // alur pasca-RTP. Claim yang di-reverse atau dikembalikan ke Accounting
        // langsung keluar dari History, walaupun jejak auditnya tetap tersimpan.
        function isCurrentHistoryClaim(item) {
            return !!item && ['Posted', 'Paid', 'Hold'].includes(String(item.statusClaim || ''));
        }
        function getClaimRtpDate(item) {
            if(!item) return null;
            const completedAt = Number(item.workflowTimestamps && item.workflowTimestamps.completedAt);
            if(Number.isFinite(completedAt) && completedAt > 0) {
                const completedDate = new Date(completedAt);
                if(!Number.isNaN(completedDate.getTime())) {
                    completedDate.setHours(0, 0, 0, 0);
                    return completedDate;
                }
            }
            const match = String(item.postedAt || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if(!match) return null;
            const postedDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
            if(postedDate.getFullYear() !== Number(match[3]) || postedDate.getMonth() !== Number(match[2]) - 1 || postedDate.getDate() !== Number(match[1])) return null;
            postedDate.setHours(0, 0, 0, 0);
            return postedDate;
        }
        window.isCurrentHistoryClaim = isCurrentHistoryClaim;
        window.getClaimRtpDate = getClaimRtpDate;
        function getCanceledClaimDate(item) {
            if(!item) return null;
            if(Number(item.canceledAtMs)) { const d = new Date(Number(item.canceledAtMs)); d.setHours(0,0,0,0); return Number.isNaN(d.getTime()) ? null : d; }
            const token = String(item.canceledAt || '').replace(',', '').trim().split(/\s+/)[0];
            return typeof parseReportingDate === 'function' ? parseReportingDate(token) : null;
        }
        function formatCanceledDate(item) {
            const date = getCanceledClaimDate(item);
            return date ? date.toLocaleDateString('id-ID', {day:'2-digit', month:'2-digit', year:'numeric'}) : '-';
        }
        window.getCanceledClaimDate = getCanceledClaimDate;
        window.formatCanceledDate = formatCanceledDate;
        // Tanggal pengembalian ke Accounting. Bentuknya sama persis dengan
        // getCanceledClaimDate(): stempel milidetik lebih dipercaya, teksnya
        // dipakai sebagai cadangan untuk dokumen lama.
        function getClaimReturnDate(item) {
            if(!item) return null;
            if(Number(item.returnedAtMs)) { const d = new Date(Number(item.returnedAtMs)); d.setHours(0,0,0,0); return Number.isNaN(d.getTime()) ? null : d; }
            const token = String(item.returnedAt || '').replace(',', '').trim().split(/\s+/)[0];
            return typeof parseReportingDate === 'function' ? parseReportingDate(token) : null;
        }
        window.getClaimReturnDate = getClaimReturnDate;
        function hasEverReachedPosted(item) {
            if(!item) return false;
            if(item.postedAt || ['Posted', 'Paid', 'Hold'].includes(item.statusClaim)) return true;
            return Array.isArray(item.historyLog) && item.historyLog.some(log => /^(Posted|Paid|Hold|Returned by Finance|Cancelled Paid|Released Hold)/i.test(String(log && log.status || '')));
        }
        function isClaimFinanciallyLocked(item) { return !!item && (isFinalClaimStatus(item.statusClaim) || isCanceledClaim(item)); }

        // --- JEJAK RTP ---
        // Tgl RTP (postedAt), Jam RTP, dan PIC Posted hanya berlaku selama claim
        // benar-benar berada di alur pasca-RTP: Posted, Paid, atau Hold. Begitu
        // claim kembali ke tangan Accounting (In Process / Waiting Approval /
        // Revisi), jejak itu harus lepas supaya tidak ada claim ber-Tgl RTP yang
        // sebenarnya belum RTP.
        //
        // 'Returned by Finance' sengaja TIDAK termasuk: firestore.rules
        // (validFinanceReturn -> preservesPostedAudit) mewajibkan postedAt,
        // postedBy, dan completedAt tetap utuh pada langkah pengembalian itu.
        // Jejaknya baru dilepas pada langkah Accounting berikutnya, yang berjalan
        // lewat validAccountingUpdate() dan tidak terikat preservesPostedAudit().
        const RTP_TRACE_STATUSES = ['Posted', 'Paid', 'Hold', 'Returned by Finance'];
        function claimStatusKeepsRtpTrace(status) {
            return RTP_TRACE_STATUSES.includes(String(status || ''));
        }
        // Mengembalikan Tgl RTP lama supaya pemanggil dapat mencatatnya pada
        // linimasa, atau null bila memang tidak ada jejak yang dilepas.
        function clearClaimRtpTrace(item) {
            if(!item) return null;
            const marks = item.workflowTimestamps || {};
            const hadTrace = !!item.postedAt || !!item.postedBy || Number(marks.completedAt) > 0;
            if(!hadTrace) return null;
            const previous = String(item.postedAt || '').trim() || '-';
            delete item.postedAt;
            delete item.postedBy;
            if(item.workflowTimestamps) delete item.workflowTimestamps.completedAt;
            return previous;
        }
        window.claimStatusKeepsRtpTrace = claimStatusKeepsRtpTrace;
        window.clearClaimRtpTrace = clearClaimRtpTrace;

        // --- TANGGAL PROSES OTOMATIS ---
        // Status In Process hanya berarti datanya sudah masuk lewat Rekap Harian,
        // belum tentu sudah dikerjakan. Pekerjaan Accounting baru benar-benar
        // dimulai ketika claim dipindahkan ke Waiting Approval atau dikembalikan
        // sebagai Revisi kepada pengguna. Karena itu Tanggal Proses dicap pada
        // perpindahan PERTAMA ke salah satu status tersebut.
        //
        // Perpindahan berikutnya tidak boleh menggeser tanggalnya lagi: sekali
        // sebuah claim mulai diproses, tanggal mulainya tidak berubah walaupun
        // nanti kembali lagi ke Revisi atau Waiting Approval.
        function hasClaimBeenProcessed(item) {
            if(!item) return true;
            const marks = item.workflowTimestamps || {};
            if(Number(marks.firstProcessedAt) > 0) return true;
            // Claim lama dibuat sebelum firstProcessedAt ada. Jejak berikut sudah
            // cukup membuktikan claim itu pernah diproses, sehingga tanggalnya
            // tidak ikut tertimpa saat statusnya berpindah lagi.
            if(Number(marks.waitingApprovalAt) > 0 || Number(marks.revisionAt) > 0 || Number(marks.completedAt) > 0) return true;
            if(hasEverReachedPosted(item)) return true;
            return Array.isArray(item.historyLog) && item.historyLog.some(log =>
                /^(Waiting Approval|Revisi|Confirm)/i.test(String(log && log.status || '')));
        }
        function isFirstProcessingTransition(item, nextStatus) {
            return ['Waiting Approval', 'Revisi'].includes(String(nextStatus || '')) && !hasClaimBeenProcessed(item);
        }
        // Mengembalikan tanggal lama supaya pemanggil dapat mencatat perubahannya
        // pada linimasa.
        function stampClaimProcessingDate(item, actionDate) {
            if(!item.workflowTimestamps) item.workflowTimestamps = {};
            const previous = String(item.tglProses || '').trim() || '-';
            item.tglProses = actionDate.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' });
            item.workflowTimestamps.firstProcessedAt = actionDate.getTime();
            return previous;
        }
        window.hasClaimBeenProcessed = hasClaimBeenProcessed;
        window.isFirstProcessingTransition = isFirstProcessingTransition;
        function getClaimStatusClass(status) {
            if(status === 'Paid') return 'status-paid';
            if(status === 'Hold') return 'status-hold';
            if(status === 'Returned by Finance') return 'status-returned';
            if(status === 'Posted') return 'status-posted';
            if(status === 'Waiting Approval' || status === 'Confirm') return 'status-waiting';
            if(status === 'Revisi') return 'status-revise';
            if(status === 'Canceled') return 'status-canceled';
            return 'status-process';
        }
        function requireClaimCreator() {
            if (canCreateClaims()) return true;
            showToast('Akun ini tidak memiliki akses untuk membuat pengajuan baru.', 'error');
            return false;
        }
        window.requireClaimCreator = requireClaimCreator;

        function requireClaimEditor() {
            if (canEditClaims()) return true;
            showToast('Akun ini hanya memiliki akses baca.', 'error');
            return false;
        }
        function requireAdmin() {
            if (isAppAdmin()) return true;
            showToast('Tindakan ini hanya dapat dilakukan Admin.', 'error');
            return false;
        }

        async function resolveFirebaseRole(user) {
            if (!user || !window.firebaseDb || !window.fbDoc || !window.fbGetDoc) return 'viewer';
            try {
                const roleRef = window.fbDoc(window.firebaseDb, 'userRoles', user.uid);
                const snap = await window.fbGetDoc(roleRef);
                // Fail closed: akun tanpa dokumen role hanya boleh membaca.
                const role = normalizeAppRole(snap.exists() ? snap.data().role : 'viewer');
                return VALID_APP_ROLES.includes(role) ? role : 'viewer';
            } catch (error) {
                console.error('[Role] Gagal membaca role pengguna:', error);
                return 'viewer';
            }
        }

        function subscribeRoleDirectory() {
            if (!window.firebaseDb || !window.fbCollection || !window.fbOnSnapshot || sessionRole !== 'admin') return;
            if (typeof window.unsubRoles === 'function') return;
            const rolesRef = window.fbCollection(window.firebaseDb, 'userRoles');
            window.unsubRoles = window.fbOnSnapshot(rolesRef, (snapshot) => {
                masterUsers = snapshot.docs.map(roleDoc => {
                    const data = roleDoc.data();
                    const rawRole = String(data.role || 'viewer').toLowerCase();
                    return { uid: roleDoc.id, ...data, _rawRole: rawRole, role: normalizeAppRole(rawRole) };
                });
                masterUsers.sort((a, b) => getShortUsername(a.username || a.email).localeCompare(getShortUsername(b.username || b.email)));
                if (window.currentOpenMenu === 'master-user') renderMasterUser();
                migrateLegacyUserRoles().catch(error => console.error('[Role] Migrasi legacy user gagal:', error));
            }, (error) => console.error('[Role] Gagal memuat directory role:', error));
        }

        let legacyRoleMigrationRunning = false;
        async function migrateLegacyUserRoles() {
            if(legacyRoleMigrationRunning || !isAppAdmin() || !window.firebaseDb || !window.fbSetDoc || !window.fbDoc) return;
            const legacy = masterUsers.filter(user => user && user._rawRole === 'user' && user.uid);
            if(!legacy.length) return;
            legacyRoleMigrationRunning = true;
            try {
                await Promise.all(legacy.map(user => window.fbSetDoc(window.fbDoc(window.firebaseDb, 'userRoles', user.uid), {
                    role:'accounting', updatedBy:sessionUser, updatedAtMs:Date.now()
                }, { merge:true })));
                logActivity(sessionUser, `Migrasi Role Firebase: ${legacy.length} user → accounting`, { category:'access' }).catch(() => {});
                showToast(`${legacy.length} role legacy berhasil dimigrasikan menjadi Accounting.`, 'success');
            } finally { legacyRoleMigrationRunning = false; }
        }

        // Activity Logs
        const ACTIVITY_LOG_CACHE_KEY = 'otsukaActivityLogs_v16';
        const ACTIVITY_LOG_OUTBOX_KEY = 'otsukaActivityLogOutbox_v16';
        const ACTIVITY_LOG_WATERMARK_KEY = 'otsukaActivityLogWatermark_v16';
        const ACTIVITY_LOG_CACHE_READY_KEY = 'otsukaActivityLogCacheReady_v16';
        const ACTIVITY_LOG_LIMIT = 2000;
        const ACTIVITY_CATEGORY_LABELS = Object.freeze({
            claim: 'Klaim', workflow: 'Alur Kerja', adjustment: 'Penyesuaian', import: 'Impor',
            export: 'Ekspor', master: 'Data Induk', access: 'Akses & Peran', sla: 'SLA',
            backup: 'Cadangan', system: 'Sistem'
        });
        const ACTIVITY_CATEGORY_ICONS = Object.freeze({
            claim: '▤', workflow: '↔', adjustment: '±', import: '↓', export: '↑',
            master: '◫', access: '♙', sla: '◷', backup: '▣', system: '⚙'
        });
        let activityLogs = [];
        let activityLogOutbox = [];
        let activityLogCurrentPage = 1;
        let activityLogRowsPerPage = 50;
        try { activityLogs = JSON.parse(localStorage.getItem('otsukaActivityLogs_v16') || '[]'); } catch(e) {}
        try { activityLogOutbox = JSON.parse(localStorage.getItem(ACTIVITY_LOG_OUTBOX_KEY) || '[]'); } catch(e) {}

        function getActivityLogSyncWatermark() {
            const stored = Number(localStorage.getItem(ACTIVITY_LOG_WATERMARK_KEY));
            if(Number.isFinite(stored) && stored > 0) return stored;
            if(localStorage.getItem(ACTIVITY_LOG_CACHE_READY_KEY) !== 'true') return 0;
            return activityLogs.reduce((max, entry) => Math.max(max, Number(entry && entry.ts) || 0), 0);
        }

        function setActivityLogSyncWatermark(value) {
            const next = Number(value) || 0;
            if(next <= 0) return;
            const current = getActivityLogSyncWatermark();
            try {
                localStorage.setItem(ACTIVITY_LOG_WATERMARK_KEY, String(Math.max(current, next)));
                localStorage.setItem(ACTIVITY_LOG_CACHE_READY_KEY, 'true');
            } catch(error) {}
        }

        function mergeActivityLogRows(...groups) {
            const byId = new Map();
            groups.flat().filter(Boolean).forEach((entry, index) => {
                const key = String(entry.eventId || entry.id || `${entry.ts || 0}-${entry.actorUid || ''}-${entry.action || ''}-${index}`);
                if(!byId.has(key)) byId.set(key, entry);
            });
            return Array.from(byId.values()).sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0)).slice(0, ACTIVITY_LOG_LIMIT);
        }

        function cacheActivityLogs(logs) {
            activityLogs = Array.isArray(logs) ? logs.slice(0, ACTIVITY_LOG_LIMIT) : [];
            try { localStorage.setItem(ACTIVITY_LOG_CACHE_KEY, JSON.stringify(activityLogs)); } catch(e) {}
            if(window.currentOpenMenu === 'master-user') renderActivityLogs();
        }

        function cacheActivityLogOutbox(entries) {
            activityLogOutbox = Array.isArray(entries) ? entries.slice(-ACTIVITY_LOG_LIMIT) : [];
            try { localStorage.setItem(ACTIVITY_LOG_OUTBOX_KEY, JSON.stringify(activityLogOutbox)); } catch(e) {}
            if(window.currentOpenMenu === 'master-user') renderActivityLogs();
        }

        function extractActivityClaimId(value) {
            const match = String(value || '').match(/(?:claim\s+)?id:?\s*(\d{10,15})/i);
            return match && match[1] ? Number(match[1]) : null;
        }

        function classifyActivityLogAction(value) {
            const action = String(value || '').toLowerCase();
            if(/update status|perubahan status|pembaruan status|bulk posted|perubahan massal.*posted|bulk reverse|pembatalan massal.*posted|reverse claim|undo status|pembatalan status/.test(action)) return 'workflow';
            if(/adjust|penyesuaian/.test(action)) return 'adjustment';
            if(/import|impor/.test(action)) return 'import';
            if(/export|ekspor|unduh/.test(action)) return 'export';
            if(/kalender sla|mesin sla|mode sla/.test(action)) return 'sla';
            if(/backup|cadangan|restore|pemulihan|recovery/.test(action)) return 'backup';
            if(/login|masuk otomatis|logout|keluar dari aplikasi|role firebase|peran firebase|hapus role|hapus peran/.test(action)) return 'access';
            if(/master gl|master karyawan|data induk (akun )?gl|data induk karyawan/.test(action)) return 'master';
            if(/claim|klaim|detail nota|rincian nota|data id/.test(action)) return 'claim';
            return 'system';
        }

        function getActivityLogMeta(log) {
            const rawAction = shortenActorEmailsInText(log && log.action ? String(log.action) : 'Aktivitas tidak diketahui');
            const claimId = Number(log && log.claimId) || extractActivityClaimId(rawAction);
            const claim = claimId && typeof dbRekap !== 'undefined' && Array.isArray(dbRekap) ? dbRekap.find(item => Number(item.id) === claimId) : null;
            const category = ACTIVITY_CATEGORY_LABELS[log && log.category] ? log.category : classifyActivityLogAction(rawAction);
            const eventId = String(log && (log.eventId || log.id) || '');
            const pending = !!eventId && activityLogOutbox.some(entry => String(entry && entry.eventId) === eventId);
            const syncKey = !(log && log.actorUid) ? 'local' : (pending ? 'pending' : 'synced');
            return {
                rawAction,
                claimId,
                claim,
                claimNo: String(log && log.claimNo || (claim && (claim.noPR || claim.extNo)) || '-'),
                claimName: String(log && log.claimName || (claim && claim.nama) || '-'),
                category,
                categoryLabel: ACTIVITY_CATEGORY_LABELS[category] || ACTIVITY_CATEGORY_LABELS.system,
                eventId,
                syncKey,
                syncLabel: syncKey === 'pending' ? 'Menunggu Sinkronisasi Cloud' : (syncKey === 'local' ? 'Hanya Lokal' : 'Tersinkron')
            };
        }

        async function flushActivityLogOutbox() {
            if(window.activityLogFlushInProgress || !canCreateActivityLog() || !currentFirebaseUser || !window.firebaseDb || !window.fbDoc || !window.fbSetDoc) return false;
            const actorUid = String(currentFirebaseUser.uid || '');
            const mine = activityLogOutbox.filter(entry => entry.actorUid === actorUid);
            if(!mine.length) return true;
            const attemptedIds = new Set(mine.map(entry => entry.eventId));
            window.activityLogFlushInProgress = true;
            const completedIds = new Set();
            try {
                for(const entry of mine) {
                    const logRef = window.fbDoc(window.firebaseDb, 'activityLogs', entry.eventId);
                    try {
                        // Rules tidak memberi akses baca log kepada non-Admin. Karena ID dan
                        // payload event stabil, set ulang payload yang sama aman/idempotent.
                        await window.fbSetDoc(logRef, entry);
                        completedIds.add(entry.eventId);
                    } catch(error) {
                        console.error('[Activity Log] Event tetap di antrean lokal:', error);
                    }
                }
                cacheActivityLogOutbox(activityLogOutbox.filter(entry => !completedIds.has(entry.eventId)));
                return mine.every(entry => completedIds.has(entry.eventId));
            } finally {
                window.activityLogFlushInProgress = false;
                if(activityLogOutbox.some(entry => entry.actorUid === actorUid && !attemptedIds.has(entry.eventId))) {
                    setTimeout(() => { flushActivityLogOutbox().catch(() => {}); }, 250);
                }
            }
        }

        // Pencatatan audit tidak boleh pernah menggagalkan aksi penggunanya.
        // Sebagian besar pemanggil menuliskannya tanpa .catch(), sehingga satu
        // kegagalan di dalam sini (localStorage penuh, render tabel log
        // bermasalah) berubah menjadi unhandled rejection yang tidak
        // memperbaiki apa pun. Kegagalan cukup dicatat ke console; event yang
        // belum terkirim tetap tersimpan pada outbox dan dicoba ulang.
        async function logActivity(user, actionStr, metadata = null) {
            try {
                return await writeActivityLogEntry(user, actionStr, metadata);
            } catch(error) {
                console.error('[Activity Log] Event gagal dicatat:', error);
                return false;
            }
        }

        async function writeActivityLogEntry(user, actionStr, metadata = null) {
            const now = new Date();
            const actorUid = currentFirebaseUser && currentFirebaseUser.uid ? String(currentFirebaseUser.uid) : '';
            const eventId = `evt-${actorUid || 'local'}-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
            const action = String(actionStr || 'Aktivitas tidak diketahui');
            const supplied = metadata && typeof metadata === 'object' ? metadata : {};
            const claimId = Number(supplied.claimId) || extractActivityClaimId(action);
            const claim = claimId && typeof dbRekap !== 'undefined' && Array.isArray(dbRekap) ? dbRekap.find(item => Number(item.id) === claimId) : null;
            const entry = {
                eventId,
                time: now.toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'}),
                ts: now.getTime(),
                user: getCurrentActorIdentity() || String(user || 'Sistem'),
                action,
                actorUid,
                actorRole: String(sessionRole || 'unknown'),
                source: 'application',
                category: ACTIVITY_CATEGORY_LABELS[supplied.category] ? supplied.category : classifyActivityLogAction(action),
                outcome: String(supplied.outcome || 'success')
            };
            if(claimId) entry.claimId = claimId;
            const claimNo = supplied.claimNo || (claim && (claim.noPR || claim.extNo));
            const claimName = supplied.claimName || (claim && claim.nama);
            if(claimNo) entry.claimNo = String(claimNo).slice(0, 120);
            if(claimName) entry.claimName = String(claimName).slice(0, 160);

            cacheActivityLogs(mergeActivityLogRows([entry], activityLogs));
            if(!canCreateActivityLog() || !actorUid) return false;
            cacheActivityLogOutbox([...activityLogOutbox, entry]);
            const synced = await flushActivityLogOutbox();
            if(!synced) console.warn('[Activity Log] Audit event akan dicoba lagi saat online/login berikutnya.');
            return synced;
        }

        window.addEventListener('online', () => { flushActivityLogOutbox().catch(() => {}); });

        async function publishActivityLogCleanup(cutoffMs) {
            if(!isAppAdmin() || !window.firebaseDb || !window.fbDoc || !window.fbGetDoc || !window.fbSetDoc) return;
            const stateRef = window.fbDoc(window.firebaseDb, 'appData', 'activityLogState');
            const current = await window.fbGetDoc(stateRef).catch(() => null);
            const previous = current && current.exists() ? Number(current.data().cutoffMs) || 0 : 0;
            const next = Math.max(previous, Number(cutoffMs) || 0);
            await window.fbSetDoc(stateRef, { cutoffMs: next, updatedAtMs: Date.now(), updatedBy: getCurrentActorIdentity() }, { merge:true });
        }

        function applyActivityLogCleanupCutoff(cutoffMs) {
            const cutoff = Number(cutoffMs) || 0;
            if(cutoff <= 0) return;
            cacheActivityLogs(activityLogs.filter(entry => Number(entry && entry.ts) >= cutoff));
            cacheActivityLogOutbox(activityLogOutbox.filter(entry => Number(entry && entry.ts) >= cutoff));
        }
        window.applyActivityLogCleanupCutoff = applyActivityLogCleanupCutoff;

        function clearActivityLogs(days) {
            if(!requireAdmin()) return;
            customConfirm(days === 'all' ? 'Apakah Anda yakin ingin menghapus seluruh log aktivitas secara permanen?' : `Apakah Anda yakin ingin menghapus log yang berusia lebih dari ${days} hari?`, async () => {
                let progressId = 0;
                try {
                    const collectionRef = window.fbCollection(window.firebaseDb, 'activityLogs');
                    const cutoff = days === 'all' ? null : Date.now() - (Number(days) * 24 * 60 * 60 * 1000);
                    const sourceRef = cutoff === null ? collectionRef : window.fbQuery(collectionRef, window.fbWhere('ts', '<', cutoff));
                    const snapshot = await window.fbGetDocs(sourceRef);
                    progressId = typeof window.startGlobalDataProgress === 'function'
                        ? window.startGlobalDataProgress('Membersihkan Log Aktivitas', `0 dari ${snapshot.docs.length} log diproses...`)
                        : 0;
                    for(let start = 0; start < snapshot.docs.length; start += 25) {
                        await Promise.all(snapshot.docs.slice(start, start + 25).map(logDoc => window.fbDeleteDoc(logDoc.ref)));
                        const completed = Math.min(snapshot.docs.length, start + 25);
                        if(progressId) window.updateGlobalDataProgress(progressId, snapshot.docs.length ? (completed / snapshot.docs.length) * 100 : 100, 'Membersihkan Activity Log', `${completed} dari ${snapshot.docs.length} log diproses...`);
                    }
                    const cleanupCutoff = cutoff === null ? Date.now() : cutoff;
                    await publishActivityLogCleanup(cleanupCutoff);
                    applyActivityLogCleanupCutoff(cleanupCutoff);
                    if(progressId) window.finishGlobalDataProgress(progressId, 'Activity Log sudah dibersihkan', `${snapshot.docs.length} log selesai diproses.`);
                    showToast(`${snapshot.docs.length} log aktivitas berhasil dibersihkan.`, 'success');
                    logActivity(sessionUser, `Pembersihan Log Aktivitas: ${days === 'all' ? 'seluruh data' : `lebih lama dari ${days} hari`}`);
                } catch(error) {
                    if(progressId) window.failGlobalDataProgress(progressId, 0, 'Pembersihan log terhenti', 'Sebagian data mungkin belum terhapus. Silakan periksa lalu coba lagi.');
                    console.error('[Activity Log] Gagal membersihkan event:', error);
                    showToast('Log aktivitas pada cloud gagal dibersihkan.', 'error');
                }
            });
        }

        let sessionUser = ""; 
        let sessionRole = "";

        // --- Custom GL Autocomplete State ---
        let glHighlightIndex = -1;
        let currentGLOptions = [];
        let activeGLInput = null;

        function renderGLOverlay(inputEl) {
            activeGLInput = inputEl;
            let overlay = document.getElementById('gl-autocomplete-overlay');
            overlay.innerHTML = '';
            
            currentGLOptions.forEach((opt, idx) => {
                let div = document.createElement('div');
                div.className = 'gl-auto-item' + (idx === glHighlightIndex ? ' active' : '');
                div.innerText = opt;
                div.onmousedown = function(e) {
                    e.preventDefault();
                    selectGLOption(opt);
                };
                overlay.appendChild(div);
            });

            let rect = inputEl.getBoundingClientRect();
            overlay.style.top = (rect.bottom + window.scrollY + 2) + 'px';
            overlay.style.left = (rect.left + window.scrollX) + 'px';
            overlay.style.width = rect.width + 'px';
            overlay.style.display = 'block';
            
            let activeItem = overlay.querySelector('.active');
            if(activeItem) {
                activeItem.scrollIntoView({block: 'nearest'});
            }
        }

        function selectGLOption(val) {
            if(activeGLInput) {
                activeGLInput.value = toTitleCase(val);
                activeGLInput.focus();
            }
            document.getElementById('gl-autocomplete-overlay').style.display = 'none';
            currentGLOptions = [];
            glHighlightIndex = -1;
        }
        // Hide overlay on click outside
        document.addEventListener('click', function(e) {
            if(e.target && !e.target.classList.contains('line-gl')) {
                document.getElementById('gl-autocomplete-overlay').style.display = 'none';
            }
        });
document.getElementById('tbody-line-items').addEventListener('scroll', function() {
            let overlay = document.getElementById('gl-autocomplete-overlay');
            if (overlay.style.display === 'block') {
                overlay.style.display = 'none';
                activeGLInput = null;
            }
        }, true);

        // Autocomplete typing listener
        document.getElementById('tbody-line-items').addEventListener('input', function(e) {
            if(e.target.classList.contains('line-gl')) {
                // --- TAMBAHAN: CEGAH ANGKA ---
                if (/[0-9]/.test(e.target.value)) {
                    e.target.value = e.target.value.replace(/[0-9]/g, '');
                    showToast('Akun GL tidak boleh mengandung angka.', 'error');
                    return; // Stop eksekusi biar autocomplete nggak jalan kalau ada angka
                }
                // -----------------------------

                // Apply Title Case real-time
                let start = e.target.selectionStart;
                let end = e.target.selectionEnd;
                e.target.value = toTitleCase(e.target.value);
                e.target.setSelectionRange(start, end);

                let val = e.target.value.toLowerCase();
                if(!val) {
                    document.getElementById('gl-autocomplete-overlay').style.display = 'none';
                    return;
                }
                
                // Saran untuk baris jurnal klaim lama. Sumbernya kini nama akun
                // GL warisan ditambah daftar tipe, sehingga penyatuan master
                // tidak menghilangkan satu pun saran yang biasa dipakai.
                const kandidat = [];
                masterGL.forEach(g => {
                    (Array.isArray(g.glLegacy) ? g.glLegacy : []).forEach(nama => kandidat.push(nama));
                    if(g.gl) kandidat.push(g.gl);
                    if(g.tipe) kandidat.push(g.tipe);
                });
                let allGLs = [...new Set(kandidat.map(x => String(x || '').trim()).filter(Boolean))];
                currentGLOptions = allGLs.filter(g => g.toLowerCase().includes(val));
                
                if(currentGLOptions.length > 0) {
                    glHighlightIndex = 0; // Default highlight first item
                    renderGLOverlay(e.target);
                } else {
                    document.getElementById('gl-autocomplete-overlay').style.display = 'none';
                }
            }
        });

        // --- Custom Alert & Confirm Modals ---
        let confirmAction = null;

        // Popup dan toast adalah komponen teks biasa. Normalisasi ini menjaga
        // pesan lama yang masih membawa tag format agar tetap terbaca rapi,
        // tanpa pernah mengeksekusi HTML dari data maupun pesan sistem.
        function normalizeSystemMessageText(value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/\r\n?/g, '\n')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&quot;/gi, '"')
                .replace(/&#39;|&apos;/gi, "'")
                .replace(/&amp;/gi, '&')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<\/?[a-z][^>\n]*>/gi, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }
        window.normalizeSystemMessageText = normalizeSystemMessageText;
        
        function customConfirm(msg, actionCallback) {
            let confirmModal = document.getElementById('custom-confirm');
            // Gembok: Kalau popup udah kebuka, jangan buka lagi (Anti-double klik)
            if (confirmModal.style.display === 'flex') return; 
            
            document.getElementById('confirm-msg').innerText = normalizeSystemMessageText(msg);
            if(typeof applyWorksheetTranslations === 'function') applyWorksheetTranslations(confirmModal);
            confirmAction = actionCallback;
            window.lastSystemDialogFocus = document.activeElement;
            confirmModal.style.display = 'flex';
            confirmModal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('system-dialog-open');
            
            // Pindahkan fokus ke tombol Batal untuk menghindari ke-klik Enter 2x secara beruntun
            setTimeout(() => {
                let btnBatal = confirmModal.querySelector('.btn-secondary');
                if (btnBatal) btnBatal.focus();
            }, 50);
        }
        
        function execConfirm() {
            let action = confirmAction;
            confirmAction = null; 
            
            closeModal('custom-confirm'); // Tutup pop-up SEBELUM ngehapus data biar ga ada bug visual
            
            if(action) {
                setTimeout(() => { // Kasih jeda kecil biar animasi modal nutup mulus dulu
                    try { action(); } catch(e) { console.error("System Error: ", e); }
                }, 10);
            }
        }

        function customAlert(msg) {
            let alertModal = document.getElementById('custom-alert');
            if (alertModal.style.display === 'flex') return;
            
            document.getElementById('alert-msg').innerText = normalizeSystemMessageText(msg);
            if(typeof applyWorksheetTranslations === 'function') applyWorksheetTranslations(alertModal);
            window.lastSystemDialogFocus = document.activeElement;
            alertModal.style.display = 'flex';
            alertModal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('system-dialog-open');
            setTimeout(() => alertModal.querySelector('.system-dialog-primary')?.focus(), 50);
        }

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if(!modal) return;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            if(!Array.from(document.querySelectorAll('.system-dialog-overlay')).some(item => item.style.display === 'flex')) {
                document.body.classList.remove('system-dialog-open');
                const previousFocus = window.lastSystemDialogFocus;
                window.lastSystemDialogFocus = null;
                if(previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
            }
        }

        // --- Custom Toast Notification ---
        function showToast(msg, type = 'success') {
            let container = document.getElementById('toast-container');
            let toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
            toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
            const icon = document.createElement('span');
            icon.className = 'toast-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = type === 'error' ? '!' : type === 'info' ? 'i' : '✓';
            const copy = document.createElement('span');
            copy.className = 'toast-copy';
            copy.textContent = normalizeSystemMessageText(msg);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'toast-close';
            close.setAttribute('aria-label', 'Tutup');
            close.textContent = '×';
            close.addEventListener('click', () => toast.remove());
            const progress = document.createElement('span');
            progress.className = 'toast-progress';
            progress.setAttribute('aria-hidden', 'true');
            toast.append(icon, copy, close, progress);
            container.appendChild(toast);
            if(typeof applyWorksheetTranslations === 'function') applyWorksheetTranslations(toast);
            toast.addEventListener('mouseenter', () => toast.style.animationPlayState = 'paused');
            toast.addEventListener('mouseleave', () => toast.style.animationPlayState = 'running');
            setTimeout(() => { if(toast.isConnected) toast.remove(); }, 5100);
        }

        // --- Helper Section Toggles ---
        function toggleSection(id, headerEl) {
            let el = document.getElementById(id);
            let icon = headerEl.querySelector('.toggle-icon');
            if(el.style.display === 'none') {
                el.style.display = 'block';
                icon.innerText = '▼ Perkecil';
            } else {
                el.style.display = 'none';
                icon.innerText = '▶ Perluas';
            }
        }

        // --- Global Shortcut Keydown ---
        document.addEventListener('keydown', function(e) {
            if (e.shiftKey && e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                let tag = e.target.tagName.toLowerCase();
                if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                    e.preventDefault();
                    saveDataToLocal();
                    showToast('✅ Perubahan baru disimpan; data yang tidak berubah dilewati. (Shift+S)', 'success');
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                let saved = false;

                // --- BYPASS: PRIORITASKAN MODAL ADJUSTMENT DULU JIKA TERBUKA ---
                let modalAdjust = document.getElementById('modal-add-adjust');
                if(modalAdjust && modalAdjust.style.display === 'flex') { 
                    executeAddAdjust(); 
                    saved = true; 
                }
                else if(document.getElementById('modal-doc').style.display === 'flex') { saveDocModal(); saved = true; }
                else if(document.getElementById('modal-status').style.display === 'flex') { saveStatus(); saved = true; }
                // claim-input tidak lagi ada di navigasi, tetapi masih menjadi
                // layar aktif saat pengguna membuka klaim lama berformat jurnal.
                else if(window.currentOpenMenu === 'claim-input' && !document.getElementById('btn-save-rekap').disabled && document.getElementById('btn-save-rekap').style.display !== 'none') { saveRekap(); saved = true; }
                else if(window.currentOpenMenu === 'claim-quick' && !document.getElementById('btn-save-quick').disabled && document.getElementById('btn-save-quick').style.display !== 'none') { saveQuickRekap(); saved = true; }
                // TANGKAPAN BARU: Shortcut Ctrl+S untuk otomatis Save Draft di Modul Detail
                else if(window.currentOpenMenu === 'claim-detail' && currentDetailClaimId) { saveDetailData('Draft'); saved = true; }
                else if(window.currentOpenMenu === 'master-gl') { saveGLMaster(); saved = true; }
                else if(window.currentOpenMenu === 'master-karyawan') { saveKaryawan(); saved = true; }
                
                if(!saved) showToast('Tidak ada data aktif untuk disimpan pada menu ini.', 'info');
            }

            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay').forEach(el => {
                    if(el.style.display === 'flex') closeModal(el.id);
                });
                closeExcelFilter();
                if(window.innerWidth <= 850) closeMobileSidebar();
            }
            if (e.key === 'Enter') {
                let alertOverlay = document.getElementById('custom-alert');
                let confirmOverlay = document.getElementById('custom-confirm');
                let glOverlay = document.getElementById('gl-autocomplete-overlay');
                
                if(glOverlay && glOverlay.style.display === 'block') return;

                if (alertOverlay && alertOverlay.style.display === 'flex') {
                    e.preventDefault(); // Stop double-trigger
                    closeModal('custom-alert');
                } else if (confirmOverlay && confirmOverlay.style.display === 'flex') {
                    e.preventDefault(); // Stop double-trigger
                    execConfirm();
                }
            }
        });

        // --- Get Today Format ---
        function getTodayString() {
            let t = new Date();
            return String(t.getDate()).padStart(2,'0') + '/' + String(t.getMonth()+1).padStart(2,'0') + '/' + t.getFullYear();
        }

        window.applyClaimPeriodPreset = function(module, preset) {
            const modules = {
                rekap: { inputId:'filter-date-rekap', presetId:'preset-period-rekap', targetKey:'filterDatesRekap', render:() => { if(typeof rekapCurrentPage !== 'undefined') rekapCurrentPage = 1; if(typeof renderRekapTable === 'function') renderRekapTable(); } },
                'in-process': { inputId:'filter-date-in-process', presetId:'preset-period-in-process', targetKey:'filterDatesInProcess', render:() => { window.inProcessCurrentPage = 1; if(typeof renderInProcessTable === 'function') renderInProcessTable(); } },
                canceled: { inputId:'filter-date-canceled', presetId:'preset-period-canceled', targetKey:'filterDatesCanceled', render:() => { window.canceledCurrentPage = 1; if(typeof renderCanceledTable === 'function') renderCanceledTable(); } },
                history: { inputId:'filter-date-history', presetId:'preset-period-history', targetKey:'filterDatesHistory', render:() => { if(typeof histCurrentPage !== 'undefined') histCurrentPage = 1; if(typeof renderHistoryTable === 'function') renderHistoryTable(); } },
                waiting: { inputId:'filter-date-waiting', presetId:'preset-period-waiting', targetKey:'filterDatesWaiting', render:() => { window.waitingCurrentPage = 1; if(typeof renderWaitingTable === 'function') renderWaitingTable(); } },
                'catatan-detail': { inputId:'filter-date-catatan-detail', presetId:'preset-period-catatan-detail', targetKey:'filterDatesCatatanDetail', render:() => { window.catatanDetailCurrentPage = 1; if(typeof renderCatatanDetailTable === 'function') renderCatatanDetailTable(); } },
                'top-revisi': { inputId:'filter-revisi-statistik', presetId:'preset-period-top-revisi', targetKey:'filterDatesRevisi', render:() => { if(typeof renderTopRevisi === 'function') renderTopRevisi(); } },
                'ready-payment': { inputId:'filter-date-ready-payment', presetId:'preset-period-ready-payment', targetKey:'filterDatesReadyPayment', render:() => { window.readyPaymentCurrentPage = 1; if(typeof window.renderReadyPaymentTable === 'function') window.renderReadyPaymentTable(); } },
                'payment-paid': { inputId:'filter-date-payment-paid', presetId:'preset-period-payment-paid', targetKey:'filterDatesPaymentPaid', render:() => { window.paymentPaidCurrentPage = 1; if(typeof window.renderPaymentPaidTable === 'function') window.renderPaymentPaidTable(); } },
                'payment-hold': { inputId:'filter-date-payment-hold', presetId:'preset-period-payment-hold', targetKey:'filterDatesPaymentHold', render:() => { window.paymentHoldCurrentPage = 1; if(typeof window.renderPaymentHoldTable === 'function') window.renderPaymentHoldTable(); } },
                'payment-return': { inputId:'filter-date-payment-return', presetId:'preset-period-payment-return', targetKey:'filterDatesPaymentReturn', render:() => { window.paymentReturnCurrentPage = 1; if(typeof window.renderPaymentReturnTable === 'function') window.renderPaymentReturnTable(); } },
                'top-pengaju': { inputId:'filter-pengaju-statistik', presetId:'preset-period-top-pengaju', targetKey:'filterDatesPengaju', render:() => { if(typeof renderTopPengaju === 'function') renderTopPengaju(); } }
            };
            const config = modules[module];
            if(!config) return;
            const input = document.getElementById(config.inputId);
            const picker = input && input._flatpickr;
            const presetEl = document.getElementById(config.presetId);
            if(presetEl) presetEl.value = preset;

            if(preset === 'custom') {
                if(picker) picker.open();
                return;
            }

            const range = preset === 'all_time' ? null : (typeof getReportingPresetRange === 'function' ? getReportingPresetRange(preset) : null);
            window[config.targetKey] = range ? [new Date(range[0]), new Date(range[1])] : [];
            if(picker) {
                if(range) {
                    picker.setDate(window[config.targetKey], false);
                    // Kalender ikut melompat ke bulan periode yang dipilih; tanpa ini
                    // panelnya tetap membuka bulan terakhir yang dilihat pengguna.
                    if(typeof picker.jumpToDate === 'function') picker.jumpToDate(window[config.targetKey][0], false);
                } else picker.clear(false);
            }
            // Nilai <select> diubah lewat properti, bukan atribut, sehingga
            // MutationObserver pada select yang diperindah tidak ikut terpicu dan
            // label yang tampil akan tertinggal. Sinkronisasi dilakukan manual.
            if(typeof window.syncAllEnhancedSelects === 'function') window.syncAllEnhancedSelects();
            config.render();
        };

        // --- Login Logic ---
        window.onload = function() {
    if(window.worksheetOnloadStarted) return;
    window.worksheetOnloadStarted = true;
    let overlay = document.getElementById('login-overlay');
    window.fbOnAuthStateChanged(window.firebaseAuth, async (user) => {
        if (user) {
            currentFirebaseUser = user;
            sessionUser = user.email.split('@')[0];
            sessionRole = await resolveFirebaseRole(user);
            flushActivityLogOutbox().catch(error => console.error('[Activity Log] Flush login gagal:', error));

            // --- TAMBAHAN LOGIC AUTO LOGIN LOG ---
            if (!sessionStorage.getItem('activeUser')) {
                sessionStorage.setItem('activeUser', sessionUser);
                sessionStorage.setItem('activeRole', sessionRole);
                logActivity(sessionUser, 'Masuk Otomatis (Sesi Dipulihkan)').catch(() => {});
            }
            // ------------------------------------

            overlay.style.display = 'none';
            setupUIForUser();
            initApp().then(() => { loadFromCloud(); });
            updateClock();

            // Inisiasi Default Date (Bulan Ini) & Kalender
            let now = new Date();
            let firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            let lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            
            window.filterDatesStatistik = [firstDay, lastDay];
            window.filterDatesRevisi = [firstDay, lastDay];
            window.filterDatesPengaju = [firstDay, lastDay];
            window.filterDatesRekap = [firstDay, lastDay];
            window.filterDatesInProcess = [firstDay, lastDay];
            window.filterDatesCanceled = [firstDay, lastDay];
            window.filterDatesHistory = [firstDay, lastDay];
            window.filterDatesWaiting = [firstDay, lastDay];
            window.filterDatesPaymentPaid = [];

            // Setup Konfigurasi Modern untuk Semua Kalender Tabel
            ['#qk-tgl-proses', '#qk-tgl-submit', '#qk-hardcopy-date', '#hdr-tgl-proses', '#hdr-tgl-submit']
                .forEach(sel => window.attachFormDatePicker(sel));

            const modernConfig = {
                mode: "range", dateFormat: "Y-m-d", altInput: true, altFormat: "d M Y",
                altInputClass: "modern-flatpickr-input",
                locale: {
                    rangeSeparator: " ➔ ",
                    months: {
                        shorthand: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
                        longhand: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
                    }
                }
            };

            if(document.getElementById('filter-date-statistik')) ensureWorksheetCalendar("#filter-date-statistik", { 
                ...modernConfig, 
                defaultDate: [firstDay, lastDay], 
                onChange: function(selectedDates, dateStr, instance) { 
                    window.filterDatesStatistik = selectedDates; 
                    
                    let presetSel = document.getElementById('preset-statistik');
                    // Kalau user klik manual langsung dari kalender yang lagi kebuka, ganti dropdown ke 'custom'
                    if (presetSel && instance.isOpen) {
                        presetSel.value = 'custom';
                    }
                    
                    if(typeof renderStatistikData === 'function') renderStatistikData(); 
                }
            });
            if(document.getElementById('filter-revisi-statistik')) ensureWorksheetCalendar("#filter-revisi-statistik", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesRevisi = selectedDates; let preset = document.getElementById('preset-period-top-revisi'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderTopRevisi === 'function') renderTopRevisi(); }});
            if(document.getElementById('filter-pengaju-statistik')) ensureWorksheetCalendar("#filter-pengaju-statistik", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesPengaju = selectedDates; let preset = document.getElementById('preset-period-top-pengaju'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderTopPengaju === 'function') renderTopPengaju(); }});
            
            if(document.getElementById('filter-date-rekap')) ensureWorksheetCalendar("#filter-date-rekap", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesRekap = selectedDates; resetModulePagination('rekap'); let preset = document.getElementById('preset-period-rekap'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderRekapTable === 'function') renderRekapTable(); }});
            if(document.getElementById('filter-date-in-process')) ensureWorksheetCalendar("#filter-date-in-process", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesInProcess = selectedDates; resetModulePagination('in-process'); let preset = document.getElementById('preset-period-in-process'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderInProcessTable === 'function') renderInProcessTable(); }});
            if(document.getElementById('filter-date-canceled')) ensureWorksheetCalendar("#filter-date-canceled", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesCanceled = selectedDates; resetModulePagination('canceled'); let preset = document.getElementById('preset-period-canceled'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderCanceledTable === 'function') renderCanceledTable(); }});
            if(document.getElementById('filter-date-history')) ensureWorksheetCalendar("#filter-date-history", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesHistory = selectedDates; resetModulePagination('history'); let preset = document.getElementById('preset-period-history'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderHistoryTable === 'function') renderHistoryTable(); }});
            if(document.getElementById('filter-date-waiting')) ensureWorksheetCalendar("#filter-date-waiting", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesWaiting = selectedDates; resetModulePagination('waiting'); let preset = document.getElementById('preset-period-waiting'); if(preset && instance.isOpen) preset.value = 'custom'; if(typeof renderWaitingTable === 'function') window.renderWaitingTable(); }});
            // Kalender Data Payment sengaja tidak diberi defaultDate:
            // keempat halamannya dibuka pada Semua Periode, lalu pengguna dapat
            // mempersempit rentang tanggal bila diperlukan.
            [['#filter-date-ready-payment','filterDatesReadyPayment','ready-payment'],
             ['#filter-date-payment-paid','filterDatesPaymentPaid','payment-paid'],
             ['#filter-date-payment-hold','filterDatesPaymentHold','payment-hold'],
             ['#filter-date-payment-return','filterDatesPaymentReturn','payment-return']].forEach(([selector, stateKey, modul]) => {
                if(!document.querySelector(selector)) return;
                ensureWorksheetCalendar(selector, { ...modernConfig, onChange: function(selectedDates, dateStr, instance) {
                    window[stateKey] = selectedDates;
                    resetModulePagination(modul);
                    const preset = document.getElementById('preset-period-' + modul);
                    if(preset && instance.isOpen) preset.value = 'custom';
                    if(typeof refreshModuleTable === 'function') refreshModuleTable(modul);
                }});
            });
            window.filterDatesExec = [firstDay, lastDay];
            if(document.getElementById('filter-date-exec')) ensureWorksheetCalendar("#filter-date-exec", { ...modernConfig, defaultDate: [firstDay, lastDay], onChange: function(selectedDates, dateStr, instance) { window.filterDatesExec = selectedDates; let p = document.getElementById('preset-exec'); if(p && instance.isOpen) p.value = 'custom'; if(typeof renderExecutiveDashboard === 'function') renderExecutiveDashboard(); }});
        } else {
            // Logout manual berakhir dengan reload. Jangan munculkan login overlay
            // di tengah signOut karena menghasilkan kedip sebelum reload selesai.
            if(logoutInProgress) return;
            setLoginBusy(false);
            overlay.style.display = 'flex';
            document.getElementById('login-user').focus();
        }
    });
};

        function setLoginBusy(isBusy) {
            const button = document.getElementById('login-submit');
            if(!button) return;
            button.disabled = !!isBusy;
            button.classList.toggle('is-loading', !!isBusy);
            button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
            const label = button.querySelector('.login-submit-label');
            if(label) label.textContent = translateUiText(isBusy ? 'Memproses...' : 'Masuk');
        }

        function toggleLoginPassword() {
            const input = document.getElementById('login-pass');
            const button = document.querySelector('.login-password-toggle');
            if(!input || !button) return;
            const willShow = input.type === 'password';
            input.type = willShow ? 'text' : 'password';
            const label = translateUiText(willShow ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.textContent = willShow ? '◌' : '◉';
            input.focus();
        }
        window.toggleLoginPassword = toggleLoginPassword;

        function doLogin() {
            const usernameInput = document.getElementById('login-user');
            const passwordInput = document.getElementById('login-pass');
            const button = document.getElementById('login-submit');
            const u = usernameInput.value.trim();
            const p = passwordInput.value.trim();

            if(button && button.disabled) return;
            if(!u || !p) {
                showToast('Nama pengguna dan kata sandi wajib diisi.', 'error');
                (u ? passwordInput : usernameInput).focus();
                return;
            }
            setLoginBusy(true);

            const emailLogin = getInternalLoginEmail(u);
            window.fbSignIn(window.firebaseAuth, emailLogin, p)
            .then((userCredential) => {
                const username = userCredential.user.email.split('@')[0];
                showToast(`Berhasil masuk. Akses untuk ${username} sedang disiapkan.`, 'success');
            })
            .catch(() => {
                showToast('Nama pengguna atau kata sandi tidak sesuai.', 'error');
                passwordInput.select();
            })
            .finally(() => setLoginBusy(false));
        }
        function setupUIForUser() {
            const roleLabel = ({ accounting:'ACCOUNTING', finance:'FINANCE', viewer:'VIEWER', admin:'ADMIN' }[sessionRole] || String(sessionRole || 'VIEWER').toUpperCase());
            document.getElementById('logged-in-user').innerText = sessionUser;
            document.getElementById('logged-in-role').innerText = roleLabel;
            const heroRole = document.getElementById('home-hero-role');
            if(heroRole) heroRole.innerText = roleLabel;
            
            if(sessionRole === 'admin') {
                document.getElementById('nav-master-user').style.display = 'flex';
                const contentNav = document.getElementById('nav-master-content'); if(contentNav) contentNav.style.display = 'flex';
                document.getElementById('dash-card-user').style.display = 'block';
                
                document.getElementById('gl-admin-actions').style.display = 'block';
                document.getElementById('btn-del-gl').style.display = 'inline-block';
                
                document.getElementById('kar-admin-actions').style.display = 'block';
                document.getElementById('btn-del-kar').style.display = 'inline-block';
            } else {
                document.getElementById('nav-master-user').style.display = 'none';
                const contentNav = document.getElementById('nav-master-content'); if(contentNav) contentNav.style.display = 'none';
                document.getElementById('dash-card-user').style.display = 'none';

                document.getElementById('gl-admin-actions').style.display = 'none';
                document.getElementById('btn-del-gl').style.display = 'none';

                document.getElementById('kar-admin-actions').style.display = 'none';
                document.getElementById('btn-del-kar').style.display = 'none';
            }

            const viewerMode = sessionRole === 'viewer';
            const financeMode = sessionRole === 'finance';
            document.body.classList.toggle('viewer-mode', viewerMode);
            document.body.classList.toggle('finance-mode', financeMode);
            document.body.classList.toggle('read-only-mode', isReadOnlyRole());
            if(viewerMode) {
                window.menuHistoryStack = [];
                document.querySelectorAll('.nav-menu > .nav-item, .nav-menu > .nav-sub-container').forEach(el => {
                    el.setAttribute('aria-hidden', el.id === 'nav-super-find' ? 'false' : 'true');
                });
            } else {
                // Finance memakai navigasi penuh seperti Accounting; pembatasannya
                // ada pada aksi tulis, bukan pada daftar menu.
                document.querySelectorAll('.nav-menu > .nav-item, .nav-menu > .nav-sub-container, .nav-sub-item').forEach(el => el.removeAttribute('aria-hidden'));
            }
            ['btn-save-rekap','btn-save-quick','btn-add-row','btn-qk-add-adjust','btn-add-adjust'].forEach(id => {
                let el = document.getElementById(id);
                if (el) el.style.display = isReadOnlyRole() ? 'none' : '';
            });
            document.querySelectorAll('.write-action').forEach(el => {
                el.style.display = isReadOnlyRole() ? 'none' : '';
            });
            document.querySelectorAll('[data-read-only-notice]').forEach(el => {
                el.style.display = isReadOnlyRole() ? 'flex' : 'none';
            });
            if(typeof window.applyReadOnlyFormLock === 'function') window.applyReadOnlyFormLock();
            document.querySelectorAll('[data-finance-queue-summary]').forEach(el => {
                el.style.display = canManageFinanceWorkflow() ? 'grid' : 'none';
            });
            // Kontrol khusus workflow Finance (termasuk Bulk Payment) hanya
            // terlihat untuk Finance/Admin. Accounting tetap dapat membaca
            // halaman Data Payment tanpa mendapat aksi pembayaran.
            document.querySelectorAll('.finance-only-action, .finance-only-column').forEach(el => {
                el.style.display = canManageFinanceWorkflow() ? '' : 'none';
            });
            document.querySelectorAll('.admin-only-action').forEach(el => {
                el.style.display = isAppAdmin() ? '' : 'none';
            });
            if(isAppAdmin()) subscribeRoleDirectory();
        }

        // Layar entri data tetap dapat dibuka oleh Finance/Viewer untuk membaca,
        // tetapi seluruh kontrolnya dikunci supaya tidak ada perubahan yang bisa
        // diketik. Penyimpanan sendiri sudah dijaga requireClaimEditor().
        const READ_ONLY_FORM_SCOPES = ['#menu-claim-input', '#menu-claim-quick', '#menu-claim-detail', '#menu-claim-excel-v2', '#menu-master-gl', '#menu-master-karyawan', '#menu-master-calendar', '#menu-master-backup'];
        function applyReadOnlyFormLock() {
            const lock = isReadOnlyRole();
            READ_ONLY_FORM_SCOPES.forEach(scope => {
                const root = document.querySelector(scope);
                if(!root) return;
                // Finance boleh mengisi formulir saat membuat claim BARU. Claim
                // yang sudah tersimpan tetap terkunci seperti sebelumnya.
                const scopeLock = scope === '#menu-claim-quick' && isFinanceRole() && currentEditingId === null ? false : lock;
                root.querySelectorAll('input, select, textarea').forEach(field => {
                    // Kolom filter/pencarian tetap hidup supaya data masih bisa ditelusuri.
                    if(field.closest('.list-toolbar, .header-panel, .pagination-container')) return;
                    if(field.dataset.readOnlyExempt === 'true') return;
                    field.disabled = scopeLock;
                });
            });
            document.querySelectorAll('.content-card [contenteditable="true"]').forEach(cell => {
                if(lock) cell.setAttribute('contenteditable', 'false');
            });
        }
        window.applyReadOnlyFormLock = applyReadOnlyFormLock;

        function openChangePasswordModal() {
            if(!currentFirebaseUser) return showToast('Sesi pengguna belum siap.', 'error');
            ['change-password-current','change-password-new','change-password-confirm'].forEach(id => {
                const el = document.getElementById(id);
                if(!el) return;
                el.value = '';
                el.type = 'password';
            });
            document.querySelectorAll('#modal-change-password .password-reveal').forEach(button => {
                button.classList.remove('is-visible');
                button.setAttribute('aria-pressed', 'false');
                button.setAttribute('aria-label', translateUiText('Tampilkan password'));
            });
            const account = document.getElementById('change-password-account');
            if(account) account.textContent = getShortUsername(currentFirebaseUser.email || sessionUser || '-');
            updatePasswordFormState();
            document.getElementById('modal-change-password').style.display = 'flex';
            setTimeout(() => document.getElementById('change-password-current')?.focus(), 50);
        }
        window.openChangePasswordModal = openChangePasswordModal;

        function togglePasswordField(inputId, button) {
            const input = document.getElementById(inputId);
            if(!input) return;
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            if(button) {
                button.classList.toggle('is-visible', reveal);
                button.setAttribute('aria-pressed', reveal ? 'true' : 'false');
                button.setAttribute('aria-label', translateUiText(reveal ? 'Sembunyikan password' : 'Tampilkan password'));
            }
            input.focus();
        }
        window.togglePasswordField = togglePasswordField;

        // Kekuatan password dinilai dari panjang dan ragam karakter, bukan sekadar
        // panjang, supaya "12345678" tidak terbaca sekuat "R4hasia!2026".
        function scorePasswordStrength(value) {
            const password = String(value || '');
            if(!password) return { level: 0, label: 'Kekuatan password akan tampil di sini.' };
            let score = 0;
            if(password.length >= 8) score++;
            if(password.length >= 12) score++;
            if(/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
            if(/\d/.test(password)) score++;
            if(/[^A-Za-z0-9]/.test(password)) score++;
            if(password.length < 8) return { level: 1, label: 'Terlalu pendek — minimal 8 karakter.' };
            if(score <= 2) return { level: 1, label: 'Lemah — tambahkan huruf besar, angka, atau simbol.' };
            if(score === 3) return { level: 2, label: 'Cukup — masih bisa diperkuat.' };
            if(score === 4) return { level: 3, label: 'Kuat.' };
            return { level: 4, label: 'Sangat kuat.' };
        }
        window.scorePasswordStrength = scorePasswordStrength;

        function updatePasswordFormState() {
            const current = String(document.getElementById('change-password-current')?.value || '');
            const next = String(document.getElementById('change-password-new')?.value || '');
            const confirm = String(document.getElementById('change-password-confirm')?.value || '');
            const rules = {
                length: next.length >= 8,
                different: next.length > 0 && next !== current,
                match: confirm.length > 0 && confirm === next
            };
            Object.entries(rules).forEach(([rule, passed]) => {
                const item = document.querySelector(`#password-rules li[data-rule="${rule}"]`);
                if(!item) return;
                item.classList.toggle('is-passed', passed);
                const mark = item.querySelector('.password-rule-mark');
                if(mark) mark.textContent = passed ? '✓' : '○';
            });

            const strength = scorePasswordStrength(next);
            const fill = document.getElementById('password-meter-fill');
            const label = document.getElementById('password-meter-label');
            if(fill) fill.dataset.level = String(strength.level);
            if(label) label.textContent = translateUiText(strength.label);

            const button = document.getElementById('btn-change-password');
            if(button && !button.dataset.busy) button.disabled = !(current.length > 0 && rules.length && rules.different && rules.match);
        }
        window.updatePasswordFormState = updatePasswordFormState;

        async function changeCurrentUserPassword() {
            if(!currentFirebaseUser || !window.fbUpdatePassword || !window.fbReauthenticateWithCredential || !window.fbEmailAuthProvider) return showToast('Fitur ubah password belum siap.', 'error');
            const currentPassword = String(document.getElementById('change-password-current')?.value || '');
            const nextPassword = String(document.getElementById('change-password-new')?.value || '');
            const confirmPassword = String(document.getElementById('change-password-confirm')?.value || '');
            if(!currentPassword || nextPassword.length < 8) return showToast('Password saat ini wajib diisi dan password baru minimal 8 karakter.', 'error');
            if(nextPassword !== confirmPassword) return showToast('Konfirmasi password baru tidak sama.', 'error');
            if(currentPassword === nextPassword) return showToast('Password baru harus berbeda dari password saat ini.', 'error');
            const button = document.getElementById('btn-change-password');
            const oldText = button ? button.innerText : '';
            if(button) { button.dataset.busy = 'true'; button.disabled = true; button.innerText = translateUiText('Menyimpan...'); }
            try {
                const credential = window.fbEmailAuthProvider.credential(currentFirebaseUser.email, currentPassword);
                await window.fbReauthenticateWithCredential(currentFirebaseUser, credential);
                await window.fbUpdatePassword(currentFirebaseUser, nextPassword);
                logActivity(sessionUser, 'Pengguna mengubah password akun', { category:'access' }).catch(() => {});
                closeModal('modal-change-password');
                showToast('Password berhasil diubah.', 'success');
            } catch(error) {
                console.error('[Password] Gagal mengubah password:', error);
                const code = String(error && error.code || '');
                if(code.includes('invalid-credential') || code.includes('wrong-password')) showToast('Password saat ini tidak sesuai.', 'error');
                else if(code.includes('weak-password')) showToast('Password baru terlalu lemah.', 'error');
                else showToast('Password gagal diubah. Silakan login ulang lalu coba kembali.', 'error');
            } finally { if(button) { delete button.dataset.busy; button.innerText = oldText || translateUiText('Simpan Password'); } updatePasswordFormState(); }
        }
        window.changeCurrentUserPassword = changeCurrentUserPassword;

        function doLogout() {
    customConfirm('Apakah Anda yakin ingin keluar dari sistem?', async () => {
        if(logoutInProgress) return;
        logoutInProgress = true;
        const loader = document.getElementById('loader-overlay');
        const loaderText = document.getElementById('loader-text');
        if(loaderText) loaderText.textContent = 'Keluar dari sistem...';
        if(loader) loader.style.display = 'flex';
        try {
            await logActivity(sessionUser, 'Keluar dari Aplikasi').catch(() => {});
            await window.fbSignOut(window.firebaseAuth);
            sessionStorage.clear();
            location.reload();
        } catch(error) {
            console.error('[Auth] Logout gagal:', error);
            logoutInProgress = false;
            if(loader) loader.style.display = 'none';
            showToast('Gagal keluar dari sistem. Silakan coba kembali.', 'error');
        }
    });
}

        // --- User Management (Admin Only) ---
        let editUserIdx = null;

        function renderMasterUser() {
            let tbody = document.getElementById('tbody-master-user'); tbody.innerHTML = '';
            if (!Array.isArray(masterUsers) || masterUsers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">Belum terdapat data peran. Buat peran berdasarkan Firebase UID.</td></tr>';
                renderActivityLogs();
                return;
            }
            masterUsers.forEach((u, idx) => {
                let isCurrentUser = currentFirebaseUser && u.uid === currentFirebaseUser.uid;
                let disableCheckbox = isCurrentUser ? 'disabled' : '';
                let displayRole = normalizeAppRole(u.role);
                let roleBadgeClass = displayRole === 'admin' ? 'status-posted' : (displayRole === 'finance' ? 'status-paid' : (displayRole === 'viewer' ? 'status-waiting' : 'status-process'));
                
                tbody.innerHTML += `<tr>
                    <td><input type="checkbox" class="user-checkbox" data-idx="${idx}" ${disableCheckbox}></td>
                    <td><button class="btn-icon" onclick="editUser(${idx})" title="Ubah">✏️</button></td>
                    <td><strong>${getShortUsernameHtml(u.username || u.email)}</strong>${isCurrentUser ? '<br><small>(akun aktif)</small>' : ''}</td>
                    <td style="color:#666; font-family:monospace; font-size:11px; word-break:break-all;">${u.uid}</td>
                    <td><span class="badge ${roleBadgeClass}">${String(displayRole || 'viewer').toUpperCase()}</span></td>
                </tr>`;
            });
            renderActivityLogs();
        }

function escapeActivityLogText(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getActivityLogCategoryIcon(category) {
    return ACTIVITY_CATEGORY_ICONS[category] || ACTIVITY_CATEGORY_ICONS.system;
}

function getActivityLogInitial(value) {
    const name = getShortUsername(value || 'Sistem');
    return String(name || 'S').trim().charAt(0).toUpperCase() || 'S';
}

function updateActivityLogMetrics(logs = activityLogs) {
    const rows = Array.isArray(logs) ? logs : [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let today = 0, synced = 0, attention = 0;
    rows.forEach(log => {
        if(Number(log && log.ts) >= todayStart.getTime()) today++;
        const meta = getActivityLogMeta(log);
        if(meta.syncKey === 'synced') synced++;
        else attention++;
    });
    const put = (id, value) => { const el = document.getElementById(id); if(el) el.textContent = String(value); };
    put('activity-metric-total', rows.length);
    put('activity-metric-today', today);
    put('activity-metric-synced', synced);
    put('activity-metric-attention', attention);
}

function updateActivityLogFilterSummary(filteredCount, totalCount) {
    const el = document.getElementById('activity-log-filter-summary');
    if(!el) return;
    if(filteredCount === totalCount) {
        el.textContent = typeof translateUiText === 'function' ? translateUiText('Semua log ditampilkan') : 'Semua log ditampilkan';
        return;
    }
    const language = typeof window.getWorksheetLanguage === 'function' ? window.getWorksheetLanguage() : 'id';
    el.textContent = language === 'en'
        ? `${filteredCount} of ${totalCount} logs match the filters`
        : (language === 'ja' ? `${totalCount}件中${filteredCount}件がフィルターに一致` : `${filteredCount} dari ${totalCount} log sesuai filter`);
}

function resetActivityLogFilters() {
    const search = document.getElementById('activity-log-search');
    const role = document.getElementById('activity-log-role-filter');
    const category = document.getElementById('activity-log-category-filter');
    const sync = document.getElementById('activity-log-sync-filter');
    if(search) search.value = '';
    if(role) role.value = 'all';
    if(category) category.value = 'all';
    if(sync) sync.value = 'all';
    activityLogCurrentPage = 1;
    renderActivityLogs();
}
window.resetActivityLogFilters = resetActivityLogFilters;

function renderActivityLogs() {
    let tbody = document.getElementById('tbody-activity-logs');
    if(!tbody || !isAppAdmin()) return;
    tbody.innerHTML = '';
    updateActivityLogMetrics(activityLogs);

    if (!Array.isArray(activityLogs) || activityLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="activity-log-empty"><span>◎</span><strong>Belum ada log aktivitas</strong><small>Aktivitas sistem akan tampil di sini setelah tercatat.</small></div></td></tr>';
        updateActivityLogFilterSummary(0, 0);
        updateActivityLogPagination(0, 1);
        return;
    }

    const keyword = String(document.getElementById('activity-log-search') && document.getElementById('activity-log-search').value || '').trim().toLowerCase();
    const roleFilter = String(document.getElementById('activity-log-role-filter') && document.getElementById('activity-log-role-filter').value || 'all');
    const categoryFilter = String(document.getElementById('activity-log-category-filter') && document.getElementById('activity-log-category-filter').value || 'all');
    const syncFilter = String(document.getElementById('activity-log-sync-filter') && document.getElementById('activity-log-sync-filter').value || 'all');
    const filtered = activityLogs.filter(log => {
        const meta = getActivityLogMeta(log);
        const role = normalizeAppRole(log && log.actorRole || 'unknown');
        if(roleFilter !== 'all' && role !== roleFilter) return false;
        if(categoryFilter !== 'all' && meta.category !== categoryFilter) return false;
        if(syncFilter !== 'all' && meta.syncKey !== syncFilter) return false;
        if(!keyword) return true;
        const haystack = [log.time, getShortUsername(log.user), role, meta.rawAction, meta.claimId, meta.claimNo, meta.claimName, meta.categoryLabel, meta.eventId].join(' ').toLowerCase();
        return haystack.includes(keyword);
    });
    updateActivityLogFilterSummary(filtered.length, activityLogs.length);

    const totalPages = Math.max(1, Math.ceil(filtered.length / activityLogRowsPerPage));
    activityLogCurrentPage = Math.min(Math.max(1, activityLogCurrentPage), totalPages);
    const start = (activityLogCurrentPage - 1) * activityLogRowsPerPage;
    const pageRows = filtered.slice(start, start + activityLogRowsPerPage);

    if(!pageRows.length) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="activity-log-empty"><span>⌕</span><strong>Tidak ada hasil</strong><small>Coba ubah kata kunci atau filter yang digunakan.</small></div></td></tr>';
    }

    pageRows.forEach(log => {
        const meta = getActivityLogMeta(log);
        const eventId = escapeActivityLogText(meta.eventId);
        const username = getShortUsername(log.user || 'Sistem');
        const role = normalizeAppRole(log.actorRole || 'unknown');
        const categoryIcon = escapeActivityLogText(getActivityLogCategoryIcon(meta.category));
        const claimHint = meta.claimId
            ? `<div class="activity-claim-chip"><span>▤</span>Klaim ${escapeActivityLogText(meta.claimNo !== '-' ? meta.claimNo : meta.claimId)}${meta.claim ? '' : ' · data tidak tersedia'}</div>`
            : '';
        tbody.innerHTML += `<tr class="activity-log-row" data-category="${escapeActivityLogText(meta.category)}">
            <td class="activity-time-cell"><span class="activity-time-mark" aria-hidden="true">◷</span><span>${escapeActivityLogText(log.time || '-')}</span></td>
            <td><div class="activity-user-cell"><span class="activity-user-avatar">${escapeActivityLogText(getActivityLogInitial(username))}</span><div><strong>${escapeActivityLogText(username)}</strong><small>${escapeActivityLogText(role)}</small></div></div></td>
            <td><span class="activity-category-badge category-${escapeActivityLogText(meta.category)}"><span aria-hidden="true">${categoryIcon}</span>${escapeActivityLogText(meta.categoryLabel)}</span></td>
            <td><div class="activity-action-cell"><span>${escapeActivityLogText(meta.rawAction)}</span>${claimHint}</div></td>
            <td><span class="activity-sync-badge ${meta.syncKey}">${meta.syncKey === 'synced' ? '✓' : (meta.syncKey === 'pending' ? '↻' : '•')} ${escapeActivityLogText(meta.syncLabel)}</span></td>
            <td class="activity-log-action-cell"><button type="button" class="activity-detail-button" data-event-id="${eventId}" onclick="openActivityLogDetail(this.dataset.eventId)"><span>Detail</span><b aria-hidden="true">→</b></button></td>
        </tr>`;
    });
    updateActivityLogPagination(filtered.length, totalPages);
}

function updateActivityLogPagination(totalRows, totalPages) {
    const info = document.getElementById('activity-log-page-info');
    const prev = document.getElementById('activity-log-prev');
    const next = document.getElementById('activity-log-next');
    if(info) info.innerText = totalRows ? `Halaman ${activityLogCurrentPage}/${totalPages} · ${totalRows} log` : '0 data';
    if(prev) prev.disabled = activityLogCurrentPage <= 1;
    if(next) next.disabled = activityLogCurrentPage >= totalPages;
}

function resetActivityLogPage() { activityLogCurrentPage = 1; }
function changeActivityLogRows() {
    const select = document.getElementById('activity-log-rows');
    activityLogRowsPerPage = Math.max(25, Number(select && select.value) || 50);
    activityLogCurrentPage = 1;
    renderActivityLogs();
}
function prevActivityLogPage() { if(activityLogCurrentPage > 1) activityLogCurrentPage--; renderActivityLogs(); }
function nextActivityLogPage() { activityLogCurrentPage++; renderActivityLogs(); }

function openActivityLogDetail(eventId) {
    if(!requireAdmin()) return;
    const log = mergeActivityLogRows(activityLogs, activityLogOutbox).find(entry => String(entry && (entry.eventId || entry.id)) === String(eventId));
    if(!log) return showToast('Detail log aktivitas tidak ditemukan.', 'error');
    const meta = getActivityLogMeta(log);
    const putText = (id, value) => { const element = document.getElementById(id); if(element) element.textContent = String(value === null || value === undefined || value === '' ? '-' : value); };
    putText('activity-detail-time', log.time || '-');
    putText('activity-detail-user', getShortUsername(log.user || 'Sistem'));
    putText('activity-detail-role', normalizeAppRole(log.actorRole || 'unknown').toUpperCase());
    putText('activity-detail-category', meta.categoryLabel);
    putText('activity-detail-category-icon', getActivityLogCategoryIcon(meta.category));
    putText('activity-detail-sync', meta.syncLabel);
    putText('activity-detail-outcome', log.outcome === 'success' ? 'Berhasil' : (log.outcome || 'Tercatat'));
    putText('activity-detail-source', log.source === 'application' ? 'Aplikasi Worksheet' : (log.source || 'Tidak diketahui'));
    putText('activity-detail-action', meta.rawAction);
    putText('activity-detail-event-id', meta.eventId || '-');

    const claimBox = document.getElementById('activity-detail-claim');
    const openButton = document.getElementById('activity-detail-open-claim');
    if(meta.claimId) {
        claimBox.style.display = 'flex';
        putText('activity-detail-claim-label', meta.claimNo !== '-' ? `${meta.claimNo} · ID ${meta.claimId}` : `ID ${meta.claimId}`);
        putText('activity-detail-claim-state', meta.claim ? `${meta.claim.nama || '-'} · ${meta.claim.statusClaim || '-'}` : 'Data klaim telah dihapus atau tidak tersedia pada cache.');
        openButton.disabled = !meta.claim;
        openButton.onclick = meta.claim ? () => { closeModal('modal-activity-log-detail'); openEditRoute(meta.claimId, true); } : null;
    } else {
        claimBox.style.display = 'none';
        openButton.onclick = null;
    }
    document.getElementById('modal-activity-log-detail').style.display = 'flex';
}
        async function saveUser() {
            if (!requireAdmin()) return;
            let username = getShortUsername(document.getElementById('new-user-name').value).toLowerCase();
            let email = getInternalLoginEmail(username);
            let uid = document.getElementById('new-user-pass').value.trim();
            let role = document.getElementById('new-user-role').value;

            if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username) || !uid || !VALID_APP_ROLES.includes(role)) {
                return showToast('Nama pengguna (minimal dua karakter), Firebase UID, dan peran wajib valid.', 'error');
            }
            if (!window.firebaseDb || !window.fbDoc || !window.fbSetDoc) return showToast('Firebase belum siap.', 'error');

            try {
                const writeRole = () => window.fbSetDoc(window.fbDoc(window.firebaseDb, 'userRoles', uid), {
                    username, email, role, updatedBy: sessionUser, updatedAtMs: Date.now()
                }, { merge: true });
                if(typeof window.runTrackedDataUpdate === 'function') await window.runTrackedDataUpdate('Menyimpan Peran Pengguna', writeRole);
                else await writeRole();
                logActivity(sessionUser, `Pembaruan Peran Firebase: ${username} → ${role}`);
                editUserIdx = null;
                document.getElementById('new-user-name').value = '';
                document.getElementById('new-user-pass').value = '';
                document.getElementById('btn-save-user').innerText = '💾 Simpan Peran';
                showToast('Peran pengguna berhasil disimpan.', 'success');
            } catch (error) {
                console.error('[Role] Gagal menyimpan role:', error);
                showToast('Peran gagal disimpan. Pastikan akun yang aktif memiliki peran Admin.', 'error');
            }
        }

        function editUser(idx) {
            let u = masterUsers[idx];
            document.getElementById('new-user-name').value = getShortUsername(u.username || u.email);
            document.getElementById('new-user-pass').value = u.uid || '';
            document.getElementById('new-user-role').value = u.role;
            
            editUserIdx = idx;
            document.getElementById('btn-save-user').innerText = '✔️ Perbarui';
            document.getElementById('btn-save-user').classList.replace('btn-primary', 'btn-success');
        }

        function bulkDeleteUser() {
            if (!requireAdmin()) return;
            let checked = Array.from(document.querySelectorAll('.user-checkbox:checked'))
                               .map(cb => parseInt(cb.getAttribute('data-idx')))
                               .sort((a,b) => b-a);
                               
            if(checked.length) {
                customConfirm('Apakah Anda yakin ingin menghapus peran yang dipilih? Akun Firebase tidak akan dihapus, tetapi aksesnya akan kembali menjadi Viewer (hanya baca).', async () => {
                    const progressId = typeof window.startGlobalDataProgress === 'function'
                        ? window.startGlobalDataProgress('Menghapus Peran Pengguna', `0 dari ${checked.length} peran diproses...`)
                        : 0;
                    try {
                        for (const [position, idx] of checked.entries()) {
                            const userRole = masterUsers[idx];
                            if (!userRole || !userRole.uid) continue;
                            await window.fbDeleteDoc(window.fbDoc(window.firebaseDb, 'userRoles', userRole.uid));
                            logActivity(sessionUser, `Penghapusan Peran Firebase: ${getShortUsername(userRole.username || userRole.email || userRole.uid)}`);
                            if(progressId) window.updateGlobalDataProgress(progressId, ((position + 1) / checked.length) * 100, 'Menghapus Peran Pengguna', `${position + 1} dari ${checked.length} peran diproses...`);
                        }
                        if(progressId) window.finishGlobalDataProgress(progressId, 'Peran pengguna telah diperbarui', `${checked.length} peran selesai diproses.`);
                        showToast('Peran pengguna berhasil dihapus.', 'success');
                    } catch (error) {
                        if(progressId) window.failGlobalDataProgress(progressId, 0, 'Penghapusan peran terhenti', 'Sebagian peran mungkin belum terhapus. Periksa daftar, kemudian coba kembali.');
                        console.error('[Role] Gagal menghapus role:', error);
                        showToast('Peran pengguna gagal dihapus.', 'error');
                    }
                });
            }
        }

        // --- Capitalize Helper ---
        function toTitleCase(str) {
            if(!str) return '';
            return str.toString().replace(/\w\S*/g, function(txt){
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            });
        }
function sortDataArray(arr, order) {
    return arr.sort((a, b) => {
        return order === 'Newest' ? b.id - a.id : a.id - b.id;
    });
}
        // --- Live Clock Update ---
        function updateClock() {
            let now = new Date(); 
            let h = now.getHours(); 
            let greet = ""; 
            let emoji = "";

            if (h >= 5 && h < 11) { greet = "Pagi"; emoji = "🌅"; }
            else if (h >= 11 && h < 15) { greet = "Siang"; emoji = "☀️"; }
            else if (h >= 15 && h < 18) { greet = "Sore"; emoji = "🌇"; }
            else { greet = "Malam"; emoji = "🌙"; }
            
            let userText = sessionUser ? `, ${sessionUser}` : "";
            let greetEl = document.getElementById('greeting-time'); 
            if(greetEl) greetEl.innerText = `Selamat ${greet} ${emoji}${userText}`;

            // Detik dihilangkan: worksheet ini tidak butuh ketelitian detik, dan
            // angka yang berkedip setiap detik hanya menarik perhatian dari isi
            // layar. Karena itu jamnya cukup disegarkan sekali setiap 20 detik.
            let clockEl = document.getElementById('live-clock');
            if(clockEl) clockEl.innerText = now.toLocaleString('id-ID', { weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});

            // Hero halaman utama memakai sapaan dan tanggal yang sama dengan
            // navbar, jadi keduanya selalu selaras tanpa timer tambahan.
            let heroGreet = document.getElementById('home-hero-greeting');
            if(heroGreet) heroGreet.innerText = `Selamat ${greet} ${emoji}${userText}`;
            let heroDate = document.getElementById('home-hero-date');
            if(heroDate) heroDate.innerText = now.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
        }
        setInterval(updateClock, 20000);

        // --- Posted notification: gunakan toast konsisten di kanan bawah ---
        function showRTPAnimation() {
            showToast('Data berhasil diubah menjadi Posted.', 'success');
        }

        // --- Excel-Like Filter Logic (NEW Checkbox Features) ---
        // Satu sumber filter/sort tabel utama.
let tableFilters = { rekap: {}, history: {}, revise: {}, canceled: {}, 'in-process': {}, waiting: {}, 'super-find': {}, karyawan: {}, 'ready-payment': {}, 'payment-paid': {}, 'payment-hold': {}, 'payment-return': {} };
let tableSorts = { rekap: {col:'id', dir:'DESC'}, history: {col:'id', dir:'DESC'}, revise: {col:'id', dir:'DESC'}, canceled: {col:'canceledAtMs', dir:'DESC'}, 'in-process': {col:'id', dir:'DESC'}, waiting: {col:'id', dir:'DESC'}, 'super-find': {col:'id', dir:'DESC'}, karyawan: {col:'nik', dir:'ASC'}, 'ready-payment': {col:'postedAtDate', dir:'DESC'}, 'payment-paid': {col:'paymentAtDate', dir:'DESC'}, 'payment-hold': {col:'holdAtDate', dir:'DESC'}, 'payment-return': {col:'returnedAtDate', dir:'DESC'} };
        let efActiveModule = null;
        let efActiveCol = null;
        let efUniqueValues = [];

function getActiveModuleDateRange(module) {
    if(module === 'rekap') return window.filterDatesRekap;
    if(module === 'in-process') return window.filterDatesInProcess;
    if(module === 'canceled') return window.filterDatesCanceled;
    if(module === 'history') return window.filterDatesHistory;
    if(module === 'waiting') return window.filterDatesWaiting;
    if(module === 'super-find') return window.filterDatesSuperFind;
    if(module === 'ready-payment') return window.filterDatesReadyPayment;
    if(module === 'payment-paid') return window.filterDatesPaymentPaid;
    if(module === 'payment-hold') return window.filterDatesPaymentHold;
    if(module === 'payment-return') return window.filterDatesPaymentReturn;
    return null;
}

// Tiga antrean aktif Data Payment (Ready/Hold/Return) adalah pekerjaan berjalan,
// sedangkan Paid adalah riwayat. Keempatnya dibuka pada "Semua Periode"
// (rentang kosong), lalu filter periode dapat dipilih bila dibutuhkan.
window.filterDatesReadyPayment = [];
window.filterDatesPaymentPaid = [];
window.filterDatesPaymentHold = [];
window.filterDatesPaymentReturn = [];
const DATA_PAYMENT_ACTIVE_MODULES = ['ready-payment', 'payment-hold', 'payment-return'];
const DATA_PAYMENT_MODULES = ['ready-payment', 'payment-paid', 'payment-hold', 'payment-return'];
window.DATA_PAYMENT_MODULES = DATA_PAYMENT_MODULES;

// Satu pagar periode untuk tabel, dropdown Excel, bulk action, dan export.
// Modul Revisi sengaja tidak mempunyai pagar waktu tersembunyi: seluruh
// histori revisi tetap tersedia dan dibagi menggunakan pagination.
function filterRowsByActiveModuleScope(module, rows) {
    let scoped = Array.isArray(rows) ? rows.slice() : [];
    if(module === 'super-find') {
        const keyword = String(document.getElementById('sf-search-input')?.value || '').toLowerCase().trim();
        if(!keyword) return [];
        scoped = scoped.filter(item => [item.nik, item.nama, item.noPR, item.extNo]
            .some(value => String(value || '').toLowerCase().includes(keyword)));
    }

    const normalizedRange = typeof normalizeReportingRange === 'function'
        ? normalizeReportingRange(getActiveModuleDateRange(module))
        : null;
    if(!normalizedRange) return scoped;
    const startMs = normalizedRange[0].getTime();
    const endMs = normalizedRange[1].getTime();
    return scoped.filter(item => {
        // Antrean Data Payment: baris yang tanggal acuannya tidak terbaca tetap
        // ditampilkan. Menyembunyikan claim yang sebenarnya masih harus dibayar
        // jauh lebih berbahaya daripada satu baris yang keluar dari rentang.
        if(DATA_PAYMENT_MODULES.includes(module)) {
            const acuan = module === 'payment-return'
                ? (typeof getClaimReturnDate === 'function' ? getClaimReturnDate(item) : null)
                : module === 'payment-paid'
                    ? (typeof parseReportingDate === 'function' && typeof formatPaymentDate === 'function' ? parseReportingDate(formatPaymentDate(item)) : null)
                    : (typeof getClaimRtpDate === 'function' ? getClaimRtpDate(item) : null);
            if(!acuan) return DATA_PAYMENT_ACTIVE_MODULES.includes(module);
            return acuan.getTime() >= startMs && acuan.getTime() <= endMs;
        }
        const dateValue = module === 'history'
            ? (typeof getClaimRtpDate === 'function' ? getClaimRtpDate(item) : null)
            : module === 'canceled'
                ? (typeof getCanceledClaimDate === 'function' ? getCanceledClaimDate(item) : null)
                : module === 'super-find'
                    ? (item && item.tglSubmit)
                    // Claim yang belum diproses Accounting belum punya Tanggal
                    // Proses. Tanpa cadangan ini claim baru tidak masuk periode
                    // mana pun dan hilang dari daftar.
                    : (item && (item.tglProses || item.tglSubmit));
        const parsed = typeof parseReportingDate === 'function' ? parseReportingDate(dateValue) : null;
        return !!(parsed && parsed.getTime() >= startMs && parsed.getTime() <= endMs);
    });
}
window.filterRowsByActiveModuleScope = filterRowsByActiveModuleScope;

function getExcelFilterCellValue(item, key) {
    let value = item ? item[key] : null;
    if(isActorDisplayField(key)) value = getShortUsername(value);
    if(key === 'noPR_extNo') value = item && (item.noPR || item.extNo) || '-';
    else if(key === 'postedAtDate') {
        const parts = String(item && item.postedAt || '').replace(',', '').trim().split(/\s+/);
        value = parts[0] || (Number(item && item.workflowTimestamps && item.workflowTimestamps.completedAt)
            ? new Date(Number(item.workflowTimestamps.completedAt)).toLocaleDateString('id-ID', {day:'2-digit', month:'2-digit', year:'numeric'})
            : '-');
    } else if(key === 'postedAtTime') {
        const parts = String(item && item.postedAt || '').replace(',', '').trim().split(/\s+/);
        value = parts[1]
            ? parts[1].replace(/\./g, ':')
            : (Number(item && item.workflowTimestamps && item.workflowTimestamps.completedAt)
                ? new Date(Number(item.workflowTimestamps.completedAt)).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', hour12:false}).replace(/\./g, ':')
                : '-');
    } else if(key === 'paymentAtDate') value = typeof formatPaymentDate === 'function' ? formatPaymentDate(item) : '-';
    else if(key === 'canceledAtDate') value = typeof formatCanceledDate === 'function' ? formatCanceledDate(item) : '-';
    else if(key === 'canceledBy') value = typeof formatActorUsername === 'function' ? formatActorUsername(item && item.canceledBy) : getShortUsername(item && item.canceledBy);
    // Kolom PIC Proses pada Waiting Approval memakai pelaku perpindahan status,
    // sehingga filternya harus membaca nilai yang sama dengan yang ditampilkan.
    else if(key === 'waitingApprovalBy') value = getShortUsername(typeof window.getWaitingApprovalActor === 'function' ? window.getWaitingApprovalActor(item) : (item && item.inputBy));
    // Kolom turunan untuk antrean Data Payment. Semuanya dihitung dari field
    // existing; tidak ada nilai baru yang disimpan pada dokumen claim.
    else if(key === 'hardcopyStatus') value = (typeof isClaimHardcopyReceived === 'function' && isClaimHardcopyReceived(item)) ? 'Hardcopy Diterima' : 'Menunggu Hardcopy';
    else if(key === 'holdAtDate') value = typeof formatWorkflowDate === 'function' ? formatWorkflowDate(item, 'holdAt', 'holdAtMs') : '-';
    else if(key === 'returnedAtDate') value = typeof formatWorkflowDate === 'function' ? formatWorkflowDate(item, 'returnedAt', 'returnedAtMs') : '-';
    else if(key === 'totalHeader') value = typeof formatClaimMoney === 'function' ? formatClaimMoney(item) : Number(item && item.totalHeader) || 0;
    else if(key === 'slaDays' && typeof calculateSLADays === 'function') value = calculateSLADays(item) + ' Hari';
    else if(key === 'masukApproval') {
        const date = new Date(item && item.waitingApprovalAt);
        value = !Number.isNaN(date.getTime())
            ? String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + '/' + date.getFullYear()
            : (item && item.waitingApprovalAt || '-');
    }
    return value === null || value === undefined || value === '' ? '-' : String(value).trim();
}
window.getExcelFilterCellValue = getExcelFilterCellValue;

    window.getUniqueValues = function(module, colKey) {
    if(module === 'catatan-detail' && typeof getUniqueValuesCatatanDetail === 'function') return getUniqueValuesCatatanDetail(module, colKey);
    let baseData = dbRekap;
    if(module === 'history') baseData = dbRekap.filter(i => isCurrentHistoryClaim(i));
    if(module === 'canceled') baseData = dbRekap.filter(i => isCanceledClaim(i));
    if(module === 'in-process') baseData = dbRekap.filter(i => ['In Process','Returned by Finance'].includes(String(i.statusClaim || '')));
    if(module === 'revise') baseData = typeof getReviseBaseData === 'function' ? getReviseBaseData() : dbRekap.filter(i => i.statusClaim === 'Revisi' || i.statusClaim === 'Confirm');
    if(module === 'waiting') baseData = dbRekap.filter(i => i.statusClaim === 'Waiting Approval' || i.statusClaim === 'Confirm'); 
    if(module === 'ready-payment') baseData = dbRekap.filter(i => String(i.statusClaim || '') === 'Posted');
    if(module === 'payment-paid') baseData = dbRekap.filter(i => String(i.statusClaim || '') === 'Paid');
    if(module === 'payment-hold') baseData = dbRekap.filter(i => String(i.statusClaim || '') === 'Hold');
    if(module === 'payment-return') baseData = dbRekap.filter(i => String(i.statusClaim || '') === 'Returned by Finance');
    
    if(module === 'karyawan') baseData = masterKaryawan;
    baseData = filterRowsByActiveModuleScope(module, baseData);

    let activeFilters = tableFilters[module] || {};
    let cascadedData = baseData.filter(item => {
        for(let fKey in activeFilters) {
            if (fKey === colKey) continue; // Biarkan opsi kolom yang sedang diklik tetap utuh
            let allowedVals = activeFilters[fKey]; 
            if(allowedVals.length === 0) return false;
            let itemVal = getExcelFilterCellValue(item, fKey).toLowerCase();
            if(!allowedVals.includes(itemVal)) return false;
        }
        return true;
    });

    let vals = new Set();
    cascadedData.forEach(item => {
        vals.add(getExcelFilterCellValue(item, colKey));
    });
    
    let valsArr = Array.from(vals);
    valsArr.sort((a, b) => {
        if (['tglProses','tglSubmit','postedAtDate','paymentAtDate','canceledAtDate','masukApproval','hardcopyDate','holdAtDate','returnedAtDate'].includes(colKey)) return parseDateString(a) - parseDateString(b);
        if (colKey === 'totalHeader' || colKey === 'slaDays') return (parseFloat(a.replace(/[^0-9]/g, '')) || 0) - (parseFloat(b.replace(/[^0-9]/g, '')) || 0);
        return a.localeCompare(b);
    });
    return valsArr;
}

// Menandai apakah pengguna sudah mencentang atau melepas centang sendiri sejak
// panel dibuka. Ini yang membedakan dua maksud yang sama-sama sah:
//   - belum disentuh + ada kata kunci  -> "saring ke hasil pencarian ini"
//   - sudah disentuh                   -> "pakai SEMUA yang saya centang",
//     termasuk yang dicentang pada pencarian sebelumnya, sehingga pemilihan
//     dapat dilakukan bertahap: cari 25001 centang, cari 26001 centang, dst.
let efSelectionTouched = false;

// Batas tinggi panel filter: terkecil masih menyisakan beberapa baris nilai
// untuk dipilih, terbesar menjaga panelnya tetap ringkas di layar tinggi.
const EXCEL_FILTER_MIN_HEIGHT = 240;
const EXCEL_FILTER_MAX_HEIGHT = 520;

window.openExcelFilter = function(e, colKey, module) {
    efActiveModule = module; 
    efActiveCol = colKey;
    efSelectionTouched = false;
    let modal = document.getElementById('excel-filter-modal');
    let searchInp = document.getElementById('ef-search-input');
    searchInp.value = '';
    syncWsSearchState(searchInp);
    // Judul kolom membuat jelas filter mana yang sedang dibuka; sebelumnya
    // panelnya tidak menyebutkan kolomnya sama sekali.
    const columnTitle = document.getElementById('ef-column-title');
    if(columnTitle) columnTitle.textContent = getFilterColumnLabel(module, colKey);
    
    efUniqueValues = getUniqueValues(module, colKey);
    let listContainer = document.getElementById('ef-checkbox-list');
    listContainer.innerHTML = '';

    let activeFilters = tableFilters[module][colKey] || [];
    let isAllChecked = activeFilters.length === 0 || activeFilters.length === efUniqueValues.length;

    // Nilai opsi berasal dari data claim (nama, entitas, nomor pengajuan), jadi
    // dapat memuat karakter HTML. Sebelumnya hanya tanda kutip yang di-escape
    // untuk atribut value, sedangkan teks di dalam <span> ditulis apa adanya:
    // satu karakter '<' pada nama karyawan sudah cukup merusak seluruh daftar
    // filter. Kedua tempat kini memakai escape yang sama.
    const escEf = escapeActivityLogText;
    // Daftar ini dapat berisi ribuan nilai unik. Merangkainya dengan
    // `innerHTML +=` membuat browser mem-parsing ulang seluruh isi kontainer
    // pada setiap iterasi, jadi seluruh markup disusun dahulu lalu ditulis
    // sekali saja.
    const listChunks = [];
    listChunks.push(`<label class="ef-cb-item" style="font-weight:bold; border-bottom:1px solid #ccc; padding-bottom:5px; margin-bottom:5px;">
        <input type="checkbox" id="ef-cb-all" onchange="toggleAllExcelFilters(this)" ${isAllChecked ? 'checked' : ''}> <span>(Pilih Semua)</span>
    </label>`);

    // --- LOGIC SMART FILTER BERTINGKAT (EXCEL-STYLE) ---
    let isDateCol = (colKey === 'tglProses' || colKey === 'tglSubmit' || colKey === 'postedAtDate' || colKey === 'paymentAtDate' || colKey === 'canceledAtDate' || colKey === 'masukApproval');
    let useTree = false;
    let treeData = {};
    let emptyVals = [];

    // Pohon mata uang: kolom nominal ditampilkan sebagai "IDR 1.567.500", jadi
    // dikelompokkan menurut kode mata uangnya. Sesuai permintaan, pohonnya hanya
    // dibangun bila periode yang ditampilkan memuat lebih dari satu mata uang;
    // bila semuanya satu mata uang, daftarnya rata seperti biasa.
    let isCurrencyCol = (colKey === 'totalHeader');
    let currencyTree = {};

    if (isCurrencyCol) {
        efUniqueValues.forEach(val => {
            const cocok = String(val).match(/^([A-Z]{3})\s+(.+)$/);
            if(cocok) {
                if(!currencyTree[cocok[1]]) currencyTree[cocok[1]] = [];
                currencyTree[cocok[1]].push(val);
            } else emptyVals.push(val);
        });
        if(Object.keys(currencyTree).length > 1) useTree = true;
    }

    if (isDateCol) {
        let ymSet = new Set();
        efUniqueValues.forEach(val => {
            if(val === '-' || !val.includes('/')) {
                emptyVals.push(val);
            } else {
                let p = val.split('/');
                if(p.length === 3) {
                    let y = p[2], m = p[1], d = p[0];
                    ymSet.add(`${y}-${m}`);
                    if(!treeData[y]) treeData[y] = {};
                    if(!treeData[y][m]) treeData[y][m] = [];
                    treeData[y][m].push(val);
                } else emptyVals.push(val);
            }
        });
        // Syarat Pintar: Kalau bulan unik lebih dari 1, baru bangun cabang Tree!
        if(ymSet.size > 1) useTree = true;
    }

    if (useTree && isCurrencyCol) {
        // IDR diletakkan paling atas karena paling sering dipakai, sisanya urut
        // abjad. Nominal di dalam tiap mata uang urut dari terbesar.
        const nilaiAngka = teks => Number(String(teks).replace(/[^0-9,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        const kodeUrut = Object.keys(currencyTree).sort((a, b) =>
            (a === 'IDR' ? -1 : b === 'IDR' ? 1 : 0) || a.localeCompare(b));
        let treeHtml = '';
        kodeUrut.forEach(kode => {
            treeHtml += `<div class="tree-group-y ef-tree-group">
                <div class="ef-tree-head">
                    <span class="ef-tree-toggle" role="button" tabindex="0" onclick="toggleExcelTreeBranch(this)">-</span>
                    <label class="ef-cb-item ef-tree-label"><input type="checkbox" class="cb-tree cb-y" onchange="toggleTreeCb(this, '.ef-cb-val')"> <span>${escEf(kode)}</span></label>
                </div>
                <div class="tree-child-y ef-tree-child">`;
            currencyTree[kode].sort((a, b) => nilaiAngka(b) - nilaiAngka(a)).forEach(val => {
                const isChecked = isAllChecked || activeFilters.includes(val.toLowerCase());
                const tampil = val.slice(kode.length).trim() || val;
                treeHtml += `<label class="ef-cb-item ef-data-item"><input type="checkbox" class="ef-cb-val" value="${escEf(val)}" ${isChecked ? 'checked' : ''} onchange="checkExcelFilterIndividually(); syncAllTreeCb();"> <span>${escEf(tampil)}</span></label>`;
            });
            treeHtml += `</div></div>`;
        });
        emptyVals.forEach(val => {
            const isChecked = isAllChecked || activeFilters.includes(val.toLowerCase());
            treeHtml += `<label class="ef-cb-item ef-data-item"><input type="checkbox" class="ef-cb-val" value="${escEf(val)}" ${isChecked ? 'checked' : ''} onchange="checkExcelFilterIndividually()"> <span>${escEf(val)}</span></label>`;
        });
        listChunks.push(treeHtml);
        listContainer.innerHTML = listChunks.join('');
        setTimeout(syncAllTreeCb, 50);

    } else if (useTree) {
        const monthNames = {'01':'Januari', '02':'Februari', '03':'Maret', '04':'April', '05':'Mei', '06':'Juni', '07':'Juli', '08':'Agustus', '09':'September', '10':'Oktober', '11':'November', '12':'Desember'};
        let treeHtml = '';
        
        Object.keys(treeData).sort((a,b)=>b-a).forEach(y => {
            treeHtml += `<div class="tree-group-y ef-tree-group">
                <div class="ef-tree-head">
                    <span class="ef-tree-toggle" role="button" tabindex="0" onclick="toggleExcelTreeBranch(this)">-</span>
                    <label class="ef-cb-item ef-tree-label"><input type="checkbox" class="cb-tree cb-y" onchange="toggleTreeCb(this, '.cb-m, .ef-cb-val')"> <span>Tahun ${y}</span></label>
                </div>
                <div class="tree-child-y ef-tree-child">`;
            
            Object.keys(treeData[y]).sort((a,b)=>a-b).forEach(m => {
                treeHtml += `<div class="tree-group-m ef-tree-sub">
                    <div class="ef-tree-head ef-tree-head-sub">
                        <span class="ef-tree-toggle" role="button" tabindex="0" onclick="toggleExcelTreeBranch(this)">-</span>
                        <label class="ef-cb-item ef-tree-label"><input type="checkbox" class="cb-tree cb-m" onchange="toggleTreeCb(this, '.ef-cb-val')"> <span>${monthNames[m] || m}</span></label>
                    </div>
                    <div class="tree-child-m ef-tree-child">`;
                
                treeData[y][m].forEach(val => {
                    let d = val.split('/')[0];
                    let isChecked = isAllChecked || activeFilters.includes(val.toLowerCase());
                    treeHtml += `<label class="ef-cb-item ef-data-item"><input type="checkbox" class="ef-cb-val cb-d" value="${escEf(val)}" ${isChecked ? 'checked' : ''} onchange="checkExcelFilterIndividually(); syncAllTreeCb();"> <span>${parseInt(d, 10)}</span></label>`;
                });

                treeHtml += `</div></div>`;
            });
            treeHtml += `</div></div>`;
        });

        emptyVals.forEach(val => {
            let isChecked = isAllChecked || activeFilters.includes(val.toLowerCase());
            treeHtml += `<label class="ef-cb-item ef-data-item"><input type="checkbox" class="ef-cb-val" value="${escEf(val)}" ${isChecked ? 'checked' : ''} onchange="checkExcelFilterIndividually()"> <span>${escEf(val)}</span></label>`;
        });

        listChunks.push(treeHtml);
        listContainer.innerHTML = listChunks.join('');
        setTimeout(syncAllTreeCb, 50);

    } else {
        efUniqueValues.forEach(val => {
            let isChecked = isAllChecked || activeFilters.includes(val.toLowerCase());
            listChunks.push(`<label class="ef-cb-item ef-data-item"><input type="checkbox" class="ef-cb-val" value="${escEf(val)}" ${isChecked ? 'checked' : ''} onchange="checkExcelFilterIndividually()"> <span>${escEf(val)}</span></label>`);
        });
        listContainer.innerHTML = listChunks.join('');
    }

    modal.style.display = 'flex';

    // Panel menempel pada ikon filter di judul kolomnya, dan tetap menempel
    // ketika halaman atau tabel digulir - seperti mesin spreadsheet lain.
    // Sebelumnya posisinya hanya dihitung sekali saat dibuka, sehingga panelnya
    // tertinggal melayang begitu halaman bergerak.
    efAnchorEl = e.currentTarget || e.target;
    positionExcelFilter();
    attachExcelFilterAnchor();
    setTimeout(() => searchInp.focus(), 50);
    e.stopPropagation();
};

// --- PENAMBATAN PANEL FILTER PADA JUDUL KOLOM ---
let efAnchorEl = null;
let efAnchorFrame = 0;

// Panel disembunyikan ketika judul kolomnya sendiri sudah tidak terlihat, baik
// karena keluar layar maupun tergulir keluar dari wadah tabelnya yang ber-overflow.
function excelFilterAnchorVisible(el) {
    const r = el.getBoundingClientRect();
    if(r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    const wadah = el.closest('.table-responsive');
    if(wadah) {
        const rw = wadah.getBoundingClientRect();
        if(r.bottom < rw.top || r.top > rw.bottom || r.right < rw.left || r.left > rw.right) return false;
    }
    return true;
}

window.positionExcelFilter = function() {
    const modal = document.getElementById('excel-filter-modal');
    if(!modal || !efAnchorEl) return;
    if(!modal.style.display || modal.style.display === 'none') return;
    if(!efAnchorEl.isConnected || !excelFilterAnchorVisible(efAnchorEl)) { closeExcelFilter(); return; }

    // SELALU ke bawah judul kolom. Yang menyesuaikan ruang tersisa adalah
    // tingginya - daftar nilainya bergulir di dalam panel - sehingga arah
    // bukanya tidak pernah berubah-ubah.
    const rect = efAnchorEl.getBoundingClientRect();
    const bawahJudul = rect.bottom + 6;
    const ruangBawah = window.innerHeight - bawahJudul - 10;
    const tinggi = Math.max(EXCEL_FILTER_MIN_HEIGHT, Math.min(ruangBawah, EXCEL_FILTER_MAX_HEIGHT));
    modal.style.maxHeight = tinggi + 'px';

    // Hanya bila tinggi terkecil pun tidak muat - judul kolom nyaris menyentuh
    // dasar layar - panel digeser ke atas SECUKUPNYA supaya tetap terjangkau.
    // Ini menggeser, bukan membalik ke sisi atas judul kolom.
    let topPos = bawahJudul;
    if(topPos + tinggi > window.innerHeight - 8) topPos = Math.max(8, window.innerHeight - tinggi - 8);

    const modalWidth = modal.offsetWidth || 272;
    let leftPos = rect.left;
    if(leftPos + modalWidth > window.innerWidth - 8) leftPos = window.innerWidth - modalWidth - 8;
    if(leftPos < 8) leftPos = 8;
    modal.style.top = topPos + 'px';
    modal.style.left = leftPos + 'px';
};

// Pengguliran dapat terjadi berkali-kali dalam satu bingkai gambar, jadi
// perhitungan ulangnya disatukan ke satu bingkai animasi.
function handleExcelFilterAnchorMove() {
    if(efAnchorFrame) return;
    efAnchorFrame = requestAnimationFrame(() => { efAnchorFrame = 0; positionExcelFilter(); });
}

function attachExcelFilterAnchor() {
    // capture:true supaya pengguliran wadah tabel yang ber-overflow ikut terpantau;
    // peristiwa scroll pada elemen tidak menggelembung ke window.
    window.addEventListener('scroll', handleExcelFilterAnchorMove, true);
    window.addEventListener('resize', handleExcelFilterAnchorMove);
}

function detachExcelFilterAnchor() {
    window.removeEventListener('scroll', handleExcelFilterAnchorMove, true);
    window.removeEventListener('resize', handleExcelFilterAnchorMove);
    if(efAnchorFrame) { cancelAnimationFrame(efAnchorFrame); efAnchorFrame = 0; }
}

// Satu pintu penutupan supaya pemantau pengguliran selalu ikut dilepas.
window.closeExcelFilter = function() {
    const modal = document.getElementById('excel-filter-modal');
    if(modal) modal.style.display = 'none';
    efAnchorEl = null;
    detachExcelFilterAnchor();
};


window.toggleAllExcelFilters = function(master) {
    efSelectionTouched = true;
    document.querySelectorAll('.ef-data-item').forEach(lbl => {
        if(lbl.style.display !== 'none') {
            let cb = lbl.querySelector('.ef-cb-val'); if(cb) cb.checked = master.checked;
        }
    });
    if(typeof syncAllTreeCb === 'function') syncAllTreeCb();
};

window.checkExcelFilterIndividually = function(fromUser) {
    if(fromUser !== false) efSelectionTouched = true;
    let visibleItems = Array.from(document.querySelectorAll('.ef-data-item')).filter(lbl => lbl.style.display !== 'none');
    let totalVisible = visibleItems.length;
    let checkedVisible = visibleItems.filter(lbl => { let cb = lbl.querySelector('.ef-cb-val'); return cb && cb.checked; }).length;
    let cbAll = document.getElementById('ef-cb-all');
    if(cbAll) cbAll.checked = (totalVisible === checkedVisible && totalVisible > 0);
};

window.filterExcelOptions = function() {
    let keyword = document.getElementById('ef-search-input').value.toLowerCase();
    document.querySelectorAll('.ef-data-item').forEach(lbl => {
        // textContent, bukan innerText: isinya selalu teks biasa sehingga
        // hasilnya sama, tanpa memaksa browser menghitung ulang tata letak
        // pada setiap baris daftar.
        let txt = String(lbl.querySelector('span').textContent || '').toLowerCase();
        let cb = lbl.querySelector('.ef-cb-val');
        let val = cb ? cb.value.toLowerCase() : txt; // Biar bisa ketik "28/07"
        lbl.style.display = (txt.includes(keyword) || val.includes(keyword)) ? 'flex' : 'none';
    });
    // Dipanggil hanya untuk menyegarkan tampilan setelah baris disembunyikan,
    // bukan karena pengguna mencentang sesuatu.
    checkExcelFilterIndividually(false);
    if(typeof syncAllTreeCb === 'function') syncAllTreeCb();
};

// --- HELPER FUNGSI TREE ---
window.toggleTreeCb = function(el, childSelector) {
    let container = el.closest('.tree-group-y, .tree-group-m');
    if(!container) return;
    let children = container.querySelectorAll(childSelector);
    children.forEach(cb => {
        let item = cb.closest('.ef-data-item');
        if(!item || item.style.display !== 'none') cb.checked = el.checked;
    });
    checkExcelFilterIndividually();
    syncAllTreeCb();
};

// Menangani dua bentuk pohon: dua tingkat (tahun -> bulan -> tanggal) dan satu
// tingkat (mata uang -> nominal), sehingga keduanya memakai satu penyelaras.
window.syncAllTreeCb = function() {
    const terlihat = cb => {
        const item = cb.closest('.ef-data-item');
        return item && item.style.display !== 'none';
    };
    document.querySelectorAll('.tree-group-y').forEach(yGroup => {
        const mGroups = yGroup.querySelectorAll('.tree-group-m');
        let allYChecked = true, yVisible = false;

        if(mGroups.length === 0) {
            const daun = Array.from(yGroup.querySelectorAll('.ef-cb-val')).filter(terlihat);
            yVisible = daun.length > 0;
            allYChecked = yVisible && daun.every(cb => cb.checked);
        } else {
            mGroups.forEach(mGroup => {
                const visibleD = Array.from(mGroup.querySelectorAll('.cb-d')).filter(terlihat);
                if (visibleD.length > 0) {
                    yVisible = true; mGroup.style.display = 'block';
                    const mCb = mGroup.querySelector('.cb-m');
                    if(mCb) mCb.checked = visibleD.every(cb => cb.checked);
                    if(!mCb || !mCb.checked) allYChecked = false;
                } else {
                    mGroup.style.display = 'none'; allYChecked = false;
                }
            });
        }

        const yCb = yGroup.querySelector('.cb-y');
        if(yCb) yCb.checked = !!(yVisible && allYChecked);
        yGroup.style.display = yVisible ? 'block' : 'none';
    });
};

// Membuka atau menutup satu cabang pohon. Sebelumnya logikanya ditulis
// sebagai skrip panjang di dalam atribut onclick pada setiap cabang.
window.toggleExcelTreeBranch = function(el) {
    const anak = el.parentElement && el.parentElement.nextElementSibling;
    if(!anak) return;
    const tertutup = anak.style.display === 'none';
    anak.style.display = tertutup ? 'block' : 'none';
    el.textContent = tertutup ? '-' : '+';
};

        function applyExcelSort(dir) {
            if(efActiveModule && efActiveCol) {
                tableSorts[efActiveModule] = { col: efActiveCol, dir: dir };
                closeExcelFilter();
                refreshModuleTable(efActiveModule);
            }
        }
        
        function applyExcelFilter() {
    if(efActiveModule && efActiveCol) {
        const searchBox = document.getElementById('ef-search-input');
        const keyword = String(searchBox && searchBox.value || '').trim();
        const allItems = Array.from(document.querySelectorAll('.ef-data-item'));
        const visibleItems = allItems.filter(lbl => lbl.style.display !== 'none');

        // Dua maksud yang sama-sama sah dibedakan oleh apakah pengguna sudah
        // menyentuh centang sendiri:
        //
        //   belum disentuh + ada kata kunci
        //     -> "saring ke hasil pencarian ini". Tanpa aturan ini, mengetik
        //        kata kunci lalu menekan Terapkan akan menghapus filter karena
        //        seluruh nilai masih terhitung tercentang.
        //
        //   sudah disentuh
        //     -> "pakai SEMUA yang saya centang". Centang dari pencarian
        //        sebelumnya ikut terpakai, sehingga pemilihan dapat dilakukan
        //        bertahap: cari 25001 lalu centang, cari 26001 lalu centang,
        //        cari 27001 lalu centang, dan ketiganya tersaring bersama.
        const scope = (keyword && !efSelectionTouched) ? visibleItems : allItems;
        const checkboxOf = lbl => lbl.querySelector('.ef-cb-val');
        const checkedInScope = scope.filter(lbl => { const cb = checkboxOf(lbl); return cb && cb.checked; });

        if(scope.length === 0) {
            return showToast('Tidak ada nilai yang cocok dengan pencarian Anda.', 'error');
        }
        if(checkedInScope.length === 0) {
            return showToast('Pilih minimal satu filter atau gunakan tombol Bersihkan.', 'error');
        }

        // Filter dihapus hanya bila seluruh nilai kolom - bukan sekadar hasil
        // pencarian - benar-benar tercentang, karena saat itulah tabelnya
        // memang tidak tersaring.
        if(checkedInScope.length === allItems.length) {
            delete tableFilters[efActiveModule][efActiveCol];
        } else {
            tableFilters[efActiveModule][efActiveCol] = checkedInScope
                .map(lbl => checkboxOf(lbl).value.toLowerCase().trim());
        }

        closeExcelFilter();
        updateFilterIconHighlight(efActiveModule);
        refreshModuleTable(efActiveModule);
    }
}

        function clearExcelFilter() {
            if(efActiveModule && efActiveCol) {
                delete tableFilters[efActiveModule][efActiveCol];
                closeExcelFilter();
                updateFilterIconHighlight(efActiveModule);
                refreshModuleTable(efActiveModule);
            }
        }

const colNamesTranslate = { 'masukApproval': 'Masuk Persetujuan', 'noPR_extNo': 'No.', 'nik': 'NIK', 'nama': 'Nama Karyawan', 'entitas': 'Entitas', 'tipe': 'Tipe Pengajuan', 'tglProses': 'Tgl Proses', 'tglSubmit': 'Tgl Submit', 'slaDays': 'SLA', 'totalHeader': 'Total Amount', 'inputBy': 'Diinput Oleh', 'statusClaim': 'Status Data', 'postedAtDate': 'Tgl RTP', 'postedAtTime': 'Jam RTP', 'postedBy': 'PIC Posted', 'paymentAtDate': 'Tgl Pymnt', 'paymentBy': 'PIC Pymnt', 'paymentReference': 'Ref Pymnt', 'cc': 'Cost Center', 'lokasi': 'Lokasi Kerja', 'jabatan': 'Jabatan', 'departemen': 'Departemen', 'hardcopyDate': 'Tgl Hardcopy', 'hardcopyBy': 'PIC Hardcopy', 'hardcopyStatus': 'Status Hardcopy', 'holdAtDate': 'Tgl Hold', 'returnedAtDate': 'Tgl Return' };

function getFilterColumnLabel(module, key) {
    if(module === 'rekap' && key === 'paymentAtDate') return 'Tgl Pymnt';
    if(module === 'rekap' && key === 'paymentBy') return 'PIC Pymnt';
    if(key === 'waitingApprovalBy') return 'PIC Proses';
    return colNamesTranslate[key] || key;
}

window.clearAllFilters = function(module) {
    tableFilters[module] = {}; updateFilterIconHighlight(module); refreshModuleTable(module); showToast('Seluruh filter telah dibersihkan.', 'success');
};

function updateFilterIconHighlight(module) {
    // KUNCI 3: Arahkan pencarian elemen HTML ke ID yang benar
    // Modul yang id layarnya tidak berpola menu-claim-<module> harus disebut
    // eksplisit; tanpa itu sorotan ikon filter menyasar elemen yang tidak ada.
    const MODULE_SCREEN_IDS = { karyawan:'menu-master-karyawan', history:'menu-history', 'super-find':'menu-super-find',
        waiting:'menu-waiting-approval', 'ready-payment':'menu-ready-payment', 'payment-hold':'menu-payment-hold',
        'payment-return':'menu-payment-return' };
    let idPrefix = MODULE_SCREEN_IDS[module] ? `#${MODULE_SCREEN_IDS[module]}` : `#menu-claim-${module}`;
                   
    document.querySelectorAll(`${idPrefix} .th-filter-icon`).forEach(el => el.classList.remove('th-filtered'));
    
    let activeKeys = Object.keys(tableFilters[module] || {});
    activeKeys.forEach(col => {
        document.querySelectorAll(`${idPrefix} th .th-filter-icon[onclick*="${col}"]`).forEach(thIcon => { thIcon.classList.add('th-filtered'); });
    });

    // KUNCI 4: Pastikan Spanduk Muncul di Menu Waiting Approval
    let menuId = MODULE_SCREEN_IDS[module] || `menu-claim-${module}`;
                 
    let menuEl = document.getElementById(menuId);
    if (menuEl) {
        let bannerId = 'filter-banner-' + module; let existingBanner = document.getElementById(bannerId);
        if (activeKeys.length > 0) {
            let colLabels = activeKeys.map(k => getFilterColumnLabel(module, k)).join(', ');
            if (!existingBanner) {
                // Spanduk filter menempel setelah toolbar periode halaman.
                let headerPanel = menuEl.querySelector('.list-toolbar, .header-panel');
                if (headerPanel) {
                    headerPanel.insertAdjacentHTML('afterend', `<div id="${bannerId}" style="background: rgba(255, 243, 205, 0.85); color: #856404; padding: 10px 15px; border-radius: 6px; border: 1px dashed #ffeeba; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.05); animation: fadeIn 0.3s ease;"><div style="font-size: 13px;"><strong>🔍 Menampilkan Hasil Filter:</strong> Berdasarkan kolom <span id="${bannerId}-text" style="font-weight:bold; color:#d39e00;">${colLabels}</span></div><button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px; font-weight: bold; background: #dc3545; color: white; border:none; box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);" onclick="clearAllFilters('${module}')">✖ Hapus Semua</button></div>`);
                }
            } else {
                document.getElementById(bannerId + '-text').innerText = colLabels; existingBanner.style.display = 'flex';
            }
        } else {
            if (existingBanner) existingBanner.style.display = 'none';
        }
    }
}

        function refreshModuleTable(module) {
            resetModulePagination(module);
            if(module === 'rekap') renderRekapTable();
            if(module === 'in-process' && typeof renderInProcessTable === 'function') renderInProcessTable();
            if(module === 'canceled' && typeof renderCanceledTable === 'function') renderCanceledTable();
            if(module === 'history') renderHistoryTable();
            if(module === 'revise') renderReviseConfirm();
            if(module === 'super-find') renderSuperFindTable();
            if(module === 'karyawan') renderMasterKaryawan();
            if(module === 'waiting' && typeof window.renderWaitingTable === 'function') window.renderWaitingTable(); 
            if(module === 'ready-payment' && typeof window.renderReadyPaymentTable === 'function') window.renderReadyPaymentTable();
            if(module === 'payment-paid' && typeof window.renderPaymentPaidTable === 'function') window.renderPaymentPaidTable();
            if(module === 'payment-hold' && typeof window.renderPaymentHoldTable === 'function') window.renderPaymentHoldTable();
            if(module === 'payment-return' && typeof window.renderPaymentReturnTable === 'function') window.renderPaymentReturnTable();
        }

function getReviseBaseData() {
    return dbRekap.filter(item => {
        if(isCanceledClaim(item) || item.statusClaim === 'In Process' || item.statusClaim === 'Waiting Approval') return false;
        const isCurrentlyRevise = item.statusClaim === 'Revisi';
        const wasRevise = Array.isArray(item.historyLog)
            && item.historyLog.some(log => String(log.status || '').toLowerCase().includes('revisi'));
        const isCleared = item.reviseStep === 'Cleared';
        return isCurrentlyRevise || ((isCleared || isFinalClaimStatus(item.statusClaim)) && wasRevise);
    });
}

        // Dua daftar ini sengaja berdampingan supaya tidak lagi berjalan sendiri
        // dan saling tertinggal seperti sebelumnya.
        //
        // DERIVED: nilainya tidak tersedia sebagai properti claim (holdAtDate,
        // returnedAtDate, hardcopyStatus) atau bentuk tampilnya berbeda dari
        // nilai mentahnya. Dibaca lewat getExcelFilterCellValue() supaya yang
        // diurutkan persis sama dengan yang dibaca pengguna di tabel.
        const DERIVED_SORT_COLUMNS = ['noPR_extNo', 'postedAtDate', 'postedAtTime', 'paymentAtDate',
            'canceledAtDate', 'masukApproval', 'hardcopyDate', 'hardcopyStatus', 'holdAtDate', 'returnedAtDate'];
        // DATE: dibandingkan sebagai tanggal, bukan teks. Tanpa ini
        // 01/09/2026 dianggap lebih kecil daripada 31/08/2026 karena diadu
        // sebagai string.
        const DATE_SORT_COLUMNS = ['tglSubmit', 'tglProses', 'postedAtDate', 'paymentAtDate',
            'canceledAtDate', 'masukApproval', 'hardcopyDate', 'holdAtDate', 'returnedAtDate'];
        window.DERIVED_SORT_COLUMNS = DERIVED_SORT_COLUMNS;
        window.DATE_SORT_COLUMNS = DATE_SORT_COLUMNS;

        function getFilteredAndSortedData(module, baseData) {
    if(module === 'catatan-detail' && typeof getFilteredAndSortedDataCatatanDetail === 'function') return getFilteredAndSortedDataCatatanDetail(module, baseData);
    let filters = tableFilters[module] || {}; let sortRule = tableSorts[module] || {col:'id', dir:'DESC'};
    baseData = filterRowsByActiveModuleScope(module, baseData);

    // Eksekusi Excel Checkbox Filter
    let filtered = baseData.filter(item => {
        for(let key in filters) {
            let allowedVals = filters[key]; if(allowedVals.length === 0) return false;
            let itemVal = getExcelFilterCellValue(item, key).toLowerCase();
            if(!allowedVals.includes(itemVal)) return false;
        }
        return true;
    });

    // EKSEKUSI GLOBAL SEARCH BOX (Menembus Checkbox & Pagination)
    let searchInput = document.getElementById('search-' + module);
    if (searchInput && searchInput.value.trim() !== '') {
        let kw = searchInput.value.toLowerCase().trim();
        filtered = filtered.filter(item => {
            let target = `${item.nik||''} ${item.nama||''} ${item.noPR||''} ${item.extNo||''} ${item.tipe||''} ${item.entitas||''} ${item.statusClaim||''} ${item.totalHeader||''} ${item.reviseNote||''} ${item.cancelReason||''}`.toLowerCase();
            return target.includes(kw);
        });
    }

    // Sorting
    filtered.sort((a,b) => {
        if(sortRule.col === 'slaDays' && typeof calculateSLADays === 'function') {
            let sA = calculateSLADays(a), sB = calculateSLADays(b);
            if(sA < sB) return sortRule.dir === 'ASC' ? -1 : 1; if(sA > sB) return sortRule.dir === 'ASC' ? 1 : -1; return 0;
        }
        let valA = a[sortRule.col]; let valB = b[sortRule.col];
        if(DERIVED_SORT_COLUMNS.includes(sortRule.col) || isActorDisplayField(sortRule.col)) {
            valA = getExcelFilterCellValue(a, sortRule.col);
            valB = getExcelFilterCellValue(b, sortRule.col);
        }
        if(sortRule.col === 'id') { valA = parseInt(valA) || 0; valB = parseInt(valB) || 0; }
        // Stempel waktu masuk antrean berupa milidetik. Tanpa penanganan angka
        // ini, perbandingannya jatuh ke mode teks dan claim tanpa stempel
        // (nilai kosong) justru naik ke atas.
        else if(sortRule.col === 'waitingApprovalAt') {
            valA = Number(a.waitingApprovalAt) || Number(a.workflowTimestamps && a.workflowTimestamps.waitingApprovalAt) || Number.MAX_SAFE_INTEGER;
            valB = Number(b.waitingApprovalAt) || Number(b.workflowTimestamps && b.workflowTimestamps.waitingApprovalAt) || Number.MAX_SAFE_INTEGER;
        }
        else if(sortRule.col === 'totalHeader') { valA = Number(a.totalHeader) || 0; valB = Number(b.totalHeader) || 0; }
        else if(DATE_SORT_COLUMNS.includes(sortRule.col)) { valA = parseDateString(valA); valB = parseDateString(valB); }
        else { valA = (valA||'').toString().toLowerCase().trim(); valB = (valB||'').toString().toLowerCase().trim(); }

        if(valA < valB) return sortRule.dir === 'ASC' ? -1 : 1;
        if(valA > valB) return sortRule.dir === 'ASC' ? 1 : -1; return 0;
    });
    return filtered;
}

function getFilteredRowsForSource(source) {
    let module = source;
    let baseData = dbRekap;
    if(source === 'history') baseData = dbRekap.filter(item => isCurrentHistoryClaim(item));
    else if(source === 'canceled') baseData = dbRekap.filter(item => isCanceledClaim(item));
    // Penyaring ini wajib sama persis dengan renderInProcessTable, termasuk
    // pengecualian claim yang sudah dibatalkan. Kalau tidak, centang "pilih
    // semua" ikut memasukkan baris yang tidak tampil di layar.
    else if(source === 'in-process') baseData = dbRekap.filter(item => ['In Process','Returned by Finance'].includes(String(item.statusClaim || '')) && !isCanceledClaim(item));
    else if(source === 'waiting') baseData = dbRekap.filter(item => item.statusClaim === 'Waiting Approval' || item.statusClaim === 'Confirm');
    else if(source === 'ready-payment') baseData = dbRekap.filter(item => String(item.statusClaim || '') === 'Posted' && !isCanceledClaim(item));
    else if(source === 'revise' || source === 'revise-active' || source === 'revise-arsip') {
        module = 'revise';
        baseData = getReviseBaseData();
    }
    let filtered = getFilteredAndSortedData(module, baseData);
    if(source === 'revise-active') filtered = filtered.filter(item => item.statusClaim === 'Revisi');
    else if(source === 'revise-arsip') filtered = filtered.filter(item => isFinalClaimStatus(item.statusClaim) || item.reviseStep === 'Cleared');
    return filtered;
}
window.getFilteredRowsForSource = getFilteredRowsForSource;

function getScopedSelectedIds(source) {
    const selected = source === 'revise'
        ? [...Array.from(window.globalSelections && window.globalSelections['revise-active'] || []), ...Array.from(window.globalSelections && window.globalSelections['revise-arsip'] || [])]
        : Array.from(window.globalSelections && window.globalSelections[source] || []);
    const allowedIds = new Set(getFilteredRowsForSource(source).map(item => String(item.id)));
    return selected.filter(id => allowedIds.has(String(id)));
}
window.getScopedSelectedIds = getScopedSelectedIds;

function resetModulePagination(module) {
    if(module === 'rekap' && typeof rekapCurrentPage !== 'undefined') rekapCurrentPage = 1;
    else if(module === 'history' && typeof histCurrentPage !== 'undefined') histCurrentPage = 1;
    else if(module === 'in-process') window.inProcessCurrentPage = 1;
    else if(module === 'canceled') window.canceledCurrentPage = 1;
    else if(module === 'waiting') window.waitingCurrentPage = 1;
    else if(module === 'revise') {
        if(typeof revActPage !== 'undefined') revActPage = 1;
        if(typeof revArsPage !== 'undefined') revArsPage = 1;
    } else if(module === 'catatan-detail') window.catatanDetailCurrentPage = 1;
    else if(module === 'ready-payment') window.readyPaymentCurrentPage = 1;
    else if(module === 'payment-paid') window.paymentPaidCurrentPage = 1;
    else if(module === 'payment-hold') window.paymentHoldCurrentPage = 1;
    else if(module === 'payment-return') window.paymentReturnCurrentPage = 1;
}
window.resetModulePagination = resetModulePagination;

window.executeGlobalSearch = function(module) {
    if (module === 'rekap') { rekapCurrentPage = 1; if (typeof renderRekapTable === 'function') renderRekapTable(); }
    else if (module === 'history') { histCurrentPage = 1; if (typeof renderHistoryTable === 'function') renderHistoryTable(); }
    else if (module === 'revise') { if(typeof revActPage !== 'undefined') revActPage = 1; if(typeof revArsPage !== 'undefined') revArsPage = 1; if(typeof renderReviseConfirm === 'function') renderReviseConfirm(); }
    else if (module === 'in-process') { window.inProcessCurrentPage = 1; if (typeof renderInProcessTable === 'function') renderInProcessTable(); }
    else if (module === 'canceled') { window.canceledCurrentPage = 1; if (typeof renderCanceledTable === 'function') renderCanceledTable(); }
    else if (module === 'waiting') { window.waitingCurrentPage = 1; if (typeof renderWaitingTable === 'function') window.renderWaitingTable(); }
    else if (module === 'catatan-detail') { window.catatanDetailCurrentPage = 1; if (typeof renderCatatanDetailTable === 'function') renderCatatanDetailTable(); }
    else if (module === 'ready-payment') { window.readyPaymentCurrentPage = 1; if (typeof window.renderReadyPaymentTable === 'function') window.renderReadyPaymentTable(); }
    else if (module === 'payment-paid') { window.paymentPaidCurrentPage = 1; if (typeof window.renderPaymentPaidTable === 'function') window.renderPaymentPaidTable(); }
    else if (module === 'payment-hold') { window.paymentHoldCurrentPage = 1; if (typeof window.renderPaymentHoldTable === 'function') window.renderPaymentHoldTable(); }
    else if (module === 'payment-return') { window.paymentReturnCurrentPage = 1; if (typeof window.renderPaymentReturnTable === 'function') window.renderPaymentReturnTable(); }
};
        // --- Date Validation & Formatting Logic ---
        function isValidDateString(dateStr) {
            if(!dateStr || dateStr.length !== 10) return false;
            let p = dateStr.split('/'); if(p.length !== 3) return false;
            let d = parseInt(p[0], 10), m = parseInt(p[1], 10), y = parseInt(p[2], 10);
            let date = new Date(y, m - 1, d); return (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d);
        }

        // --- Smart Date Auto-Formatter (FIXED FRAME) ---
        function autoFormatDate(inp, isFinal = false) { 
            let val = inp.value.toLowerCase().trim();
            if(!val) { inp.style.borderColor = '#ccc'; inp.style.color = '#333'; return; }
            
            if (isFinal) {
                // 1. Logika Pad (Nambahin 0 di depan)
                if (val.includes('/')) {
                    let parts = val.split('/');
                    if (parts.length === 3) {
                        let d = parts[0].padStart(2, '0');
                        let m = parts[1].padStart(2, '0');
                        let y = parts[2];
                        if (y.length === 2) y = "20" + y; // Auto convert 26 jadi 2026
                        val = `${d}/${m}/${y}`;
                    }
                }

                // 2. Jika formatnya sudah rapi DD/MM/YYYY, biarkan lolos divalidasi
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
                    // Valid
                } else {
                    let months = {'jan':'01','feb':'02','mar':'03','apr':'04','mei':'05','may':'05','jun':'06','jul':'07','agu':'08','aug':'08','sep':'09','okt':'10','oct':'10','nov':'11','des':'12','dec':'12'};
                    let strMatch = val.match(/^(\d{1,2})([a-z]{3})(\d{2,4})?$/);
                    
                    if (strMatch) {
                        let d = strMatch[1].padStart(2, '0');
                        let m = months[strMatch[2]];
                        let y = strMatch[3] ? (strMatch[3].length === 2 ? '20'+strMatch[3] : strMatch[3]) : new Date().getFullYear();
                        if (m) val = `${d}/${m}/${y}`;
                    } else {
                        let digits = val.replace(/\D/g, '');
                        if (digits.length === 3) {
                            val = `${digits.substring(0, 2).padStart(2, '0')}/0${digits.substring(2, 3)}/${new Date().getFullYear()}`;
                        } else if (digits.length === 4) {
                            val = `${digits.substring(0, 2).padStart(2, '0')}/${digits.substring(2, 4).padStart(2, '0')}/${new Date().getFullYear()}`;
                        } else if (digits.length === 8) {
                            val = `${digits.substring(0, 2).padStart(2, '0')}/${digits.substring(2, 4).padStart(2, '0')}/${digits.substring(4, 8)}`;
                        } else if (/^\d{2}\/\d{2}$/.test(val)) {
                            val = `${val}/${new Date().getFullYear()}`;
                        }
                    }
                }
                inp.value = val;
            }

            // Validasi Frame Warna Lampu Indikator
            if (isFinal) {
                if (!isValidDateString(inp.value)) { 
                    inp.style.borderColor = '#dc3545'; inp.style.color = '#dc3545'; 
                    showToast('Format tanggal tidak sesuai. Gunakan format DD/MM/YYYY.', 'error'); 
                } else { 
                    inp.style.borderColor = '#0050A0'; inp.style.color = '#333'; 
                }
            } else {
                inp.style.borderColor = '#ccc'; inp.style.color = '#333';
            }
        }

        function validateSubmitDateRealtime(tglSEl, tglPElId) {
            let tglPStr = document.getElementById(tglPElId).value;
            let tglSStr = tglSEl.value;
            if(tglSStr.length === 10 && tglPStr.length === 10) {
                if(isValidDateString(tglSStr) && isValidDateString(tglPStr)) {
                    if(parseDateString(tglSStr) > parseDateString(tglPStr)) {
                        tglSEl.style.borderColor = '#dc3545'; tglSEl.style.color = '#dc3545';
                        setTimeout(() => {
                            customAlert('Tanggal Submit tidak boleh melewati Tanggal Proses.');
                            tglSEl.value = ''; 
                            tglSEl.style.borderColor = '#ccc'; tglSEl.style.color = '#333';
                        }, 50);
                    } else {
                        tglSEl.style.borderColor = '#0050A0'; tglSEl.style.color = '#333';
                    }
                }
            }
        }

        // --- Core Utilities: multi-currency tanpa konversi kurs ---
        const COMMON_CURRENCIES = ['IDR','USD','JPY','CNY','HKD','THB','SGD','EUR','GBP','AUD','MYR','KRW'];

        function normalizeCurrency(code) {
            let value = String(code || 'IDR').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(value)) return 'IDR';
            try { new Intl.NumberFormat('id-ID', { style: 'currency', currency: value }).format(0); return value; }
            catch (e) { return 'IDR'; }
        }

        function getCurrencyFractionDigits(currency) {
            try {
                return new Intl.NumberFormat('id-ID', { style: 'currency', currency: normalizeCurrency(currency) })
                    .resolvedOptions().maximumFractionDigits;
            } catch (e) { return 2; }
        }

        function parseCurrencyAmount(rawValue, currency = 'IDR') {
            if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : 0;
            let raw = String(rawValue == null ? '' : rawValue).trim();
            if (!raw) return 0;

            let negative = /^\s*-/.test(raw) || /^\s*\(/.test(raw);
            let clean = raw.replace(/[^0-9.,]/g, '');
            if (!clean) return 0;

            let lastDot = clean.lastIndexOf('.');
            let lastComma = clean.lastIndexOf(',');
            let decimalSeparator = null;
            let fractionDigits = getCurrencyFractionDigits(currency);

            if (fractionDigits > 0) {
                if (lastDot >= 0 && lastComma >= 0) {
                    decimalSeparator = lastDot > lastComma ? '.' : ',';
                } else {
                    let separator = lastDot >= 0 ? '.' : (lastComma >= 0 ? ',' : null);
                    if (separator) {
                        let occurrences = clean.split(separator).length - 1;
                        let digitsAfter = clean.length - clean.lastIndexOf(separator) - 1;
                        if (digitsAfter > 0 && digitsAfter <= fractionDigits && occurrences === 1) decimalSeparator = separator;
                    }
                }
            }

            let normalized;
            if (decimalSeparator) {
                let decimalIndex = clean.lastIndexOf(decimalSeparator);
                let integerPart = clean.slice(0, decimalIndex).replace(/[.,]/g, '');
                let decimalPart = clean.slice(decimalIndex + 1).replace(/[.,]/g, '').slice(0, fractionDigits);
                normalized = `${integerPart || '0'}.${decimalPart || '0'}`;
            } else {
                normalized = clean.replace(/[.,]/g, '');
            }

            let amount = Number(normalized);
            if (!Number.isFinite(amount)) return 0;
            return negative ? -Math.abs(amount) : amount;
        }

        function formatAmountValue(value, currency = 'IDR') {
            const code = normalizeCurrency(currency);
            const fractionDigits = getCurrencyFractionDigits(code);
            const amount = Number(value) || 0;
            return new Intl.NumberFormat('id-ID', {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits
            }).format(amount);
        }

        function formatEditableAmountValue(value, currency = 'IDR') {
            const code = normalizeCurrency(currency);
            const fractionDigits = getCurrencyFractionDigits(code);
            return new Intl.NumberFormat('id-ID', {
                minimumFractionDigits: 0,
                maximumFractionDigits: fractionDigits
            }).format(Number(value) || 0);
        }

        function formatMoney(value, currency = 'IDR') {
            const code = normalizeCurrency(currency);
            return `${code} ${formatAmountValue(value, code)}`;
        }

        function amountsEqual(a, b, currency = 'IDR') {
            const digits = getCurrencyFractionDigits(currency);
            const tolerance = Math.pow(10, -digits) / 2;
            return Math.abs((Number(a) || 0) - (Number(b) || 0)) < tolerance;
        }

        function getInputCurrency(inp) {
            if (inp && inp.closest && inp.closest('#detail-table-area') && typeof currentDetailClaimId !== 'undefined' && currentDetailClaimId) {
                let detailClaim = dbRekap.find(item => item.id === currentDetailClaimId);
                return normalizeCurrency(detailClaim && detailClaim.mataUang);
            }
            if (inp && (String(inp.id || '').startsWith('qk-') || (inp.closest && inp.closest('#menu-claim-quick')))) {
                let qkCurrency = document.getElementById('qk-currency');
                return normalizeCurrency(qkCurrency && qkCurrency.value);
            }
            if (typeof currentEditingId !== 'undefined' && currentEditingId && inp && inp.closest && inp.closest('#modal-add-adjust')) {
                let currentClaim = dbRekap.find(item => item.id === currentEditingId);
                return normalizeCurrency(currentClaim && currentClaim.mataUang);
            }
            let hdrCurrency = document.getElementById('hdr-currency');
            return normalizeCurrency(hdrCurrency && hdrCurrency.value);
        }

        // Nama lama dipertahankan agar seluruh modul existing tetap kompatibel.
        function parseRupiah(str, currency = 'IDR') { return parseCurrencyAmount(str, currency); }
        function formatRupiahInput(inp) {
            const currency = getInputCurrency(inp);
            const raw = String(inp.value || '');
            if (!raw.trim() || raw === '-') return;
            const fractionDigits = getCurrencyFractionDigits(currency);
            const trailingDecimal = fractionDigits > 0 && /[.,]$/.test(raw);
            inp.value = formatEditableAmountValue(parseCurrencyAmount(raw, currency), currency) + (trailingDecimal ? ',' : '');
        }

        function ensureCurrencyOption(selectEl, currency) {
            if (!selectEl) return;
            const code = normalizeCurrency(currency);
            if (!Array.from(selectEl.options).some(opt => opt.value === code)) {
                selectEl.insertAdjacentHTML('beforeend', `<option value="${code}">${code}</option>`);
            }
            selectEl.value = code;
        }

        function handleCurrencyChange(mode) {
            const isQuick = mode === 'quick';
            const selectEl = document.getElementById(isQuick ? 'qk-currency' : 'hdr-currency');
            const code = normalizeCurrency(selectEl ? selectEl.value : 'IDR');
            const previousCode = normalizeCurrency(selectEl && selectEl.dataset.previousCurrency ? selectEl.dataset.previousCurrency : code);
            const label = document.getElementById(isQuick ? 'qk-currency-label' : 'hdr-currency-label');
            if (label) label.innerText = code;

            if (isQuick) {
                let amountInput = document.getElementById('qk-amount');
                if (amountInput && amountInput.value) amountInput.value = formatEditableAmountValue(parseCurrencyAmount(amountInput.value, previousCode), code);
                if(typeof currentEditingId !== 'undefined' && currentEditingId) {
                    let existing = dbRekap.find(item => item.id === currentEditingId);
                    let noteInput = document.getElementById('qk-adj-note');
                    if(existing && noteInput && getClaimCurrency(existing) !== code) noteInput.style.display = 'block';
                }
            } else {
                ['line-currency-label','line-total-currency'].forEach(id => { let el = document.getElementById(id); if(el) el.innerText = code; });
                let headerInput = document.getElementById('hdr-amount-total');
                if (headerInput && headerInput.value) headerInput.value = formatEditableAmountValue(parseCurrencyAmount(headerInput.value, previousCode), code);
                document.querySelectorAll('.line-amount').forEach(input => { if(input.value) input.value = formatEditableAmountValue(parseCurrencyAmount(input.value, previousCode), code); });
                if (typeof calculateBalance === 'function') calculateBalance();
                if (typeof updateSelectionSum === 'function') updateSelectionSum();
            }
            if(selectEl) selectEl.dataset.previousCurrency = code;
        }
        function parseDateString(str) { 
            if(!str || str === '-') return 0; 
            let cleanStr = str.split(' ')[0].split(',')[0]; 
            let p = cleanStr.split('/'); 
            if(p.length === 3) return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime(); 
            return 0; 
        }
        
        function setMobileSidebarOpen(open) {
            const sidebar = document.getElementById('app-sidebar');
            const trigger = document.getElementById('mobile-menu-trigger');
            const backdrop = document.getElementById('sidebar-backdrop');
            if(!sidebar) return;
            sidebar.classList.toggle('active-mobile', !!open);
            document.body.classList.toggle('mobile-sidebar-open', !!open);
            sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
            if(trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            if(backdrop) backdrop.tabIndex = open ? 0 : -1;
        }

        function closeMobileSidebar() {
            setMobileSidebarOpen(false);
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('app-sidebar');
            if(!sidebar) return;
            if(window.innerWidth <= 850) {
                setMobileSidebarOpen(!sidebar.classList.contains('active-mobile'));
            } else {
                closeMobileSidebar();
                sidebar.classList.toggle('collapsed');
                sidebar.removeAttribute('aria-hidden');
            }
        }

        function runLoader(text, cb) {
    if(cb) cb(); 
}

        function getSLASubmitToRTP(tglSubmit, tglRTP) {
            if(!tglSubmit || !tglRTP) return '-';
            let p1 = tglSubmit.split('/'); if(p1.length !== 3) return '-';
            let d1 = new Date(p1[2], p1[1]-1, p1[0]); d1.setHours(0,0,0,0);
            
            let rtpMatch = tglRTP.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
            if(!rtpMatch) return '-';
            let d2 = new Date(rtpMatch[3], rtpMatch[2]-1, rtpMatch[1]); d2.setHours(0,0,0,0);
            
            let diff = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
            return diff < 0 ? '0 Hari' : diff + ' Hari';
        }

        function toggleAccordion(id) { document.querySelectorAll('.nav-sub-container').forEach(el => { if(el.id !== id) el.classList.remove('open'); }); document.getElementById(id).classList.toggle('open'); }
        
        window.currentOpenMenu = '';
        window.hasAlertedRevise = false;

function changeMenu(menuId, isBackAction = false) {
    // Viewer hanya mempunyai satu route aplikasi. Ini bukan sekadar hide menu:
    // pemanggilan fungsi langsung pun selalu diarahkan kembali ke Cari Claim.
    if(sessionRole === 'viewer' && menuId !== 'super-find') {
        menuId = 'super-find';
        isBackAction = true;
        window.menuHistoryStack = [];
    }
    if(menuId === 'master-content' && !isAppAdmin()) {
        showToast('Editor teks hanya dapat diakses Admin.', 'error');
        menuId = 'home';
        isBackAction = true;
    }
    closeExcelFilter();
    
    if (menuId === 'home' && !isBackAction) {
        window.menuHistoryStack = [];
    } else if (!isBackAction && window.currentOpenMenu && window.currentOpenMenu !== menuId) {
        window.menuHistoryStack.push(window.currentOpenMenu);
    }

    runLoader("Memuat...", () => {
        // 1. Bersihkan semua layar dan warna menu aktif
        document.querySelectorAll('.content-card').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active-menu'));
        document.querySelectorAll('.nav-sub-item').forEach(i => i.classList.remove('active-sub'));
        
        // 2. Tampilkan layar yang dituju
        let targetMenu = document.getElementById(`menu-${menuId}`);
        if (targetMenu) targetMenu.classList.add('active');
        
        // 3. Nyalakan warna menu di Sidebar kiri
        if(menuId === 'home') document.getElementById('nav-home').classList.add('active-menu');
        if(menuId.startsWith('claim-') && !['claim-rekap','claim-revise'].includes(menuId)) document.querySelector('#claim-dropdown').previousElementSibling.classList.add('active-menu');
        // Claim History berdiri sendiri di bawah Rekapitulasi, jadi tidak lagi
        // menyalakan grup Data Klaim.
        if(['in-process','claim-revise','waiting-approval','canceled'].includes(menuId)) document.querySelector('#claim-data-dropdown').previousElementSibling.classList.add('active-menu');
        if(['ready-payment','payment-paid','payment-hold','payment-return'].includes(menuId)) document.querySelector('#payment-dropdown').previousElementSibling.classList.add('active-menu');
        if(menuId.includes('master')) document.querySelector('#master-dropdown').previousElementSibling.classList.add('active-menu');
        if(menuId === 'super-find') document.getElementById('nav-super-find').classList.add('active-menu');
        if(menuId === 'claim-rekap') document.getElementById('nav-claim-rekap').classList.add('active-menu');
        if(menuId === 'history') document.getElementById('nav-history').classList.add('active-menu');
        if(menuId === 'statistik') document.getElementById('nav-statistik').classList.add('active-menu');
if(menuId === 'executive') document.getElementById('nav-executive').classList.add('active-menu');
        
        let subMenu = document.getElementById(`nav-${menuId}`); 
        if(subMenu && subMenu.classList.contains('nav-sub-item')) {
            subMenu.classList.add('active-sub');
        }

        window.currentOpenMenu = menuId;
        document.body.classList.toggle('finance-create-mode', isFinanceRole() && menuId === 'claim-quick' && currentEditingId === null);
        if(menuId !== 'claim-revise') window.hasAlertedRevise = false;

        if(window.innerWidth <= 850) closeMobileSidebar();

        // 4. Eksekusi render tabel/data sesuai menu yang dipilih
        if(menuId === 'claim-input' && currentEditingId === null) resetFormAdd();
        if(menuId === 'claim-quick' && currentEditingId === null) resetQuickForm();
        if(menuId === 'claim-revise') {
            const archiveContent = document.getElementById('arsip-content-main');
            if(archiveContent) archiveContent.style.display = 'none';
            const archiveToggle = document.querySelector('#revise-arsip-container .toggle-icon');
            if(archiveToggle) archiveToggle.innerText = '▶ Perluas';
            updateFilterIconHighlight('revise'); renderReviseConfirm();
        }
        if(menuId === 'claim-rekap') { updateFilterIconHighlight('rekap'); renderRekapTable(); }
        if(menuId === 'in-process' && typeof renderInProcessTable === 'function') renderInProcessTable();
        if(menuId === 'canceled' && typeof renderCanceledTable === 'function') renderCanceledTable();
        if(menuId === 'history') { updateFilterIconHighlight('history'); renderHistoryTable(); }
        if(menuId === 'master-gl') renderMasterGL();
        if(menuId === 'master-karyawan') renderMasterKaryawan();
        if(menuId === 'master-calendar' && typeof renderSlaCalendar === 'function') renderSlaCalendar();
        if(menuId === 'master-backup') renderBackupLog();
        if(menuId === 'master-user') {
            renderMasterUser();
            subscribeRoleDirectory();
            if(typeof window.ensureActivityLogSubscription === 'function') window.ensureActivityLogSubscription();
        }
        if(menuId === 'master-content' && typeof window.renderUiCopyEditor === 'function') window.renderUiCopyEditor();
        if(menuId === 'super-find') { updateFilterIconHighlight('super-find'); renderSuperFindTable(); }
        if(menuId === 'statistik' && typeof renderStatistikData === 'function') renderStatistikData();
        if(menuId === 'waiting-approval' && typeof window.renderWaitingTable === 'function') window.renderWaitingTable();
        if(menuId === 'ready-payment' && typeof window.renderReadyPaymentTable === 'function') { updateFilterIconHighlight('ready-payment'); window.renderReadyPaymentTable(); }
        if(menuId === 'payment-paid' && typeof window.renderPaymentPaidTable === 'function') { updateFilterIconHighlight('payment-paid'); window.renderPaymentPaidTable(); }
        if(menuId === 'payment-hold' && typeof window.renderPaymentHoldTable === 'function') { updateFilterIconHighlight('payment-hold'); window.renderPaymentHoldTable(); }
        if(menuId === 'payment-return' && typeof window.renderPaymentReturnTable === 'function') { updateFilterIconHighlight('payment-return'); window.renderPaymentReturnTable(); }
        if(menuId === 'claim-catatan-detail' && typeof renderCatatanDetailTable === 'function') { updateFilterIconHighlight('catatan-detail'); renderCatatanDetailTable(); }
if(menuId === 'executive' && typeof renderExecutiveDashboard === 'function') renderExecutiveDashboard();

        // resetFormAdd()/resetQuickForm() menyalakan ulang field saat layar dibuka,
        // jadi kunci hanya-baca dipasang lagi setelah render selesai.
        if(typeof applyReadOnlyFormLock === 'function') applyReadOnlyFormLock();
    });
    
    updateBackButtonVisibility();
}
        // --- Reference Doc Modal ---
        function openDocModal(targetId) {
            currentDocTargetId = targetId; 
            let val = document.getElementById(targetId).dataset.value || "";
            // Ubah format "Koma + Spasi" jadi baris ke bawah (Enter) pas modal dibuka
            document.getElementById('doc-input-area').value = val.split(', ').join('\n'); 
            
            document.getElementById('doc-input-area').readOnly = viewMode;
            document.getElementById('btn-save-doc-modal').style.display = viewMode ? 'none' : 'inline-block';
            
            document.getElementById('modal-doc').style.display = 'flex';
            setTimeout(() => document.getElementById('doc-input-area').focus(), 100);
        }
        
        function saveDocModal() {
            if(currentDocTargetId) { 
                let rawVal = document.getElementById('doc-input-area').value.trim();
                let compressed = compressDocNumbers(rawVal);
                let targetEl = document.getElementById(currentDocTargetId);
            
                targetEl.dataset.value = rawVal;

                targetEl.value = compressed ? `Ref: ${compressed}` : "Referensi Dokumen";
                
                showToast('Referensi dokumen berhasil disimpan.', 'success');
            }
            
            closeModal('modal-doc'); 
           
        }

        // --- Database & Auto Backup Setup ---
        let masterGL = [{tipe: "Operasional", gl: "Bensin"}, {tipe: "Traveling", gl: "Daily Allowance"}];
        let masterKaryawan = [{ nik: "22043", nama: "Rama Al Mahi", entitas: "AIO" }];
        let dbRekap = [];
        let currentEditingId = null;
        let viewMode = false;

        async function initApp() {
    try {
        // Ambil data secara aman dari IndexedDB
        dbRekap = await dbGetAll('claims');
        masterGL = await dbGetAll('gl');
        masterKaryawan = await dbGetAll('karyawan');
    } catch(e) { 
        console.error("Error membaca IndexedDB:", e); 
    }
if(!dbRekap || dbRekap.length === 0) dbRekap = [];
if(!masterGL || masterGL.length === 0) masterGL = [{tipe: "Operasional", gl: "Bensin"}, {tipe: "Traveling", gl: "Daily Allowance"}];
// Bentuk master diseragamkan satu kali begitu dimuat, apa pun asalnya (cache
// lokal, cloud, atau bawaan). Penyeragaman tidak pernah mengosongkan daftar
// yang sumbernya tidak kosong.
if(typeof normalizeMasterTipe === 'function') {
    const seragam = normalizeMasterTipe(masterGL);
    if(seragam.length) masterGL = seragam;
}
if(!masterKaryawan || masterKaryawan.length === 0) masterKaryawan = [{ nik: "9999", nama: "Rama Al Mahi", entitas: "AIO", departemen: "Accounting" }];
    
    dbRekap.forEach(d => {
        if(d.statusClaim === "Process") d.statusClaim = "In Process";
        if(d.statusClaim === "Revise") d.statusClaim = "Revisi";
        if(d.statusClaim === "Settled (RTP)") d.statusClaim = "Posted";
        if(d.isArchived === undefined) d.isArchived = false;
        d.mataUang = normalizeCurrency(d.mataUang || 'IDR');
        if (!Number.isFinite(Number(d._version))) d._version = 0;
        if (!d.workflowTimestamps) d.workflowTimestamps = {};
    });
    if(typeof initializePersistenceBaselines === 'function') initializePersistenceBaselines();
    if(typeof initializeClaimCacheState === 'function') initializeClaimCacheState();

    let lastUpd = localStorage.getItem('otsukaDBUpdate_v16'); 
    if(lastUpd) document.getElementById('db-last-update').innerText = lastUpd;
    
    changeMenu('home');
    // Counter antrean Data Payment dihitung sekali begitu cache lokal selesai
    // dimuat. Tanpa ini angkanya baru terisi saat salah satu halaman Data
    // Payment dibuka atau ada penyimpanan berikutnya. Murni perhitungan atas
    // dbRekap yang sudah ada di memori: tanpa listener dan tanpa baca cloud.
    if(typeof window.updateDataPaymentCounters === 'function') window.updateDataPaymentCounters();
    if(typeof window.updateAccountingQueueCounters === 'function') window.updateAccountingQueueCounters();
    if(typeof schedulePostSaveMaintenance === 'function') schedulePostSaveMaintenance();
    if(typeof scheduleAutomaticBackup === 'function') scheduleAutomaticBackup();
}

       window.calcStats = function() {
    let periodEl = document.getElementById('stat-filter');
    if (!periodEl) return;
    let period = periodEl.value;
    let customDateArea = document.getElementById('custom-date-filter');
    
    if(period === 'custom') {
            if(customDateArea) customDateArea.style.display = 'flex';
        } else {
            if(customDateArea) customDateArea.style.display = 'none';
            let rangeInput = document.getElementById('stat-range-date');
            
            // --- FIX ANTI CRASH (INFINITE LOOP) ---
            // Hanya hapus kalender jika ada isinya, dan gunakan (false) agar tidak memicu onChange berulang
            if(rangeInput && rangeInput._flatpickr && rangeInput.value !== "") {
                rangeInput._flatpickr.clear(false); 
            } 
        }

    let p=0, r=0, rtp=0, w=0;
    let selectedRange = null;
    let rangeInputEl = document.getElementById('stat-range-date');
        let rangeVal = rangeInputEl ? rangeInputEl.value : "";

    // Ngebaca pemisah panah custom dari Flatpickr
    if (period === 'custom' && rangeVal !== "") {
        let sep = rangeVal.includes(" ➔ ") ? " ➔ " : (rangeVal.includes(" to ") ? " to " : null);
        if (sep) {
            let parts = rangeVal.split(sep);
            selectedRange = [parts[0], parts[1]];
        } else {
            selectedRange = [rangeVal, rangeVal];
        }
    }
    if(period !== 'all' && period !== 'custom' && typeof window.getReportingPresetRange === 'function') selectedRange = window.getReportingPresetRange(period);
    const dashboardSource = dbRekap.filter(item => isClaimActiveForAnalytics(item));
    const filteredClaims = period === 'all' ? dashboardSource : (typeof window.filterClaimsByReportingRange === 'function' ? window.filterClaimsByReportingRange(dashboardSource, selectedRange) : []);

    filteredClaims.forEach(d => {
            if(d.statusClaim === 'In Process') p++;
            if(d.statusClaim === 'Revisi' || d.statusClaim === 'Confirm') r++;
            if(d.statusClaim === 'Waiting Approval') w++;
            if(isFinalClaimStatus(d.statusClaim)) rtp++;
    });

    // Update SEMUA angka ke layar dashboard
    let elP = document.getElementById('stat-val-process'); if(elP) elP.innerText = p;
    let elR = document.getElementById('stat-val-revise'); if(elR) elR.innerText = r;
    let elW = document.getElementById('stat-val-waiting'); if(elW) elW.innerText = w;
    let elRtp = document.getElementById('stat-val-rtp'); if(elRtp) elRtp.innerText = rtp;
};

        // --- Inisialisasi Flatpickr saat web dimuat ---
        onWorksheetReady(function() {
            ensureWorksheetCalendar("#stat-range-date", {
                mode: "range",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d M Y",
                altInputClass: "modern-flatpickr-input",
                locale: {
                    rangeSeparator: " ➔ ",
                    months: {
                        shorthand: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
                        longhand: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
                    }
                },
                onChange: function(selectedDates, dateStr, instance) {
                    calcStats(); // Hitung ulang statistik tiap kali tanggal dipilih
                }
            });
        });
        function renderDashboardUrgent() {
            let tbody = document.getElementById('tbody-urgent-dashboard');
            tbody.innerHTML = '';
            let now = Date.now();
            
            let urgentData = dbRekap.filter(i => {
                if(!i.isArchived && (i.statusClaim === 'Revisi' || i.statusClaim === 'Confirm') && i.reviseTimestamp) {
                    let diffDays = Math.floor((now - i.reviseTimestamp) / (1000 * 60 * 60 * 24));
                    return diffDays >= 3;
                }
                return false;
            });

            if(urgentData.length > 0) {
                document.getElementById('urgent-dashboard').style.display = 'block';
                tbody.innerHTML = urgentData.map(item => {
                    let diffDays = Math.floor((now - item.reviseTimestamp) / (1000 * 60 * 60 * 24));
                    return `<tr>
                        <td>${escapeActivityLogText(item.tglSubmit || '-')}</td>
                        <td><strong>${escapeActivityLogText(item.nama || '-')}</strong><br><span style="font-size:11px;color:#777;">${escapeActivityLogText(item.nik || '-')}</span></td>
                        <td>${escapeActivityLogText(item.tipe || '-')}</td>
                        <td><strong style="color:#0050A0;">${formatClaimMoney(item)}</strong></td>
                        <td><span class="badge status-revise">${escapeActivityLogText(item.statusClaim || '-')}</span><br><span style="color:#dc3545; font-size:11px; font-weight:bold;">Terlambat ${diffDays} hari</span></td>
                        <td><button class="btn btn-primary" style="font-size:11px; padding:4px 8px;" onclick="changeMenu('claim-revise')">Lihat Detail ▶</button></td>
                    </tr>`;
                }).join('');
            } else {
                document.getElementById('urgent-dashboard').style.display = 'none';
            }
        }

        // --- Storage Size Calculator (REALTIME INDEXEDDB QUOTA) ---
async function updateStorageSizeDisplay() {
    // Fungsi ini dipanggil setelah SETIAP penyimpanan lewat
    // schedulePostSaveMaintenance(). Kedua elemen tujuannya sudah tidak ada lagi
    // pada index.html, sehingga seluruh pekerjaannya terbuang: pemanggilan
    // navigator.storage.estimate(), dan pada browser tanpa Storage API sebuah
    // JSON.stringify() atas seluruh dbRekap. Hitungan dihentikan lebih awal bila
    // tidak ada yang menampilkannya, dan tetap berjalan apa adanya bila
    // elemennya dipasang kembali.
    let elUsage = document.getElementById('db-size-usage');
    let elQuota = document.getElementById('db-size-quota');
    if(!elUsage && !elQuota) return;

    let usageTxt = "0 KB";
    let quotaTxt = "Unlimited";
    let mbUsage = 0;

    if (navigator.storage && navigator.storage.estimate) {
        try {
            const estimate = await navigator.storage.estimate();
            
            // 1. Kalkulasi Ukuran yang Terpakai (Usage)
            let totalBytes = estimate.usage || 0;
            let kb = totalBytes / 1024;
            mbUsage = kb / 1024;
            usageTxt = mbUsage >= 0.01 ? `${mbUsage.toFixed(2)} MB` : `${kb.toFixed(0)} KB`;
            
            // 2. Kalkulasi Total Jatah Kuota dari Harddisk/SSD (Quota)
            let quotaBytes = estimate.quota || 0;
            let quotaKb = quotaBytes / 1024;
            let quotaMb = quotaKb / 1024;
            let quotaGb = quotaMb / 1024;
            
            if (quotaGb >= 1) {
                quotaTxt = `~${quotaGb.toFixed(1)} GB`;
            } else if (quotaMb >= 1) {
                quotaTxt = `~${quotaMb.toFixed(0)} MB`;
            }
        } catch(e) {
            console.error("Gagal membaca storage estimate:", e);
        }
    } else {
        // Fallback hitungan teks karakter jika browser jadul
        let totalBytes = (JSON.stringify(dbRekap).length + JSON.stringify(masterGL).length + JSON.stringify(masterKaryawan).length) * 2;
        let kb = totalBytes / 1024;
        mbUsage = kb / 1024;
        usageTxt = mbUsage >= 0.01 ? `${mbUsage.toFixed(2)} MB` : `${kb.toFixed(0)} KB`;
    }
    
    if(elUsage) elUsage.innerText = usageTxt;
    if(elQuota) elQuota.innerText = quotaTxt;
    
    // Karena kapasitas IndexedDB super lega, warna merah aktif hanya jika database bengkak extreme (> 500MB)
    if(elUsage) {
        elUsage.style.color = mbUsage > 500.0 ? '#dc3545' : '#28a745'; 
    }
}

function toggleSelectAll(master, className) {
    const module = className.replace('-checkbox', '');
    const selectionSet = window.globalSelections && window.globalSelections[module];

    // Tabel master/user tidak memakai keranjang lintas halaman.
    if(!selectionSet) {
        document.querySelectorAll(`.${className}`).forEach(cb => { cb.checked = master.checked; });
        return;
    }

    let filtered = getFilteredRowsForSource(module);

    // Ready to Payment hanya boleh dipilih massal bila hardcopy sudah diterima.
    // Baris yang belum eligible tetap tampil di tabel, tetapi tidak ikut "Pilih semua".
    if(module === 'ready-payment' && typeof isClaimHardcopyReceived === 'function') {
        filtered = filtered.filter(item => isClaimHardcopyReceived(item));
    }

    filtered.forEach(item => {
        if(master.checked) selectionSet.add(item.id);
        else selectionSet.delete(item.id);
    });
    document.querySelectorAll(`.${className}`).forEach(cb => {
        if(cb.disabled) { cb.checked = false; return; }
        cb.checked = master.checked;
    });
}

        function deleteAllDataFromView(modulSource) {
            if(!requireAdmin()) return;
            customConfirm(`⚠ PERINGATAN ⚠\nApakah Anda yakin ingin menghapus seluruh data yang tampil sesuai filter secara permanen?`, async () => {
                const backupBeforeDelete = JSON.parse(JSON.stringify(dbRekap));
                let idsToDelete = [];
                if(modulSource === 'rekap') {
                    document.querySelectorAll('.rekap-checkbox').forEach(cb => idsToDelete.push(parseInt(cb.getAttribute('data-id'))));
                } else if(modulSource === 'history') {
                    document.querySelectorAll('.history-checkbox').forEach(cb => idsToDelete.push(parseInt(cb.getAttribute('data-id'))));
                } else if(modulSource === 'revise') {
                    let toDel = typeof getFilteredRowsForSource === 'function'
                        ? getFilteredRowsForSource('revise-active')
                        : dbRekap.filter(i => i.statusClaim === 'Revisi');
                    idsToDelete = toDel.map(i => i.id);
                }
                
                if(idsToDelete.length === 0) return showToast('Tidak terdapat data untuk dihapus.', 'info');

                dbRekap = dbRekap.filter(i => !idsToDelete.includes(i.id));
                try {
                    await saveDataToLocal({ claimIds: idsToDelete });
                } catch(error) {
                    if(typeof window.restoreClaimsAfterConflict === 'function' && await window.restoreClaimsAfterConflict(error)) return;
                    dbRekap = backupBeforeDelete;
                    await dbSyncClaimRows(idsToDelete).catch(() => {});
                    return showToast('Penyimpanan lokal gagal; data dikembalikan.', 'error');
                }
                logActivity(sessionUser, `Penghapusan Seluruh Data pada Tampilan ${modulSource} (${idsToDelete.length} data)`);
                if(modulSource === 'rekap') renderRekapTable();
                if(modulSource === 'history') renderHistoryTable();
                if(modulSource === 'revise') renderReviseConfirm();
                showToast(`${idsToDelete.length} data berhasil dihapus.`, 'success');
            });
        }

        // --- Simulate Jurnal ---
        function openSimulate() {
            let currency = normalizeCurrency(document.getElementById('hdr-currency') ? document.getElementById('hdr-currency').value : 'IDR');
            let tbody = document.getElementById('tbody-simulate');
            tbody.innerHTML = '';
            let summary = {};
            let grandTotal = 0;

            document.querySelectorAll('#tbody-line-items tr').forEach(row => {
                let glEl = row.querySelector('.line-gl');
                let amtEl = row.querySelector('.line-amount');
                if(glEl && amtEl) {
                    let gl = glEl.value.trim() || 'Unspecified GL';
                    let amt = parseCurrencyAmount(amtEl.value, currency);
                    if(amt > 0) {
                        if(!summary[gl]) summary[gl] = 0;
                        summary[gl] += amt;
                        grandTotal += amt;
                    }
                }
            });

            if(Object.keys(summary).length === 0) {
                tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:15px; color:#777;">Belum terdapat data rincian baris atau Amount.</td></tr>';
            } else {
                for(let gl in summary) {
                    tbody.innerHTML += `<tr><td style="padding:8px 10px; border-bottom:1px solid #eee;"><strong>${gl}</strong></td><td style="padding:8px 10px; border-bottom:1px solid #eee; text-align:right;">${formatMoney(summary[gl], currency)}</td></tr>`;
                }
            }
            document.getElementById('sim-grand-total').innerText = formatMoney(grandTotal, currency);
            document.getElementById('modal-simulate').style.display = 'flex';
        }

        // --- Adjustment History Modal ---
        // --- Adjustment History Modal ---
        function openAdjustHistory() {
            let data = dbRekap.find(i => i.id === currentEditingId);
            if(!data || !data.adjustments || data.adjustments.length === 0) return;
            let adjustmentReadOnly = !canEditClaims() || isClaimFinanciallyLocked(data) || viewMode;
            let undoGroup = document.getElementById('undo-btn-group');
            if(undoGroup) undoGroup.style.display = adjustmentReadOnly ? 'none' : 'flex';
            
            let btnUndo = document.getElementById('btn-undo-last');
            if(btnUndo) {
                btnUndo.innerHTML = '↩ Batal Terakhir';
                btnUndo.onclick = undoLastAdjustment;
                btnUndo.classList.remove('btn-primary');
                btnUndo.classList.add('btn-danger');
            }

            let html = '';
            data.adjustments.slice().reverse().forEach((adj, revIdx) => {
                let actualIdx = data.adjustments.length - 1 - revIdx;
                let diff = adj.newVal - adj.oldVal;
                let oldCurrency = normalizeCurrency(adj.oldCurrency || adj.currency || getClaimCurrency(data));
                let newCurrency = normalizeCurrency(adj.newCurrency || adj.currency || getClaimCurrency(data));
                let currencyChanged = oldCurrency !== newCurrency;
                let color = currencyChanged ? '#0050A0' : (diff > 0 ? '#dc3545' : (diff < 0 ? '#28a745' : '#888'));
                let symbol = currencyChanged ? `Mata Uang ${oldCurrency} → ${newCurrency}` : (diff > 0 ? '▲ Naik' : (diff < 0 ? '▼ Turun' : '▪ Tetap'));
                let detailTxt = adj.type === 'Line' ? `Baris ${adj.row} - GL: ${adj.gl}` : (adj.type === 'Detail' ? `Detail Nota` : `Total Amount`);
                
                // Tambahan Checkbox & Komen
                // Hanya adjustment paling akhir yang boleh dibatalkan satuan. Ini menjaga urutan audit
                // dan mencegah total rusak akibat membatalkan transaksi di tengah rantai.
                let isLatestAdjustment = actualIdx === data.adjustments.length - 1;
                let chkHtml = (!adjustmentReadOnly && isLatestAdjustment) ? `<input type="checkbox" class="adj-checkbox" data-idx="${actualIdx}" onchange="toggleAdjCheck()" style="margin-top:2px; transform:scale(1.2); cursor:pointer;">` : '<span title="Batalkan adjustment secara berurutan dari yang paling akhir">🔒</span>';
                let noteHtml = adj.note ? `<div style="font-size:11px; color:#555; background:#eef4fc; padding:5px 8px; margin-top:6px; border-radius:4px; border-left:3px solid #0050A0;">💬 <b>Catatan:</b> ${adj.note}</div>` : '';

                html += `<div style="padding:10px; border:1px solid #eee; margin-bottom:10px; border-radius:6px; background:#fdfdfd; display:flex; gap:12px; align-items:flex-start;">
                    ${chkHtml}
                    <div style="flex:1;">
                        <div style="font-size:11px; color:#777; margin-bottom:5px; display:flex; justify-content:space-between;">
                            <span>🕒 ${adj.date} | Oleh: <strong>${getShortUsernameHtml(adj.by)}</strong></span>
                            <span class="badge status-process">${detailTxt}</span>
                        </div>
                        <div style="font-size:13px; display:flex; justify-content:space-between; align-items:center;">
                            <span><strike style="color:#999;">${formatMoney(adj.oldVal, oldCurrency)}</strike> ➔ <strong>${formatMoney(adj.newVal, newCurrency)}</strong></span>
                            <span style="color:${color}; font-size:11px; font-weight:bold;">${symbol}${currencyChanged ? '' : ` ${formatMoney(Math.abs(diff), newCurrency)}`}</span>
                        </div>
                        ${noteHtml}
                    </div>
                </div>`;
            });

            document.getElementById('adjustments-list').innerHTML = html;
            document.getElementById('modal-adjustments').style.display = 'flex';
        }

        function revertAdjustmentInMemory(data, adj) {
            const currency = normalizeCurrency(adj.currency || adj.newCurrency || getClaimCurrency(data));
            const delta = (Number(adj.newVal) || 0) - (Number(adj.oldVal) || 0);

            if(adj.type === 'Manual') {
                if(!data.isQuick && Array.isArray(data.lines)) {
                    let lineIdx = adj.lineId ? data.lines.findIndex(line => line.id === adj.lineId) : -1;
                    if(lineIdx < 0) {
                        // Kompatibilitas adjustment lama yang belum memiliki lineId.
                        for(let i = data.lines.length - 1; i >= 0; i--) {
                            const line = data.lines[i];
                            if(line.gl === 'Adjustment System' && amountsEqual(line.amount, delta, currency)) { lineIdx = i; break; }
                        }
                    }
                    if(lineIdx >= 0) data.lines.splice(lineIdx, 1);
                }
                data.totalHeader = (Number(data.totalHeader) || 0) - delta;
            } else if(adj.type === 'Detail' || adj.detailRowId) {
                data.totalHeader = (Number(data.totalHeader) || 0) - delta;
            } else if(data.isQuick) {
                data.totalHeader = (Number(data.totalHeader) || 0) - delta;
                if(adj.oldCurrency) data.mataUang = normalizeCurrency(adj.oldCurrency);
            } else {
                let lineIdx = adj.lineId && Array.isArray(data.lines) ? data.lines.findIndex(line => line.id === adj.lineId) : -1;
                if(lineIdx < 0 && Number.isInteger(Number(adj.row))) lineIdx = Number(adj.row) - 1;
                if(Array.isArray(data.lines) && data.lines[lineIdx]) {
                    data.lines[lineIdx].amount = Number(adj.oldVal) || 0;
                    if(adj.oldGL !== undefined) data.lines[lineIdx].gl = adj.oldGL;
                    if(adj.oldNote !== undefined) data.lines[lineIdx].note = adj.oldNote;
                }
                data.totalHeader = (Number(data.totalHeader) || 0) - delta;
            }

            const digits = getCurrencyFractionDigits(getClaimCurrency(data));
            data.totalHeader = Number(data.totalHeader.toFixed(digits));
        }

        function toggleAdjCheck() {
            let checkedCount = document.querySelectorAll('.adj-checkbox:checked').length;
            let btn = document.getElementById('btn-undo-last');
            if(btn) {
                if(checkedCount > 0) {
                    btn.innerHTML = `↩ Batal Pilihan (${checkedCount})`;
                    btn.onclick = undoSelectedAdjustments;
                    btn.classList.remove('btn-danger');
                    btn.classList.add('btn-primary'); // Paksa ganti ke biru
                } else {
                    btn.innerHTML = '↩ Batal Terakhir';
                    btn.onclick = undoLastAdjustment;
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-danger'); // Paksa balik ke merah
                }
            }
        }

        function undoSelectedAdjustments() {
            if(!requireClaimEditor()) return;
            let data = dbRekap.find(i => i.id === currentEditingId);
            if(!data || isClaimFinanciallyLocked(data)) return showToast('Data terkunci (Posted/Paid/Hold) bersifat baca-saja.', 'error');
            if(window.adjustmentUndoInProgress) return showToast('Pembatalan penyesuaian masih diproses.', 'info');
            let checkedBoxes = Array.from(document.querySelectorAll('.adj-checkbox:checked'));
            if(checkedBoxes.length === 0) return;
            
            customConfirm(`Apakah Anda yakin ingin membatalkan ${checkedBoxes.length} penyesuaian yang dipilih?`, async () => {
                const backup = JSON.parse(JSON.stringify(data));
                const indicesToUndo = checkedBoxes.map(cb => parseInt(cb.getAttribute('data-idx'))).sort((a,b) => b - a);
                window.adjustmentUndoInProgress = true;
                try {
                    indicesToUndo.forEach(idx => {
                        const adj = data.adjustments[idx];
                        if(!adj) return;
                        revertAdjustmentInMemory(data, adj);
                        data.adjustments.splice(idx, 1);
                    });
                    if(!data.historyLog) data.historyLog = [];
                    data.historyLog.push({status: "Adjustment Pilihan Dibatalkan", time: new Date().toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}), by: sessionUser, note: `Revert ${indicesToUndo.length} item secara berurutan.`});
                    await saveDataToLocal({ claimIds: [data.id] });
                    window.adjustmentStayClaimId = data.id;
                } catch(error) {
                    if(window.restoreClaimsAfterConflict && await window.restoreClaimsAfterConflict(error)) return;
                    const restoreIdx = dbRekap.findIndex(item => item.id === backup.id);
                    if(restoreIdx >= 0) dbRekap[restoreIdx] = backup;
                    if(typeof dbSyncClaimRows === 'function') await dbSyncClaimRows([backup.id]).catch(() => {});
                    return showToast('Penyimpanan lokal gagal; data dikembalikan seperti semula.', 'error');
                } finally {
                    window.adjustmentUndoInProgress = false;
                }
                logActivity(sessionUser, `Pembatalan Penyesuaian Terpilih, Klaim ID: ${data.id}`);
                closeModal('modal-adjustments'); showToast('Penyesuaian yang dipilih berhasil dibatalkan.', 'success');
                if(data.isQuick) openEditQuickRekap(currentEditingId, viewMode); else openEditRekap(currentEditingId, viewMode);
            });
        }

        function undoLastAdjustment() {
            if(!requireClaimEditor()) return;
            let data = dbRekap.find(i => i.id === currentEditingId);
            if(!data || !data.adjustments || data.adjustments.length === 0) return showToast('Tidak terdapat riwayat penyesuaian.', 'error');
            if(isClaimFinanciallyLocked(data)) return showToast('Data terkunci (Posted/Paid/Hold) bersifat baca-saja.', 'error');
            if(window.adjustmentUndoInProgress) return showToast('Pembatalan penyesuaian masih diproses.', 'info');
            
            customConfirm("Apakah Anda yakin ingin membatalkan penyesuaian terakhir?", async () => {
                const backup = JSON.parse(JSON.stringify(data));
                const lastAdj = data.adjustments[data.adjustments.length - 1];
                window.adjustmentUndoInProgress = true;
                try {
                    revertAdjustmentInMemory(data, lastAdj);
                    data.adjustments.pop();
                    if(!data.historyLog) data.historyLog = [];
                    const oldCurrency = normalizeCurrency(lastAdj.oldCurrency || lastAdj.currency || getClaimCurrency(data));
                    data.historyLog.push({status: "Adjustment Dibatalkan", time: new Date().toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}), by: sessionUser, note: `Revert adjustment terakhir ke ${formatMoney(lastAdj.oldVal, oldCurrency)}.`});
                    await saveDataToLocal({ claimIds: [data.id] });
                    window.adjustmentStayClaimId = data.id;
                } catch(error) {
                    if(window.restoreClaimsAfterConflict && await window.restoreClaimsAfterConflict(error)) return;
                    const restoreIdx = dbRekap.findIndex(item => item.id === backup.id);
                    if(restoreIdx >= 0) dbRekap[restoreIdx] = backup;
                    if(typeof dbSyncClaimRows === 'function') await dbSyncClaimRows([backup.id]).catch(() => {});
                    return showToast('Penyimpanan lokal gagal; data dikembalikan seperti semula.', 'error');
                } finally {
                    window.adjustmentUndoInProgress = false;
                }
                logActivity(sessionUser, `Pembatalan Penyesuaian Terakhir, Klaim ID: ${data.id}`);
                closeModal('modal-adjustments'); showToast('Penyesuaian berhasil dibatalkan.', 'success');
                if(data.isQuick) openEditQuickRekap(currentEditingId, viewMode); else openEditRekap(currentEditingId, viewMode);
            });
        }

        function undoAllAdjustments() {
            if(!requireClaimEditor()) return;
            let data = dbRekap.find(i => i.id === currentEditingId);
            if(!data || !data.adjustments || data.adjustments.length === 0) return showToast('Tidak terdapat riwayat penyesuaian.', 'error');
            if(isClaimFinanciallyLocked(data)) return showToast('Data terkunci (Posted/Paid/Hold) bersifat baca-saja.', 'error');
            if(window.adjustmentUndoInProgress) return showToast('Pembatalan penyesuaian masih diproses.', 'info');
            
            customConfirm("⚠️ Apakah Anda yakin ingin membatalkan seluruh penyesuaian sekaligus?\nSistem akan membatalkannya satu per satu mulai dari transaksi terakhir.", async () => {
                const backup = JSON.parse(JSON.stringify(data));
                window.adjustmentUndoInProgress = true;
                try {
                    for(let i = data.adjustments.length - 1; i >= 0; i--) revertAdjustmentInMemory(data, data.adjustments[i]);
                    data.adjustments = [];
                    if(!data.historyLog) data.historyLog = [];
                    data.historyLog.push({status: "Semua Adjustment Dibatalkan", time: new Date().toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}), by: sessionUser, note: `Seluruh adjustment dibalik berurutan dari yang paling akhir.`});
                    await saveDataToLocal({ claimIds: [data.id] });
                    window.adjustmentStayClaimId = data.id;
                } catch(error) {
                    if(window.restoreClaimsAfterConflict && await window.restoreClaimsAfterConflict(error)) return;
                    const restoreIdx = dbRekap.findIndex(item => item.id === backup.id);
                    if(restoreIdx >= 0) dbRekap[restoreIdx] = backup;
                    if(typeof dbSyncClaimRows === 'function') await dbSyncClaimRows([backup.id]).catch(() => {});
                    return showToast('Penyimpanan lokal massal gagal; data dikembalikan seperti semula.', 'error');
                } finally {
                    window.adjustmentUndoInProgress = false;
                }
                logActivity(sessionUser, `Pembatalan Seluruh Penyesuaian, Klaim ID: ${data.id}`);
                closeModal('modal-adjustments'); showToast('Seluruh penyesuaian berhasil dibatalkan.', 'success');
                if(data.isQuick) openEditQuickRekap(currentEditingId, viewMode); else openEditRekap(currentEditingId, viewMode);
            });
        }
        // --- MASTER DATA (Karyawan) ---
let editKarIdx = null;
// Identitas karyawan pada formulir klaim. Satu implementasi untuk kedua
// formulir; sebelumnya ada dua salinan yang isinya hampir sama persis dan
// keduanya tidak pernah mengisi Departemen.
//
// NIK adalah sumber identitas: begitu ditemukan di Master Karyawan, Nama,
// Entitas, dan Departemen terisi sendiri lalu dikunci, sehingga tidak ada nilai
// yang bertentangan dengan NIK-nya.
//
// NIK yang tidak terdaftar TIDAK menghalangi pengisian. Cakupan Admin lebih
// luas daripada Master Karyawan - misalnya driver dengan NIK 0102D - jadi
// ketiga kolom dibuka untuk diisi manual dan penyimpanan tetap diizinkan.
// Master Karyawan tidak pernah dibuat otomatis dari formulir klaim.
function applyKaryawanIdentity(prefix, nikVal) {
    const namaInp = document.getElementById(prefix + '-nama');
    const entSel = document.getElementById(prefix + '-entitas');
    if(!namaInp || !entSel) return;
    // Departemen dan keterangan hanya ada pada formulir pengajuan baru; formulir
    // jurnal lama tetap berjalan tanpa keduanya.
    const deptInp = document.getElementById(prefix + '-dept');
    const noteEl = document.getElementById(prefix + '-nik-note');

    const nik = String(nikVal == null ? '' : nikVal).trim();
    const karyawan = nik ? masterKaryawan.find(x => String(x.nik || '').trim() === nik) : null;

    const setTerkunci = terkunci => {
        namaInp.readOnly = terkunci;
        entSel.disabled = terkunci;
        if(deptInp) deptInp.readOnly = terkunci;
        [namaInp, entSel, deptInp].forEach(el => {
            if(!el) return;
            el.style.backgroundColor = terkunci ? '#e9ecef' : '#fff';
            el.style.color = terkunci ? '#666' : '#333';
        });
    };

    if(karyawan) {
        namaInp.value = karyawan.nama || '';
        entSel.value = karyawan.entitas || 'AIO';
        if(deptInp) deptInp.value = karyawan.departemen || '';
        setTerkunci(true);
        if(noteEl) { noteEl.textContent = ''; noteEl.style.display = 'none'; }
        return;
    }

    // NIK kosong berarti pengguna belum mengetik apa pun - bukan "tidak
    // terdaftar". Kolomnya tetap terkunci seperti sebelumnya supaya NIK tetap
    // menjadi titik masuk identitas, dan hanya terbuka setelah ada NIK yang
    // benar-benar diketik tetapi tidak ditemukan.
    namaInp.value = ''; entSel.value = 'AIO';
    if(deptInp) deptInp.value = '';
    setTerkunci(!nik);
    if(noteEl) {
        noteEl.textContent = nik ? 'NIK belum terdaftar di Master Karyawan. Nama, entitas, dan departemen diisi manual.' : '';
        noteEl.style.display = nik ? 'block' : 'none';
    }
}

// Dua nama lama dipertahankan sebagai pemanggil tipis supaya atribut oninput
// pada markup tidak perlu ikut diubah.
function autoFillKaryawan(nikVal) { applyKaryawanIdentity('hdr', nikVal); }
function autoFillKaryawanQuick(nikVal) { applyKaryawanIdentity('qk', nikVal); }
window.applyKaryawanIdentity = applyKaryawanIdentity;
function searchKaryawan() {
    renderMasterKaryawan();
}

let karCurrentPage = 1; let karRowsPerPage = 20;

function renderMasterKaryawan() {
    let tbody = document.getElementById('tbody-master-karyawan'); 
    if(!tbody) return; tbody.innerHTML = '';
    const totalKarEl = document.getElementById('master-kar-total-count');
    const aioKarEl = document.getElementById('master-kar-aio-count');
    const odiKarEl = document.getElementById('master-kar-odi-count');
    if(totalKarEl) totalKarEl.innerText = String(masterKaryawan.length);
    if(aioKarEl) aioKarEl.innerText = String(masterKaryawan.filter(k => String(k.entitas || '').toUpperCase() === 'AIO').length);
    if(odiKarEl) odiKarEl.innerText = String(masterKaryawan.filter(k => String(k.entitas || '').toUpperCase() === 'ODI').length);
    let isAdmin = sessionRole === 'admin';
    document.querySelectorAll('.admin-col-kar').forEach(el => el.style.display = isAdmin ? '' : 'none');

    let globalKeyword = (document.getElementById('search-kar-input')?.value || "").toLowerCase().trim();
    let baseData = masterKaryawan.filter(k => {
        return (k.nik || "").toLowerCase().includes(globalKeyword) || (k.nama || "").toLowerCase().includes(globalKeyword) || (k.entitas || "").toLowerCase().includes(globalKeyword) || (k.cc || "").toLowerCase().includes(globalKeyword) || (k.lokasi || "").toLowerCase().includes(globalKeyword) || (k.jabatan || "").toLowerCase().includes(globalKeyword) || (k.departemen || "").toLowerCase().includes(globalKeyword);
    });

    let processedData = getFilteredAndSortedData('karyawan', baseData);

    let totalRows = processedData.length;
    let maxPage = Math.ceil(totalRows / karRowsPerPage) || 1;
    if(karCurrentPage > maxPage) karCurrentPage = maxPage;
    if(karCurrentPage < 1) karCurrentPage = 1;

    let pageInfo = document.getElementById('kar-page-info');
    if(pageInfo) pageInfo.innerText = `Halaman ${karCurrentPage} dari ${maxPage} (${totalRows} Karyawan)`;

    let startIdx = (karCurrentPage - 1) * karRowsPerPage;
    let pagedData = processedData.slice(startIdx, startIdx + karRowsPerPage);

    let htmlString = ""; 
    pagedData.forEach((k) => { 
        let originalIdx = masterKaryawan.findIndex(x => x.nik === k.nik);
        let actionCols = isAdmin ? `<td><input type="checkbox" class="kar-checkbox" data-idx="${originalIdx}"></td><td><button class="btn-icon" onclick="editKaryawan(${originalIdx})" title="Edit">✏️</button></td>` : '';
        let deptBadge = k.departemen ? `<span class="badge status-confirm">${k.departemen}</span>` : '-';
        htmlString += `<tr>${actionCols}<td>${k.nik}</td><td><strong>${k.nama}</strong></td><td><span class="badge status-process">${k.entitas || '-'}</span></td><td>${k.cc || '-'}</td><td>${k.lokasi || '-'}</td><td>${k.jabatan || '-'}</td><td>${deptBadge}</td></tr>`; 
    });
    tbody.innerHTML = htmlString;
}

function editKaryawan(idx) {
    let k = masterKaryawan[idx];
    document.getElementById('new-kar-nik').value = k.nik;
    document.getElementById('new-kar-nama').value = k.nama;
    document.getElementById('new-kar-entitas').value = k.entitas || 'AIO';
    document.getElementById('new-kar-cc').value = k.cc || '';
    document.getElementById('new-kar-lokasi').value = k.lokasi || '';
    document.getElementById('new-kar-jabatan').value = k.jabatan || '';
    document.getElementById('new-kar-dept').value = k.departemen || '';
    editKarIdx = idx;
    document.getElementById('btn-save-kar').innerText = '✔️ Update';
    document.getElementById('btn-save-kar').classList.replace('btn-primary', 'btn-success');
}

function saveKaryawan() {
    if(!requireAdmin()) return;
    let nik = document.getElementById('new-kar-nik').value.trim(); 
    let nama = toTitleCase(document.getElementById('new-kar-nama').value.trim()); 
    let entitas = document.getElementById('new-kar-entitas').value;
    let cc = document.getElementById('new-kar-cc').value.trim();
    let lokasi = document.getElementById('new-kar-lokasi').value.trim();
    let jabatan = document.getElementById('new-kar-jabatan').value.trim();
    let departemen = document.getElementById('new-kar-dept').value.trim();
    
    if(!nik || !nama) return showToast('NIK dan nama wajib diisi.', 'error');
    
    let empObject = {nik, nama, entitas, cc, lokasi, jabatan, departemen};

    if(editKarIdx !== null) {
        if(masterKaryawan.find((k, i) => k.nik === nik && i !== editKarIdx)) return showToast('NIK tersebut telah digunakan.', 'error');
        masterKaryawan[editKarIdx] = empObject; 
        editKarIdx = null; 
        document.getElementById('btn-save-kar').innerText = '+ Tambah'; 
        document.getElementById('btn-save-kar').classList.replace('btn-success', 'btn-primary');
    } else {
        if(masterKaryawan.find(k => k.nik === nik)) return showToast('NIK tersebut telah tersedia.', 'error');
        masterKaryawan.push(empObject);
    }
    
    renderMasterKaryawan(); 
    document.getElementById('new-kar-nik').value = ''; 
    document.getElementById('new-kar-nama').value = ''; 
    document.getElementById('new-kar-cc').value = ''; 
    document.getElementById('new-kar-lokasi').value = ''; 
    document.getElementById('new-kar-jabatan').value = ''; 
    document.getElementById('new-kar-dept').value = ''; 
    showToast('Data karyawan berhasil disimpan.', 'success');
    logActivity(sessionUser, `Pembaruan Data Induk Karyawan: NIK ${nik}`);
    saveDataToLocal({ claimIds: [] }); 
}

function bulkDeleteKaryawan() {
    if(!requireAdmin()) return;
    let checked = Array.from(document.querySelectorAll('.kar-checkbox:checked')).map(cb => parseInt(cb.getAttribute('data-idx'))).sort((a,b)=>b-a);
    if(checked.length) { 
        customConfirm('Apakah Anda yakin ingin menghapus data karyawan yang dipilih?', () => {
            checked.forEach(idx => masterKaryawan.splice(idx, 1)); 
            renderMasterKaryawan(); 
            showToast('Data karyawan berhasil dihapus.', 'success'); 
            logActivity(sessionUser, 'Penghapusan Massal Data Induk Karyawan');
            saveDataToLocal({ claimIds: [] });
        });
    }
}

function importKaryawanExcel(e) {
    let file = e.target.files[0]; if(!file) return; let r = new FileReader();
    r.onload = function(evt) {
        let json = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(evt.target.result), {type: 'array'}).Sheets[XLSX.read(new Uint8Array(evt.target.result), {type: 'array'}).SheetNames[0]], {header: 1});
        let karMap = new Map();
        masterKaryawan.forEach(k => karMap.set(k.nik, k));
        let added = 0; let skipped = 0;
        
        json.forEach(row => {
            if(row.length >= 2) {
                let nik = row[0] ? row[0].toString().trim() : ""; 
                let nama = row[1] ? toTitleCase(row[1].toString().trim()) : ""; 
                
                if(nik && nama && nik.toLowerCase() !== "nik") { 
                    if(!karMap.has(nik)) {
                        let ent = (row[2] && row[2].toString().toUpperCase() === "ODI") ? "ODI" : "AIO";
                        let cc = row[3] ? row[3].toString().trim() : "";
                        let lokasi = row[4] ? row[4].toString().trim() : "";
                        let jabatan = row[5] ? row[5].toString().trim() : "";
                        let departemen = row[6] ? row[6].toString().trim() : "";
                        
                        let newK = {nik, nama, entitas: ent, cc, lokasi, jabatan, departemen};
                        karMap.set(nik, newK); masterKaryawan.push(newK); added++;
                    } else { skipped++; }
                }
            }
        });
        
        let nowStr = new Date().toLocaleString('id-ID', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
        localStorage.setItem('lastKarUpdate', nowStr);
        let luEl = document.getElementById('txt-last-kar-upd'); if(luEl) luEl.innerText = nowStr;

        karCurrentPage = 1; renderMasterKaryawan(); saveDataToLocal({ claimIds: [] }); 
        showToast(`Impor selesai. ${added} data baru ditambahkan dan ${skipped} data lama dilewati.`, 'success'); 
        e.target.value = ''; logActivity(sessionUser, `Impor Karyawan: ${added} data baru, ${skipped} data dilewati`);
    }; 
    r.readAsArrayBuffer(file);
}

        // --- Master Data (GL) ---
        let editGLIdx = null;
        
        function searchGL() {
            let filter = document.getElementById('search-gl-input').value.toLowerCase();
            let trs = document.getElementById('tbody-master-gl').getElementsByTagName('tr');
            for(let i=0; i<trs.length; i++) {
                let text = trs[i].innerText.toLowerCase();
                trs[i].style.display = text.includes(filter) ? '' : 'none';
            }
        }

        function renderMasterGL() {
            let tbody = document.getElementById('tbody-master-gl'); tbody.innerHTML = '';

            // Penyeragaman dijalankan di sini supaya layar master selalu
            // memperlihatkan satu baris per tipe, apa pun bentuk data sumbernya.
            masterGL = normalizeMasterTipe(masterGL);
            let tipes = getTipePengajuanList();
            const totalTipeEl = document.getElementById('master-gl-total-count');
            if(totalTipeEl) totalTipeEl.innerText = String(masterGL.length);

            let dl = document.getElementById('dl-tipe-pengajuan');
            if(dl) { dl.innerHTML = ''; tipes.forEach(t => dl.innerHTML += `<option value="${t}">`); }

            let isAdmin = sessionRole === 'admin';
            document.querySelectorAll('.admin-col-gl').forEach(el => el.style.display = isAdmin ? '' : 'none');

            masterGL.forEach((row, idx) => {
                let actionCols = isAdmin ? `<td><input type="checkbox" class="gl-checkbox" data-idx="${idx}"></td><td><button class="btn-icon" onclick="editGL(${idx})" title="Ubah">✏️</button></td>` : '';
                // Nama akun GL lama ditampilkan sebagai keterangan kecil, bukan
                // kolom tersendiri: sudah tidak dipakai alur klaim baru, tetapi
                // masih menjadi rujukan saat membuka klaim jurnal lama.
                const warisan = Array.isArray(row.glLegacy) && row.glLegacy.length
                    ? `<div class="master-legacy-note">Akun GL lama: ${row.glLegacy.join(', ')}</div>` : '';
                tbody.innerHTML += `<tr>${actionCols}<td><span class="badge status-revise">${row.tipe}</span>${warisan}</td></tr>`;
            });
            if(!masterGL.length) tbody.innerHTML = `<tr><td colspan="${isAdmin ? 3 : 1}" style="text-align:center; padding:18px;">Belum ada Tipe Pengajuan.</td></tr>`;
            updateGLDropdownOptions();
        }

        // --- MASTER TIPE PENGAJUAN ---
        // Master ini dulunya menyimpan pasangan {tipe, gl}: satu baris per akun
        // GL, sehingga satu tipe dapat muncul berkali-kali. V3.1 hanya memerlukan
        // daftar Tipe Pengajuan, jadi barisnya disatukan menjadi satu per tipe.
        //
        // Nama GL lamanya TIDAK dibuang, melainkan dikumpulkan ke glLegacy.
        // Dua alasan: brief melarang migrasi destruktif selama dependency GL
        // belum lepas, dan autocomplete pada layar jurnal klaim lama masih
        // membacanya. Dengan begitu penyatuan ini dapat dibatalkan dan tidak ada
        // data yang hilang.
        //
        // Field gl tetap ada dan diisi sama dengan tipe. Itu bukan hiasan:
        // objectStore IndexedDB 'gl' memakai keyPath 'gl', sehingga record tanpa
        // gl ditolak DataError, dan dua record ber-gl sama saling menimpa.
        function normalizeMasterTipe(list) {
            const perTipe = new Map();
            (Array.isArray(list) ? list : []).forEach(row => {
                const tipe = String(row && row.tipe || '').trim();
                if(!tipe) return;
                const kunci = tipe.toLowerCase();
                if(!perTipe.has(kunci)) perTipe.set(kunci, { tipe: toTitleCase(tipe), gl: toTitleCase(tipe), glLegacy: [] });
                const entri = perTipe.get(kunci);
                const warisan = Array.isArray(row.glLegacy) ? row.glLegacy : [];
                const namaGl = String(row && row.gl || '').trim();
                // Nilai gl yang sudah sama dengan tipe berarti baris hasil
                // penyeragaman sebelumnya, bukan nama akun GL sungguhan.
                if(namaGl && namaGl.toLowerCase() !== kunci && namaGl !== 'Auto Imported') warisan.push(namaGl);
                warisan.forEach(nama => {
                    const bersih = String(nama || '').trim();
                    if(bersih && !entri.glLegacy.some(x => x.toLowerCase() === bersih.toLowerCase())) entri.glLegacy.push(bersih);
                });
            });
            return Array.from(perTipe.values()).sort((a, b) => a.tipe.localeCompare(b.tipe, 'id'));
        }
        window.normalizeMasterTipe = normalizeMasterTipe;

        // Daftar tipe yang dipakai seluruh dropdown. Empat tipe bawaan selalu
        // tersedia supaya formulir tidak pernah kosong pada pemasangan baru.
        function getTipePengajuanList() {
            const tipes = normalizeMasterTipe(masterGL).map(g => g.tipe);
            ['Operasional', 'Traveling', 'Entertain', 'Others'].forEach(t => {
                if(!tipes.some(x => x.toLowerCase() === t.toLowerCase())) tipes.push(t);
            });
            return tipes;
        }
        window.getTipePengajuanList = getTipePengajuanList;

        function updateGLDropdownOptions() {
            let tipes = getTipePengajuanList();

            ['hdr-tipe', 'qk-tipe'].forEach(id => {
                let sel = document.getElementById(id);
                if(sel) {
                    let val = sel.value;
                    sel.innerHTML = '';
                    tipes.forEach(t => sel.innerHTML += `<option value="${t}">${t}</option>`);
                    if(tipes.includes(val)) sel.value = val;
                }
            });
        }
        
        function saveGLMaster() {
            if(!requireAdmin()) return;
            const input = document.getElementById('new-gl-tipe');
            const tipe = input ? input.value.trim() : '';
            if(!tipe) return showToast('Nama Tipe Pengajuan belum diisi.', 'error');

            const kunci = tipe.toLowerCase();
            const bentrok = masterGL.some((g, i) => String(g.tipe || '').toLowerCase() === kunci && i !== editGLIdx);
            if(bentrok) return showToast(`Tipe Pengajuan "${toTitleCase(tipe)}" sudah tersedia.`, 'error');

            if(editGLIdx !== null) {
                // Nama akun GL lama ikut terbawa supaya penggantian nama tipe
                // tidak menghapus jejaknya.
                const warisan = masterGL[editGLIdx] && masterGL[editGLIdx].glLegacy;
                masterGL[editGLIdx] = { tipe: toTitleCase(tipe), gl: toTitleCase(tipe), glLegacy: Array.isArray(warisan) ? warisan : [] };
                editGLIdx = null;
                document.getElementById('btn-save-gl').innerText = '+ Tambah';
                document.getElementById('btn-save-gl').classList.replace('btn-success', 'btn-primary');
            } else {
                masterGL.push({ tipe: toTitleCase(tipe), gl: toTitleCase(tipe), glLegacy: [] });
            }
            masterGL = normalizeMasterTipe(masterGL);
            renderMasterGL();
            if(input) input.value = '';
            showToast('Tipe Pengajuan berhasil disimpan.', 'success');
            logActivity(sessionUser, `Pembaruan Master Tipe Pengajuan: ${toTitleCase(tipe)}`);
            saveDataToLocal({ claimIds: [] });
        }
        
        function editGL(idx) {
            const g = masterGL[idx]; if(!g) return;
            document.getElementById('new-gl-tipe').value = g.tipe;
            editGLIdx = idx;
            document.getElementById('btn-save-gl').innerText = '✔️ Perbarui';
            document.getElementById('btn-save-gl').classList.replace('btn-primary', 'btn-success');
        }
        
        function bulkDeleteGL() {
            if(!requireAdmin()) return;
    let checked = Array.from(document.querySelectorAll('.gl-checkbox:checked')).map(cb => parseInt(cb.getAttribute('data-idx'))).sort((a,b)=>b-a);
    if(checked.length) { 
        customConfirm('Apakah Anda yakin ingin menghapus data GL yang dipilih?', () => {
            checked.forEach(idx => masterGL.splice(idx, 1)); 
            renderMasterGL(); 
            showToast('Data GL berhasil dihapus.', 'success');
            logActivity(sessionUser, 'Penghapusan Massal Data Induk GL');
            
            // JALANKAN SINKRONISASI LOKAL:
            saveDataToLocal({ claimIds: [] }); 
        });
    }
}

        function importGLExcel(e) {
            let file = e.target.files[0]; if(!file) return; let r = new FileReader();
            r.onload = function(evt) {
                let json = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(evt.target.result), {type: 'array'}).Sheets[XLSX.read(new Uint8Array(evt.target.result), {type: 'array'}).SheetNames[0]], {header: 1});
                let c = 0;
                // Berkas lama berkolom dua tetap terbaca: kolom pertama diambil
                // sebagai Tipe Pengajuan, kolom kedua diperlakukan sebagai nama
                // akun GL warisan, bukan baris master tersendiri.
                json.forEach(row => {
                    if(!row || !row.length) return;
                    const tRaw = row[0] ? row[0].toString().trim() : '';
                    if(!tRaw || tRaw.toLowerCase() === 'tipe pengajuan' || tRaw.toLowerCase() === 'tipe') return;
                    const tTarg = toTitleCase(tRaw);
                    const glLama = row[1] ? row[1].toString().trim() : '';
                    const ada = masterGL.find(g => String(g.tipe || '').toLowerCase() === tTarg.toLowerCase());
                    if(ada) {
                        if(glLama && glLama.toLowerCase() !== 'gl account') {
                            if(!Array.isArray(ada.glLegacy)) ada.glLegacy = [];
                            if(!ada.glLegacy.some(x => x.toLowerCase() === glLama.toLowerCase())) ada.glLegacy.push(glLama);
                        }
                    } else {
                        const warisan = (glLama && glLama.toLowerCase() !== 'gl account') ? [glLama] : [];
                        masterGL.push({ tipe: tTarg, gl: tTarg, glLegacy: warisan });
                        c++;
                    }
                });
                masterGL = normalizeMasterTipe(masterGL);
                renderMasterGL(); showToast(`${c} Tipe Pengajuan berhasil diimpor.`, 'success'); e.target.value = '';
                logActivity(sessionUser, `Impor ${c} Tipe Pengajuan dari Excel`);
            }; r.readAsArrayBuffer(file);
        }

        // --- EXCEL DATE CONVERTER MAGIC ---
        function convertExcelDate(str) {
            let cleanStr = str.toString().trim();
            
            // Cek jika berbentuk angka serial Excel (misal: 45300)
            if (/^\d{5}$/.test(cleanStr)) {
                let excelEpoch = new Date(1899, 11, 30);
                let parsedDate = new Date(excelEpoch.getTime() + (parseInt(cleanStr) * 86400000));
                let d = String(parsedDate.getDate()).padStart(2, '0');
                let m = String(parsedDate.getMonth() + 1).padStart(2, '0');
                let y = parsedDate.getFullYear();
                return `${d}/${m}/${y}`;
            }

            let months = { 'jan':'01', 'feb':'02', 'mar':'03', 'apr':'04', 'may':'05', 'jun':'06', 'jul':'07', 'aug':'08', 'sep':'09', 'oct':'10', 'nov':'11', 'dec':'12' };
            let match = cleanStr.match(/^(\d{1,2})[-/\s]([a-zA-Z]{3})([-/\s](\d{2,4}))?$/);
            if(match) {
                let d = match[1].padStart(2, '0'); let m = months[match[2].toLowerCase()];
                let y = match[4] ? (match[4].length === 2 ? '20'+match[4] : match[4]) : new Date().getFullYear();
                if(m) return `${d}/${m}/${y}`;
            }
            return cleanStr;
        }

        // --- EXCEL PASTE & BLOCK SELECTION & DRAG DRAG & KEYBOARD NAV HANDLER ---
        let isDragging = false; 
        let isFillDragging = false;
        let startCellInput = null;
        let fillStartInput = null;
        let fillValue = "";
        let selAnchor = null;
        let dragRow = null;

        function updateSelectionSum() {
            let selectedAmounts = document.querySelectorAll('.line-input.cell-selected.line-amount');
            let badge = document.getElementById('selection-sum-badge');
            if (selectedAmounts.length > 1) {
                let currency = normalizeCurrency(document.getElementById('hdr-currency') ? document.getElementById('hdr-currency').value : 'IDR');
                let sum = 0;
                selectedAmounts.forEach(inp => { sum += parseCurrencyAmount(inp.value, currency); });
                badge.innerText = `∑ Terpilih: ${formatMoney(sum, currency)}`;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        function highlightRange(startInp, endInp) {
            let table = document.getElementById('line-items-table');
            let r1 = startInp.closest('tr').rowIndex, r2 = endInp.closest('tr').rowIndex;
            let c1 = startInp.closest('td').cellIndex, c2 = endInp.closest('td').cellIndex;
            let minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
            let minC = Math.min(c1, c2), maxC = Math.max(c1, c2);

            document.querySelectorAll('.line-input').forEach(inp => inp.classList.remove('cell-selected'));
            for(let r = minR; r <= maxR; r++) {
                let row = table.rows[r]; if(!row) continue;
                for(let c = minC; c <= maxC; c++) {
                    let cell = row.cells[c]; if(!cell) continue;
                    let inp = cell.querySelector('.line-input'); if(inp) inp.classList.add('cell-selected');
                }
            }
            updateSelectionSum();
        }

        document.getElementById('tbody-line-items').addEventListener('keydown', function(e) {
            if(viewMode) return;

            // Shortcut Ctrl+D to Copy Above Cell
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                let td = e.target.closest('td');
                let tr = e.target.closest('tr');
                let tbody = tr.parentNode;
                let rIdx = Array.from(tbody.children).indexOf(tr);
                let cIdx = Array.from(tr.children).indexOf(td);

                if (rIdx > 0) {
                    let prevRow = tbody.children[rIdx - 1];
                    let prevTd = prevRow.children[cIdx];
                    let prevInp = prevTd.querySelector('.line-input');
                    
                    if (prevInp) {
                        e.target.value = prevInp.value;
                        if(e.target.classList.contains('line-amount')) { formatRupiahInput(e.target); calculateBalance(); }
                        if(e.target.classList.contains('line-gl')) { e.target.value = toTitleCase(e.target.value); }
                        if(e.target.classList.contains('line-tgl')) { autoFormatDate(e.target, true); }
                        
                        e.target.style.backgroundColor = '#d4edda';
                        setTimeout(() => e.target.style.backgroundColor = '', 300);
                        updateSelectionSum();
                    }
                }
                return;
            }

            // Keyboard Auto-Complete Custom GL handling (TAB / ARROWS)
            if(e.target.classList.contains('line-gl') && document.getElementById('gl-autocomplete-overlay').style.display === 'block') {
                if(e.key === 'Tab') {
                    e.preventDefault();
                    if(glHighlightIndex >= 0 && glHighlightIndex < currentGLOptions.length) {
                        selectGLOption(currentGLOptions[glHighlightIndex]);
                    } else if (currentGLOptions.length > 0) {
                        selectGLOption(currentGLOptions[0]);
                    }
                    return;
                }
                else if(e.key === 'ArrowDown') {
                    e.preventDefault();
                    glHighlightIndex++;
                    if(glHighlightIndex >= currentGLOptions.length) glHighlightIndex = 0;
                    renderGLOverlay(e.target);
                    return;
                }
                else if(e.key === 'ArrowUp') {
                    e.preventDefault();
                    glHighlightIndex--;
                    if(glHighlightIndex < 0) glHighlightIndex = currentGLOptions.length - 1;
                    renderGLOverlay(e.target);
                    return;
                }
                else if(e.key === 'Enter') {
                    e.preventDefault();
                    if(glHighlightIndex >= 0 && glHighlightIndex < currentGLOptions.length) {
                        selectGLOption(currentGLOptions[glHighlightIndex]);
                    }
                    return;
                }
            }

            // Keyboard delete multiple blocked cells
            if(e.key === 'Delete' || e.key === 'Backspace') {
                let selected = document.querySelectorAll('.line-input.cell-selected');
                if(selected.length > 1) {
                    selected.forEach(inp => {
                        inp.value = '';
                        if(inp.classList.contains('line-amount')) formatRupiahInput(inp);
                    });
                    calculateBalance(); updateSelectionSum();
                    e.preventDefault();
                    return;
                }
            }

            // Arrow keys navigation and Shift+Arrow blocking
            if(e.target.classList.contains('line-input')) {
                let tr = e.target.closest('tr');
                let td = e.target.closest('td');
                let tbody = tr.parentElement;
                let c = Array.from(tr.children).indexOf(td);
                let r = Array.from(tbody.children).indexOf(tr);
                
                let nextR = r, nextC = c;
                let move = false;

                if(e.key === 'ArrowUp' && document.getElementById('gl-autocomplete-overlay').style.display !== 'block') { 
                    nextR = Math.max(0, r - 1); move = true; 
                }
                else if(e.key === 'ArrowDown' && document.getElementById('gl-autocomplete-overlay').style.display !== 'block') { 
                    nextR = Math.min(tbody.children.length - 1, r + 1); move = true; 
                }
                else if(e.key === 'ArrowLeft') {
                    if(e.shiftKey || e.target.selectionStart === 0) { 
                        nextC = Math.max(1, c - 1); move = true; 
                    } 
                }
                else if(e.key === 'ArrowRight') {
                    if(e.shiftKey || e.target.selectionEnd === e.target.value.length) { 
                        nextC = Math.min(tr.children.length - 2, c + 1); move = true; 
                    }
                }

                if(move) {
                    let targetTr = tbody.children[nextR];
                    let targetTd = targetTr.children[nextC];
                    let targetInp = targetTd.querySelector('.line-input');
                    
                    if(targetInp && targetInp !== e.target) {
                        e.preventDefault(); 
                        
                        if(e.shiftKey) {
                            if(!selAnchor) selAnchor = e.target;
                            targetInp.focus();
                            highlightRange(selAnchor, targetInp);
                        } else {
                            selAnchor = targetInp;
                            document.querySelectorAll('.line-input').forEach(inp => inp.classList.remove('cell-selected'));
                            targetInp.classList.add('cell-selected');
                            document.getElementById('gl-autocomplete-overlay').style.display = 'none';
                            updateSelectionSum();
                            targetInp.focus(); 
                        }
                    }
                }
            }
        });

        // --- ROW DRAG DROP EVENTS & CTRL+CLICK SELECTION ---
        document.getElementById('tbody-line-items').addEventListener('mousedown', function(e) {
            if(viewMode) return;
            
            if(e.target.classList.contains('drag-handle')) {
                e.target.closest('tr').setAttribute('draggable', 'true');
                return;
            }

            if(e.target.classList.contains('fill-handle')) {
                isFillDragging = true;
                fillStartInput = e.target.previousElementSibling; 
                fillValue = fillStartInput.value;
                e.preventDefault(); 
                return;
            }

            if(e.target.classList.contains('line-input')) {
                if(e.shiftKey) {
                    e.preventDefault();
                    highlightRange(selAnchor || e.target, e.target);
                    e.target.focus();
                } else if (e.ctrlKey || e.metaKey) {
                    // Logic untuk pilih multi-cell acak (Tahan CTRL)
                    isDragging = false;
                    selAnchor = e.target;
                    e.target.classList.toggle('cell-selected');
                    updateSelectionSum();
                } else {
                    // Klik normal 1 cell
                    isDragging = true; 
                    selAnchor = e.target;
                    startCellInput = e.target;
                    document.querySelectorAll('.line-input').forEach(inp => inp.classList.remove('cell-selected'));
                    e.target.classList.add('cell-selected');
                    updateSelectionSum();
                }
            }
        });

        document.getElementById('tbody-line-items').addEventListener('mouseup', function(e) {
            if(e.target.classList.contains('drag-handle') && !viewMode) e.target.closest('tr').removeAttribute('draggable');
            isDragging = false; 
            isFillDragging = false; 
            fillStartInput = null;
            updateSelectionSum();
        });

        document.getElementById('tbody-line-items').addEventListener('dragstart', function(e) {
            if(viewMode) return;
            dragRow = e.target.closest('tr'); setTimeout(() => dragRow.classList.add('dragging'), 0);
        });
        document.getElementById('tbody-line-items').addEventListener('dragover', function(e) {
            e.preventDefault(); if(viewMode) return;
            let afterElement = getDragAfterElement(this, e.clientY);
            if (afterElement == null) this.appendChild(dragRow); else this.insertBefore(dragRow, afterElement);
        });
        document.getElementById('tbody-line-items').addEventListener('dragend', function() {
            if(dragRow) { dragRow.classList.remove('dragging'); dragRow.removeAttribute('draggable'); dragRow = null; }
        });
        function getDragAfterElement(container, y) {
            let els = [...container.querySelectorAll('tr:not(.dragging)')];
            return els.reduce((closest, child) => { let box = child.getBoundingClientRect(); let offset = y - box.top - box.height / 2;
                return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

        document.getElementById('tbody-line-items').addEventListener('mouseover', function(e) {
            if(viewMode) return;

            if(isFillDragging && fillStartInput) {
                let currentInput = null;
                if(e.target.classList.contains('line-input')) currentInput = e.target;
                else if(e.target.classList.contains('fill-handle')) currentInput = e.target.previousElementSibling;
                
                if(currentInput && currentInput !== fillStartInput) {
                    let targetCol = currentInput.closest('td').cellIndex;
                    let startCol = fillStartInput.closest('td').cellIndex;
                    
                    if(targetCol === startCol) {
                        currentInput.value = fillValue;
                        if(currentInput.classList.contains('line-amount')) { formatRupiahInput(currentInput); calculateBalance(); updateSelectionSum(); }
                        if(currentInput.classList.contains('line-gl')) { currentInput.value = toTitleCase(currentInput.value); }
                        if(currentInput.classList.contains('line-tgl')) { autoFormatDate(currentInput, true); }
                        
                        currentInput.style.backgroundColor = '#eef4fc';
                        setTimeout(() => currentInput.style.backgroundColor = '', 300);
                    }
                }
                return;
            }

            if(isDragging && e.target.classList.contains('line-input')) {
                highlightRange(startCellInput, e.target);
            }
        });

        document.addEventListener('copy', function(e) {
            let selectedInputs = document.querySelectorAll('.line-input.cell-selected');
            if(selectedInputs.length > 0 && !viewMode) {
                let rowsMap = new Map();
                selectedInputs.forEach(inp => {
                    let rIdx = inp.closest('tr').rowIndex;
                    if(!rowsMap.has(rIdx)) rowsMap.set(rIdx, []);
                    rowsMap.get(rIdx).push(inp.value);
                });
                let tsv = Array.from(rowsMap.values()).map(row => row.join('\t')).join('\n');
                if(tsv) { e.clipboardData.setData('text/plain', tsv); e.preventDefault(); showToast('Data berhasil disalin ke papan klip.', 'info');}
            }
        });

        document.getElementById('tbody-line-items').addEventListener('paste', function(e) {
            if(!e.target.classList.contains('line-input') || viewMode) return;
            e.preventDefault();
            let clipboard = (e.clipboardData || window.clipboardData).getData('text');
            if(!clipboard) return;
            
            let rows = clipboard.split(/\r\n|\n|\r/).filter(r => r.trim() !== "");
            if(rows.length === 0) return;

            let selectedInputs = document.querySelectorAll('.line-input.cell-selected');
            
            if(selectedInputs.length > 1 && rows.length === 1) {
                let cellsToCopy = rows[0].split('\t');
                let selectedRowIndices = [...new Set(Array.from(selectedInputs).map(inp => inp.closest('tr').rowIndex))];
                let table = document.getElementById('line-items-table');
                let startColIdx = e.target.closest('td').cellIndex;
                
                selectedRowIndices.forEach(rIdx => {
                    let targetRow = table.rows[rIdx];
                    if(!targetRow) return;
                    cellsToCopy.forEach((cellStr, j) => {
                        let targetTd = targetRow.cells[startColIdx + j];
                        if(targetTd) {
                            let inp = targetTd.querySelector('.line-input');
                            if(inp) {
                                let cVal = cellStr.trim();
                                if(inp.classList.contains('line-tgl')) cVal = convertExcelDate(cVal);
                                inp.value = cVal;
                                if(inp.classList.contains('line-amount')) formatRupiahInput(inp);
                                if(inp.classList.contains('line-gl')) inp.value = toTitleCase(inp.value);
                                if(inp.classList.contains('line-tgl')) autoFormatDate(inp, true);
                            }
                        }
                    });
                });
                calculateBalance(); updateSelectionSum(); showToast('Data berhasil ditempel pada area yang dipilih.', 'success');
                return;
            }

            let currentTd = e.target.closest('td'); let tr = currentTd.closest('tr'); let tbody = tr.parentNode;
            let startRowIdx = Array.from(tbody.children).indexOf(tr);
            let startColIdx = Array.from(tr.children).indexOf(currentTd);

            rows.forEach((rowStr, i) => {
                let cells = rowStr.split('\t');
                let targetRow = tbody.children[startRowIdx + i];
                if(!targetRow) { addNewLineRow(); targetRow = tbody.lastElementChild; }

                cells.forEach((cellStr, j) => {
                    let targetTd = targetRow.children[startColIdx + j];
                    if(targetTd) {
                        let inp = targetTd.querySelector('.line-input');
                        if(inp) {
                            let trimmedVal = cellStr.trim();
                            if(inp.classList.contains('line-tgl')) trimmedVal = convertExcelDate(trimmedVal);
                            inp.value = trimmedVal;
                            if(inp.classList.contains('line-amount')) formatRupiahInput(inp);
                            if(inp.classList.contains('line-gl')) inp.value = toTitleCase(inp.value);
                            if(inp.classList.contains('line-tgl')) autoFormatDate(inp, true);
                        }
                    }
                });
            });
            calculateBalance(); updateSelectionSum(); showToast('Data berhasil ditempel.', 'success');
        });

                    // --- Left Action Column Input Line ---
        function toggleAllLineRow(masterCheckbox) {
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = masterCheckbox.checked);
            let btnDel = document.getElementById('btn-del-row');
            btnDel.style.display = masterCheckbox.checked ? 'inline-block' : 'none';
        }
        function toggleLineRowCheck() {
            let anyChecked = document.querySelectorAll('.row-checkbox:checked').length > 0;
            document.getElementById('btn-del-row').style.display = anyChecked ? 'inline-block' : 'none';
        }
        function deleteSelectedRows() {
            document.querySelectorAll('.row-checkbox:checked').forEach(cb => cb.closest('tr').remove());
            document.getElementById('btn-del-row').style.display = 'none';
            calculateBalance(); updateSelectionSum();
        }

// --- ANALITIK & GRAFIK ENGINE ---
window.filterDatesStatistik = [];

function getTrendGroupInfo(dateStr, groupingMode) {
    if(!dateStr || dateStr === '-') return { sortKey: '0000-00-00', display: 'Tanpa Tanggal' };
    let p = dateStr.split('/');
    if(p.length !== 3) return { sortKey: '0000-00-00', display: 'Tanpa Tanggal' };
    let y = parseInt(p[2]), m = parseInt(p[1]), d = parseInt(p[0]);
    let dateObj = new Date(y, m-1, d);
    let months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

    if (groupingMode === 'daily') return { sortKey: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, display: `${String(d).padStart(2,'0')} ${months[m-1]} ${y}` };
    if (groupingMode === 'weekly') {
        let day = dateObj.getDay();
        let diff = dateObj.getDate() - day + (day === 0 ? -6 : 1); 
        let monday = new Date(dateObj.setDate(diff));
        return { sortKey: `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`, display: `Wk: ${String(monday.getDate()).padStart(2,'0')} ${months[monday.getMonth()]} ${monday.getFullYear()}` };
    }
    if (groupingMode === 'monthly') return { sortKey: `${y}-${String(m).padStart(2,'0')}`, display: `${months[m-1]} ${y}` };
    if (groupingMode === 'quarterly') { let q = Math.floor((m + 2) / 3); return { sortKey: `${y}-Q${q}`, display: `Q${q} ${y}` }; }
 if (groupingMode === 'yearly') { return { sortKey: `${y}`, display: `Tahun ${y}` }; }
}

// Semua angka Statistik memakai satu drill-down dan dataset cache yang sama.
window.analyticsBreakdownState = { items:[], currentPage:1, rowsPerPage:25, title:'', type:'', label:'', range:[] };

function getAnalyticsRange(type) {
    if(type === 'employee') return window.filterDatesPengaju;
    if(type === 'employee_revise') return window.filterDatesRevisi;
    return window.filterDatesStatistik;
}

function filterAnalyticsByRange(items, range) {
    const activeItems = (items || []).filter(item => typeof isClaimActiveForAnalytics === 'function' ? isClaimActiveForAnalytics(item) : String(item && item.statusClaim || '') !== 'Canceled');
    if(typeof window !== 'undefined' && typeof window.filterClaimsByReportingRange === 'function') {
        return window.filterClaimsByReportingRange(activeItems, range);
    }
    if(!range || range.length !== 2) return [...activeItems];
    const start = new Date(range[0]); const end = new Date(range[1]);
    if(Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [...activeItems];
    start.setHours(0,0,0,0); end.setHours(23,59,59,999);
    return activeItems.filter(item => {
        const parsed = parseDateString(item.tglSubmit || item.tglProses);
        const timestamp = parsed instanceof Date ? parsed.getTime() : Number(parsed);
        return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
    });
}

function formatAnalyticsRange(range) {
    if(!range || range.length !== 2) return 'Semua Waktu';
    return `${new Date(range[0]).toLocaleDateString('id-ID')} – ${new Date(range[1]).toLocaleDateString('id-ID')}`;
}

function hasClaimRevision(item) {
    return item && (item.statusClaim === 'Revisi' || (item.historyLog || []).some(log => String(log && log.status || '').toLowerCase().includes('revisi')));
}

function getClaimRevisionCount(item) {
    const count = (item && item.historyLog || []).filter(log => String(log && log.status || '').toLowerCase().includes('revisi')).length;
    return count || (item && item.statusClaim === 'Revisi' ? 1 : 0);
}

function renderAnalyticsBreakdownPage() {
    const state = window.analyticsBreakdownState;
    const tbody = document.getElementById('tbody-breakdown');
    if(!tbody) return;
    const totalPages = Math.max(1, Math.ceil(state.items.length / state.rowsPerPage));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    const start = (state.currentPage - 1) * state.rowsPerPage;
    const rows = state.items.slice(start, start + state.rowsPerPage);
    tbody.innerHTML = '';

    if(!rows.length) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#888;">Tidak terdapat data pada rincian ini.</td></tr>';
    rows.forEach(item => {
        const sla = calculateSLADays(item);
        const category = getSlaCategory(sla);
        const revisionHint = state.type === 'employee_revise' ? `<br><small style="color:#856404;">${getClaimRevisionCount(item)}x revisi</small>` : '';
        const detailNotaButton = item.detailNota ? `<button type="button" class="btn btn-secondary" onclick="openAnalyticsClaimNota(${Number(item.id)})" title="Buka rincian nota">🧾</button>` : '';
        tbody.innerHTML += `<tr style="border-bottom:1px solid #f0f0f0;">
            <td><div class="analytics-row-actions">
                <button type="button" class="btn btn-info" onclick="openAnalyticsClaimDetail(${Number(item.id)})" title="Buka pengajuan lengkap">👁️</button>
                <button type="button" class="btn btn-secondary" onclick="openAnalyticsClaimTimeline(${Number(item.id)})" title="Lihat linimasa">🕒</button>${detailNotaButton}
            </div></td>
            <td><strong>${escapeActivityLogText(item.noPR || item.extNo || '-')}</strong></td>
            <td>${escapeActivityLogText(item.nama || '-')}${revisionHint}</td>
            <td><span class="badge status-process">${escapeActivityLogText(item.tipe || '-')}</span></td>
            <td><span class="badge ${getClaimStatusClass(item.statusClaim)}">${escapeActivityLogText(item.statusClaim || '-')}</span></td>
            <td>${escapeActivityLogText(item.tglSubmit || item.tglProses || '-')}</td>
            <td style="text-align:right; font-weight:bold;">${formatClaimMoney(item)}</td>
            <td style="text-align:center; color:${category.color}; font-weight:bold;">${category.icon} ${sla} Hari</td>
        </tr>`;
    });

    const totals = {};
    state.items.forEach(item => addAmountToCurrencyMap(totals, item));
    const footer = document.getElementById('breakdown-footer');
    if(footer) footer.innerHTML = `Total: <strong>${state.items.length} dokumen</strong> · Nilai: <strong>${formatCurrencyTotals(totals, true)}</strong>`;
    const pageInfo = document.getElementById('breakdown-page-info');
    const prev = document.getElementById('breakdown-prev');
    const next = document.getElementById('breakdown-next');
    if(pageInfo) pageInfo.innerText = `Halaman ${state.currentPage}/${totalPages}`;
    if(prev) prev.disabled = state.currentPage <= 1;
    if(next) next.disabled = state.currentPage >= totalPages;
    const breakdownModal = document.getElementById('modal-chart-breakdown');
    if(breakdownModal && typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(breakdownModal);
}

window.changeAnalyticsBreakdownRows = function() {
    const select = document.getElementById('breakdown-rows');
    window.analyticsBreakdownState.rowsPerPage = Math.max(25, Number(select && select.value) || 25);
    window.analyticsBreakdownState.currentPage = 1;
    renderAnalyticsBreakdownPage();
};
window.prevAnalyticsBreakdownPage = function() { if(window.analyticsBreakdownState.currentPage > 1) window.analyticsBreakdownState.currentPage--; renderAnalyticsBreakdownPage(); };
window.nextAnalyticsBreakdownPage = function() { window.analyticsBreakdownState.currentPage++; renderAnalyticsBreakdownPage(); };
window.openAnalyticsClaimDetail = function(id) { closeModal('modal-chart-breakdown'); openEditRoute(Number(id), true); };
window.openAnalyticsClaimTimeline = function(id) {
    openHistoryTimeline(Number(id));
    const modal = document.getElementById('modal-status');
    if(modal) modal.style.zIndex = '1000200';
};
window.openAnalyticsClaimNota = function(id) { closeModal('modal-chart-breakdown'); searchAndLoadDetail(Number(id)); };

window.showChartBreakdown = function(type, label, extraLabel) {
    const range = getAnalyticsRange(type);
    const baseData = filterAnalyticsByRange(dbRekap, range);
    let filtered = [];
    let title = '';

    if(type === 'all' || type === 'amount') {
        filtered = baseData;
        title = type === 'amount' ? '💰 Rincian Data Amount' : '📄 Rincian Total Dokumen';
    } else if(type === 'average_sla') {
        filtered = baseData;
        title = '⏱️ Rincian Penyusun Rata-rata SLA';
    } else if(type === 'currency') {
        filtered = baseData.filter(item => getClaimCurrency(item) === String(label));
        title = `💱 Rincian Klaim dalam ${label}`;
    } else if(type === 'status') {
        filtered = baseData.filter(item => String(item.statusClaim || '') === String(label));
        title = `📌 Rincian Status ${label}`;
    } else if(type === 'employee') {
        filtered = baseData.filter(item => String(item.nik) === String(label));
        title = `👤 Rincian Klaim ${extraLabel} (NIK ${label})`;
    } else if(type === 'employee_revise') {
        filtered = baseData.filter(item => String(item.nik) === String(label) && hasClaimRevision(item));
        title = `⚠️ Rincian Revisi ${extraLabel} (NIK ${label})`;
    } else if(type === 'trend') {
        const grouping = document.getElementById('trend-grouping') ? document.getElementById('trend-grouping').value : 'daily';
        filtered = baseData.filter(item => getTrendGroupInfo(item.tglSubmit || item.tglProses, grouping).display === label);
        title = `📊 Rincian Volume Periode ${label}`;
    } else if(type === 'sla') {
        filtered = baseData.filter(item => {
            const key = getSlaCategory(calculateSLADays(item)).key;
            return (String(label).includes('Sangat Baik') && key === 'green') || (String(label).includes('Perhatian') && key === 'warning') || (String(label).includes('Terlambat') && key === 'late');
        });
        title = `⏱️ Rincian Performa SLA: ${label}`;
    } else if(type === 'sla_achieved') {
        filtered = baseData.filter(item => ['green', 'warning'].includes(getSlaCategory(calculateSLADays(item)).key));
        title = '🏆 Rincian Pendukung Pencapaian SLA';
    }

    filtered.sort((a,b) => {
        if(type === 'average_sla') return calculateSLADays(b) - calculateSLADays(a);
        return parseDateString(b.tglSubmit || b.tglProses) - parseDateString(a.tglSubmit || a.tglProses);
    });
    window.analyticsBreakdownState = { items:filtered, currentPage:1, rowsPerPage:Number(document.getElementById('breakdown-rows') && document.getElementById('breakdown-rows').value) || 25, title, type, label, range };

    const titleElement = document.getElementById('breakdown-title');
    if(titleElement) titleElement.innerText = title;
    const meta = document.getElementById('breakdown-meta');
    if(meta) meta.innerHTML = `<span>Periode: ${escapeActivityLogText(formatAnalyticsRange(range))}</span><span>Dasar tanggal: Tanggal Submit (cadangan: Tgl Proses)</span><span>Filter: ${escapeActivityLogText(label || 'Seluruh Data')}</span><span>${filtered.length} dokumen sumber</span>`;
    renderAnalyticsBreakdownPage();
    document.getElementById('modal-chart-breakdown').style.display = 'flex';
    if(typeof renderSlaDelayInsight === 'function') renderSlaDelayInsight(type, String(label || ''), extraLabel);
};

window.renderRaporIndividu = function() {
    let inputEl = document.getElementById('input-rapor-individu'); let resultContainer = document.getElementById('result-rapor-individu');
    if(!inputEl || !resultContainer) return;
    let kw = inputEl.value.toLowerCase().trim();
    if(kw.length < 2) {
        resultContainer.innerHTML = '<div class="stats-empty-state stats-empty-state-compact"><span aria-hidden="true">⌕</span><strong>Menunggu Pencarian</strong><small>Masukkan minimal dua karakter untuk memulai pencarian.</small></div>';
        if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(resultContainer);
        return;
    }

    let baseData = filterAnalyticsByRange(dbRekap, window.filterDatesStatistik);

    let empMap = {};
    baseData.forEach(d => {
        let n = (d.nama || '').toLowerCase(); let id = (d.nik || '').toLowerCase(); let ref = (d.noPR || d.extNo || '').toLowerCase();
        if(n.includes(kw) || id.includes(kw) || ref.includes(kw)) {
            let key = d.nik + '_' + d.nama;
            if(!empMap[key]) empMap[key] = { nik: d.nik, nama: d.nama, totalSubmisi: 0, totals: {}, dokumenRevisi: 0, totalKejadianRevisi: 0 };
            empMap[key].totalSubmisi++; addAmountToCurrencyMap(empMap[key].totals, d);
            let revCount = 0;
            if(d.historyLog) d.historyLog.forEach(log => { if((log.status || '').toLowerCase().includes('revisi')) revCount++; });
            if(d.statusClaim === 'Revisi' && revCount === 0) revCount = 1;
            if(revCount > 0) { empMap[key].dokumenRevisi++; empMap[key].totalKejadianRevisi += revCount; }
        }
    });

    let results = Object.values(empMap);
    if(results.length === 0) {
        resultContainer.innerHTML = '<div class="stats-empty-state stats-empty-state-error"><span aria-hidden="true">!</span><strong>Tidak Ada Data Ditemukan</strong><small>Data karyawan tidak ditemukan pada periode ini.</small></div>';
        if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(resultContainer);
        return;
    }

    let html = '';
    results.forEach(emp => {
        let percent = emp.totalSubmisi > 0 ? Math.round((emp.dokumenRevisi / emp.totalSubmisi) * 100) : 0;
        let colorPercent = percent > 50 ? '#dc3545' : (percent > 20 ? '#ff9800' : '#28a745'); let statusEmoji = percent > 50 ? '🚩' : (percent > 20 ? '⚠️' : '✅');
        let safeNama = emp.nama.replace(/'/g, "\\'");
        html += `
        <button type="button" class="stats-employee-row" style="--employee-accent:${colorPercent};" onclick="window.openDeepDiveRapor('${emp.nik}', '${safeNama}')" title="Buka rincian riwayat dokumen karyawan">
            <div class="stats-employee-identity">
                <div class="stats-employee-id">NIK ${emp.nik}</div>
                <div class="stats-employee-name">${emp.nama} <span>Buka rincian →</span></div>
                <div class="stats-employee-amount">Total Amount: ${formatCurrencyTotals(emp.totals, true)}</div>
            </div>
            <div class="stats-employee-metrics">
                <div class="stats-employee-metric"><small>Total Pengajuan</small><strong>${emp.totalSubmisi} <span>Dokumen</span></strong></div>
                <div class="stats-employee-metric stats-employee-metric-revision"><small>Revisi</small><strong>${emp.dokumenRevisi} <span>Dokumen</span></strong><em>(${emp.totalKejadianRevisi} kali pengembalian)</em></div>
                <div class="stats-employee-metric stats-employee-metric-ratio"><b aria-hidden="true">${statusEmoji}</b><small>Rasio Revisi</small><strong style="color:${colorPercent};">${percent}%</strong></div>
            </div>
        </button>`;
    });
    resultContainer.innerHTML = html;
    if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(resultContainer);
};

window.openDeepDiveRapor = function(nik, nama) {
    document.getElementById('rapor-deepdive-title').innerText = `🔍 Rincian Rapor: ${nama} (${nik})`;
    let contentContainer = document.getElementById('rapor-deepdive-content'); contentContainer.innerHTML = '';
    let baseData = filterAnalyticsByRange(dbRekap, window.filterDatesStatistik);

    let filtered = baseData.filter(d => d.nik === nik);
    filtered.sort((a,b) => b.id - a.id); 

    if (filtered.length === 0) contentContainer.innerHTML = '<div style="text-align:center; color:#888; padding:40px;">Data tidak ditemukan.</div>';
    else {
        let html = `<div style="font-size:12px; color:#64748b; margin-bottom:10px;">Pilih baris untuk membuka detail dan catatan revisi.</div>`;
        filtered.forEach(d => {
            let revLogs = (d.historyLog || []).filter(l => (l.status||'').toLowerCase().includes('revisi') || (l.status||'').toLowerCase().includes('confirm'));
            let isBermasalah = revLogs.length > 0 || d.statusClaim === 'Revisi' || d.statusClaim === 'Confirm';
            let rowColor = isBermasalah ? '#fef2f2' : '#f0fdf4'; let borderColor = isBermasalah ? '#fecaca' : '#bbf7d0';
            
            html += `
            <div style="background:${rowColor}; border:1px solid ${borderColor}; border-radius:6px; margin-bottom:8px; cursor:pointer; overflow:hidden;">
                <div style="padding:12px; display:flex; justify-content:space-between; align-items:center;" onclick="let d = this.nextElementSibling; d.style.display = d.style.display === 'none' ? 'block' : 'none';">
                    <div style="flex:1;"><span style="font-weight:bold; color:#0f172a;">${d.noPR || d.extNo || '-'}</span> <span style="font-size:11px; color:#64748b; margin-left:10px;">${d.tglSubmit}</span></div>
                    <div style="font-weight:bold; color:#0050A0;">${formatClaimMoney(d)}</div>
                    <div style="width:100px; text-align:right;"><span class="badge" style="background:${isBermasalah?'#dc3545':'#28a745'}; color:white; font-size:10px;">${d.statusClaim}</span></div>
                </div>
                <div style="display:none; padding:15px; background:white; border-top:1px solid ${borderColor};">
                    <div style="font-size:12px; color:#475569; margin-bottom:10px;"><b>Tipe:</b> ${d.tipe} | <b>Diinput oleh:</b> ${getShortUsernameHtml(d.inputBy)}</div>
                    ${revLogs.length > 0 ? `<div style="font-size:11px; font-weight:bold; color:#dc3545; margin-bottom:5px;">📋 Riwayat Revisi:</div><ul style="margin:0; padding-left:18px; font-size:11px; color:#444;">${revLogs.map(l => `<li><b>${l.time}</b> - ${l.status}: <i>"${l.note || '-'}"</i></li>`).join('')}</ul>` : '<div style="font-size:11px; color:#666; font-style:italic;">Tidak ada catatan revisi.</div>'}
                    <div style="margin-top:10px; text-align:right;"><button class="btn btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="document.getElementById('modal-rapor-deepdive').style.display='none'; openEditRoute(${d.id}, true);">🔍 Buka Dokumen</button></div>
                </div>
            </div>`;
        });
        contentContainer.innerHTML = html;
    }
    const reportModal = document.getElementById('modal-rapor-deepdive');
    reportModal.style.display = 'flex';
    if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(reportModal);
};

window.statLeaderboardSort = 'count_desc'; 
window.toggleStatSort = function(type) {
    if (type === 'count') window.statLeaderboardSort = (window.statLeaderboardSort === 'count_desc') ? 'count_asc' : 'count_desc';
    // FIX: Kalau panah tabel di-klik, cukup refresh tabel pengajunya aja
    if (typeof window.renderTopPengaju === 'function') window.renderTopPengaju(); 
};

// 1. FUNGSI UNTUK WIDGET ATAS & GRAFIK (Nurut ke Kalender Global)
window.renderStatistikData = function() {
    let baseData = filterAnalyticsByRange(dbRekap, window.filterDatesStatistik);

    let gMode = document.getElementById('trend-grouping') ? document.getElementById('trend-grouping').value : 'daily';
    let trendMap = {}; let totalDocs = baseData.length; let totalNominal = {}; let totalSLA = 0;
    let slaCount = { h: 0, k: 0, m: 0 };

    baseData.forEach(d => {
        let g = getTrendGroupInfo(d.tglSubmit || d.tglProses, gMode);
        if(!trendMap[g.sortKey]) trendMap[g.sortKey] = { display: g.display, count: 0 };
        trendMap[g.sortKey].count++;
        let sla = calculateSLADays(d); totalSLA += sla; addAmountToCurrencyMap(totalNominal, d);
        const category = getSlaCategory(sla);
        if (category.key === 'green') slaCount.h++; else if (category.key === 'warning') slaCount.k++; else slaCount.m++;
    });

    let avgSLA = totalDocs > 0 ? (totalSLA / totalDocs).toFixed(1) : 0;
    let elVol = document.getElementById('avg-vol'), elNom = document.getElementById('avg-nom'), elSla = document.getElementById('avg-sla');
    if(elVol) elVol.innerText = totalDocs + ' Dokumen';
    if(elNom) elNom.innerHTML = formatCurrencyTotals(totalNominal, true);
    if(elSla) elSla.innerText = avgSLA + ' Hari Kerja';

    let sKeys = Object.keys(trendMap).sort((a, b) => a.localeCompare(b));
    if (sKeys.length > 60) sKeys = sKeys.slice(-60);
    let tLabels = sKeys.map(k => trendMap[k].display);
    const translatedTrendLabels = tLabels.map(label => translateUiText(label));
    let tData = sKeys.map(k => trendMap[k].count);
    const slaSourceLabels = [`Sangat Baik (≤ ${window.slaSettings.greenMaxDays} Hari)`, `Perlu Perhatian (${window.slaSettings.greenMaxDays + 1}-${window.slaSettings.warningMaxDays} Hari)`, `Terlambat (> ${window.slaSettings.warningMaxDays} Hari)`];
    const slaDisplayLabels = slaSourceLabels.map(label => translateUiText(label));

    let totalSLADocs = slaCount.h + slaCount.k + slaCount.m;
    let pctH = totalSLADocs > 0 ? Math.round((slaCount.h / totalSLADocs) * 100) : 0;
    let pctK = totalSLADocs > 0 ? Math.round((slaCount.k / totalSLADocs) * 100) : 0;
    let pctM = totalSLADocs > 0 ? Math.round((slaCount.m / totalSLADocs) * 100) : 0;
    let pctAchieve = totalSLADocs > 0 ? Math.round(((slaCount.h + slaCount.k) / totalSLADocs) * 100) : 0;
    const companyTarget = Number(window.slaSettings.achievementTargetPercent) || 90;
    const nearTargetFloor = Math.max(0, companyTarget - 10);
    let achieveColor = pctAchieve >= companyTarget ? '#15966b' : (pctAchieve >= nearTargetFloor ? '#d88a12' : '#c94f60');
    const achievementStatus = pctAchieve >= companyTarget ? 'Target tercapai' : 'Target belum tercapai';

    try {
        const trendCanvas = document.getElementById('chart-trend');
        if (window.chartTrendInstance) window.chartTrendInstance.destroy();
        if(trendCanvas) {
            const trendCtx = trendCanvas.getContext('2d');
            const trendGradient = trendCtx.createLinearGradient(0, 0, 0, 290);
            trendGradient.addColorStop(0, 'rgba(8,127,189,.30)');
            trendGradient.addColorStop(1, 'rgba(8,127,189,.025)');
            window.chartTrendInstance = new Chart(trendCanvas, {
                type: 'line',
                data: { labels: translatedTrendLabels, datasets: [{
                    label: translateUiText('Volume Pengajuan'), data: tData,
                    borderColor: '#087fbd', backgroundColor: trendGradient, borderWidth: 3,
                    fill: true, tension: .38, pointRadius: tData.length > 24 ? 0 : 3,
                    pointHoverRadius: 6, pointBackgroundColor: '#ffffff', pointBorderColor: '#087fbd', pointBorderWidth: 2
                }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor:'#0f2f46', titleColor:'#fff', bodyColor:'#d9edf7', padding:12, cornerRadius:10, displayColors:false }
                    },
                    scales: {
                        y: { beginAtZero:true, ticks:{ precision:0, color:'#71869a', font:{size:10} }, grid:{ color:'rgba(103,139,162,.12)', drawBorder:false }, border:{display:false} },
                        x: { ticks:{ color:'#71869a', maxRotation:0, autoSkip:true, maxTicksLimit:12, font:{size:10} }, grid:{display:false}, border:{display:false} }
                    },
                    onClick: (e, els) => { if(els.length) window.showChartBreakdown('trend', tLabels[els[0].index]); },
                    onHover: (e, els) => e.native.target.style.cursor = els.length ? 'pointer' : 'default'
                }
            });
        }

        const slaCanvas = document.getElementById('chart-sla');
        if (window.chartSlaInstance) window.chartSlaInstance.destroy();
        if(slaCanvas) {
            const centerLabelPlugin = {
                id: 'slaCenterLabel',
                afterDraw(chart) {
                    const meta = chart.getDatasetMeta(0);
                    if(!meta || !meta.data || !meta.data[0]) return;
                    const {ctx} = chart;
                    const x = meta.data[0].x, y = meta.data[0].y;
                    ctx.save();
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#163c56'; ctx.font = `800 27px ${getComputedStyle(document.documentElement).getPropertyValue('--app-font-family') || 'sans-serif'}`;
                    ctx.fillText(`${pctAchieve}%`, x, y - 5);
                    ctx.fillStyle = '#7890a1'; ctx.font = '700 10px sans-serif';
                    ctx.fillText(translateUiText('Pencapaian SLA'), x, y + 18);
                    ctx.restore();
                }
            };
            window.chartSlaInstance = new Chart(slaCanvas, {
                type: 'doughnut',
                data: { labels: slaDisplayLabels, datasets: [{
                    data: [slaCount.h, slaCount.k, slaCount.m],
                    backgroundColor: ['#1aa776', '#efb548', '#d85a69'],
                    borderColor: ['#ffffff','#ffffff','#ffffff'], borderWidth: 4,
                    borderRadius: 8, spacing: 2, hoverOffset: 7
                }] },
                plugins: [centerLabelPlugin],
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '73%',
                    plugins: {
                        legend: { position:'bottom', labels:{ usePointStyle:true, pointStyle:'circle', boxWidth:8, boxHeight:8, padding:15, color:'#5f788b', font:{size:10, weight:'700'} } },
                        tooltip: { backgroundColor:'#0f2f46', padding:12, cornerRadius:10 }
                    },
                    onClick: (e, els) => { if(els.length) window.showChartBreakdown('sla', slaSourceLabels[els[0].index]); },
                    onHover: (e, els) => e.native.target.style.cursor = els.length ? 'pointer' : 'default'
                }
            });
        }
    } catch(e) { console.warn('[Statistik] Grafik gagal dirender:', e); }

    let slaInfoEl = document.getElementById('sla-info-text');
    if (slaInfoEl) {
        if (totalSLADocs === 0) {
            slaInfoEl.innerHTML = '<div class="stats-empty-inline">Belum ada data pada periode ini.</div>';
        } else {
            slaInfoEl.innerHTML = `
                <button type="button" class="analytics-sla-line" onclick="showChartBreakdown('sla', 'Sangat Baik (≤ ${window.slaSettings.greenMaxDays} Hari)')"><span>🟢 Sangat Baik (≤ ${window.slaSettings.greenMaxDays} Hari):</span> <strong>${pctH}%</strong></button>
                <button type="button" class="analytics-sla-line" onclick="showChartBreakdown('sla', 'Perlu Perhatian (${window.slaSettings.greenMaxDays + 1}-${window.slaSettings.warningMaxDays} Hari)')"><span>🟡 Perlu Perhatian (${window.slaSettings.greenMaxDays + 1}-${window.slaSettings.warningMaxDays} Hari):</span> <strong>${pctK}%</strong></button>
                <button type="button" class="analytics-sla-line" onclick="showChartBreakdown('sla', 'Terlambat (> ${window.slaSettings.warningMaxDays} Hari)')"><span>🔴 Terlambat (> ${window.slaSettings.warningMaxDays} Hari):</span> <strong>${pctM}%</strong></button>
                <button type="button" class="analytics-sla-line analytics-sla-achievement" onclick="showChartBreakdown('sla_achieved', 'Sangat Baik + Perhatian')">
                    <span class="analytics-sla-achievement-main"><strong>🏆 Pencapaian SLA</strong><b style="--sla-achieve-color:${achieveColor};">${pctAchieve}%</b></span>
                    <span class="analytics-sla-target">Target perusahaan ${companyTarget}% · ${achievementStatus}</span>
                </button>
            `;
        }
    }

    if (typeof window.renderTopPengaju === 'function') window.renderTopPengaju();
    if (typeof window.renderTopRevisi === 'function') window.renderTopRevisi();
    if (typeof window.renderRaporIndividu === 'function') window.renderRaporIndividu();
    const statisticsMenu = document.getElementById('menu-statistik');
    if(statisticsMenu && typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(statisticsMenu);
};

// 2. FUNGSI KHUSUS TABEL PENGAJU (Nurut ke Kalender Pengaju)
window.renderTopPengaju = function() {
    let baseData = filterAnalyticsByRange(dbRekap, window.filterDatesPengaju);

    let empMap = {};
    baseData.forEach(d => {
        let empKey = d.nik + '_' + d.nama;
        if(!empMap[empKey]) empMap[empKey] = { nik: d.nik, nama: d.nama, count: 0, totals: {} };
        empMap[empKey].count++;
        addAmountToCurrencyMap(empMap[empKey].totals, d);
    });

    let topEmpArr = Object.values(empMap);
    topEmpArr.sort((a, b) => {
        if (window.statLeaderboardSort === 'count_asc') return a.count - b.count || a.nama.localeCompare(b.nama);
        return b.count - a.count || a.nama.localeCompare(b.nama);
    });
    let topEmp = topEmpArr.slice(0, 15); 
    
    let theadTr = document.querySelector('#tbody-top-karyawan').previousElementSibling.querySelector('tr');
    if (theadTr) {
        let countIcon = window.statLeaderboardSort === 'count_desc' ? ' ↓' : (window.statLeaderboardSort === 'count_asc' ? ' ↑' : ' ⇅');
        theadTr.innerHTML = `<th style="text-align:center; width:60px;">Peringkat</th><th style="width:90px;">NIK</th><th>Nama Karyawan</th><th style="text-align:center; width:140px;" class="th-sortable" onclick="toggleStatSort('count')">Frekuensi Klaim${countIcon}</th><th style="width:180px;" title="Amount ditampilkan sesuai mata uang masing-masing">Amount</th>`;
    }

    let tbEmp = document.getElementById('tbody-top-karyawan');
    if(tbEmp) {
        tbEmp.innerHTML = '';
        if(topEmp.length === 0) tbEmp.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#777;">Tidak ada pengajuan pada periode ini.</td></tr>';
        else topEmp.forEach((emp, i) => {
            let med = i===0 ? '🥇 1' : i===1 ? '🥈 2' : i===2 ? '🥉 3' : (i+1);
            let bg = i<3 ? 'background:#fff9e6;' : ''; 
            tbEmp.innerHTML += `<tr style="${bg} cursor:pointer;" title="Buka rincian klaim ${emp.nama}" onclick="window.showChartBreakdown('employee', '${emp.nik}', '${emp.nama.replace(/'/g, "\\'")}')"><td style="text-align:center; font-weight:bold;">${med}</td><td>${emp.nik}</td><td><strong>${emp.nama}</strong></td><td style="text-align:center;"><span class="badge status-process">${emp.count} Berkas</span></td><td><strong style="color:#dc3545;">${formatCurrencyTotals(emp.totals, true)}</strong></td></tr>`;
        });
        if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(tbEmp.closest('table') || tbEmp);
    }
};

// 3. FUNGSI KHUSUS TABEL REVISI (Nurut ke Kalender Revisi)
window.renderTopRevisi = function() {
    let baseData = filterAnalyticsByRange(dbRekap, window.filterDatesRevisi);

    let reviseMap = {};
    baseData.forEach(d => {
        let empKey = d.nik + '_' + d.nama;
        let sla = typeof calculateSLADays === 'function' ? calculateSLADays(d) : 0;
        let revCount = 0;
        if(d.historyLog) d.historyLog.forEach(log => { if(log.status.toLowerCase().includes('revisi')) revCount++; });
        if(d.statusClaim === 'Revisi' && revCount === 0) revCount = 1;
        if(revCount > 0) {
            if(!reviseMap[empKey]) reviseMap[empKey] = { nik: d.nik, nama: d.nama, count: 0, totalSLA: 0, docCount: 0 };
            reviseMap[empKey].count += revCount; reviseMap[empKey].totalSLA += sla; reviseMap[empKey].docCount++;
        }
    });

    let topRev = Object.values(reviseMap).sort((a, b) => b.count - a.count).slice(0, 15);
    let tbodyRev = document.getElementById('tbody-top-revisi');
    if(tbodyRev) {
        tbodyRev.innerHTML = '';
        if(topRev.length === 0) tbodyRev.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#777; font-style:italic;">Tidak terdapat data revisi pada periode ini.</td></tr>';
        else topRev.forEach((emp, index) => {
            let medal = index === 0 ? '🥇 1' : index === 1 ? '🥈 2' : index === 2 ? '🥉 3' : (index + 1); let highlightStyle = index < 3 ? 'background:#fff3cd;' : ''; 
            let avgSla = emp.docCount > 0 ? (emp.totalSLA / emp.docCount).toFixed(1) : 0;
            tbodyRev.innerHTML += `<tr style="${highlightStyle} cursor:pointer;" title="Buka rincian revisi klaim ${emp.nama}" onclick="window.showChartBreakdown('employee_revise', '${emp.nik}', '${emp.nama.replace(/'/g, "\\'")}')"><td style="text-align:center; font-weight:bold;">${medal}</td><td>${emp.nik}</td><td><strong style="color:#333;">${emp.nama}</strong></td><td style="text-align:center;"><span class="badge status-revise" style="font-size:12px;">${emp.count} Kali Revisi</span></td><td style="text-align:center;"><span class="badge status-process">${avgSla} Hari</span></td></tr>`;
        });
        if(typeof window.applyWorksheetTranslations === 'function') window.applyWorksheetTranslations(tbodyRev.closest('table') || tbodyRev);
    }
};

// Deteksi klik di luar modal filter untuk auto-close
document.addEventListener('click', function(e) {
    const filterModal = document.getElementById('excel-filter-modal');
    const terbuka = filterModal && filterModal.style.display && filterModal.style.display !== 'none';
    if (!terbuka) return;
    if (!filterModal.contains(e.target) && !e.target.classList.contains('th-filter-icon')) closeExcelFilter();
});

function toggleSlaDropdown() {
            let list = document.getElementById('sla-options-list');
            let arrow = document.getElementById('sla-dropdown-arrow');
            if(list.style.display === 'none' || list.style.display === '') {
                list.style.display = 'flex';
                arrow.style.transform = 'rotate(180deg)';
            } else {
                list.style.display = 'none';
                arrow.style.transform = 'rotate(0deg)';
            }
        }

        function selectSlaOption(value, text) {
            document.getElementById('sla-selected-text').innerText = text;
            toggleSlaDropdown(); // Tutup setelah pilih
            
            // Panggil fungsi utama untuk merefresh perhitungan SLA
            if(typeof window.changeSlaMode === 'function') {
                window.changeSlaMode(value);
            }
        }

        // Auto-close kalau klik di luar area Dropdown
        document.addEventListener('click', function(e) {
            let selectBox = document.getElementById('custom-sla-select');
            if (selectBox && !selectBox.contains(e.target)) {
                document.getElementById('sla-options-list').style.display = 'none';
                document.getElementById('sla-dropdown-arrow').style.transform = 'rotate(0deg)';
            }
        });

/* =========================================================
   P12 — LAPISAN BAHASA ANTARMUKA (ID / EN / JA)
   Data klaim dan nilai workflow tidak pernah diterjemahkan atau ditulis ulang.
   ========================================================= */
const WORKSHEET_LANGUAGE_KEY = 'worksheet-interface-language';
const WORKSHEET_SUPPORTED_LANGUAGES = ['id', 'en', 'ja'];
const WORKSHEET_FONT_KEY = 'worksheet-interface-font';
const WORKSHEET_SUPPORTED_FONTS = ['google-sans', 'inter', 'arial', 'segoe-ui'];
const WORKSHEET_FONT_FAMILIES = Object.freeze({
    'google-sans': '"Google Sans", Inter, "Segoe UI", Arial, sans-serif',
    inter: 'Inter, "Segoe UI", Arial, sans-serif',
    arial: 'Arial, Helvetica, sans-serif',
    'segoe-ui': '"Segoe UI", Tahoma, Arial, sans-serif'
});
const WORKSHEET_TRANSLATION_ROWS = [
    ['Worksheet Klaim - Operasional & Pelaporan', 'Claim Worksheet — Operations & Reporting', '申請ワークシート — 業務・レポート'],
    ['CLAIM WORKSHEET', 'CLAIM WORKSHEET', '申請ワークシート'],
    ['Rekapitulasi klaim Accounting dan Finance.', 'Accounting and Finance claim recapitulation.', '経理・財務の申請集計。'],
    ['Pencatatan, pemantauan, dan tindak lanjut klaim dalam satu aplikasi.', 'Claim recording, monitoring, and follow-up in one application.', '申請の記録、監視、フォローアップを一つのアプリで行います。'],
    ['Data Kerja', 'Work Data', '業務データ'],
    ['Tersimpan di perangkat dan tersinkron ke cloud.', 'Stored on the device and synchronized to the cloud.', '端末に保存し、クラウドと同期します。'],
    ['Jejak Aktivitas', 'Activity Trail', '操作履歴'],
    ['Perubahan penting tercatat.', 'Important changes are recorded.', '重要な変更を記録します。'],
    ['Akses Pengguna', 'User Access', 'ユーザーアクセス'],
    ['Menu mengikuti peran pengguna.', 'Menus follow the user role.', 'メニューはユーザー権限に応じて表示されます。'],
    ['LOGIN', 'LOGIN', 'ログイン'],
    ['Gunakan akun yang terdaftar.', 'Use a registered account.', '登録済みのアカウントを使用してください。'],
    ['Firebase Authentication', 'Firebase Authentication', 'Firebase Authentication'],
    ['Informasi sistem', 'System information', 'システム情報'],
    ['RUANG KERJA OPERASIONAL KLAIM', 'CLAIM OPERATIONS WORKSPACE', '申請業務ワークスペース'],
    ['Rekapitulasi klaim yang rapi, cepat, dan dapat ditelusuri.', 'Organized, fast, and traceable claim recapitulation.', '整理され、迅速で追跡可能な申請集計。'],
    ['Kelola worksheet Accounting dan Finance dalam satu ruang kerja dengan penyimpanan lokal utama serta sinkronisasi cloud di latar belakang.', 'Manage Accounting and Finance worksheets in one workspace with local-first storage and background cloud synchronization.', 'ローカル優先保存とバックグラウンドのクラウド同期により、経理・財務ワークシートを一つの画面で管理します。'],
    ['Lokal Utama', 'Local-first', 'ローカル優先'],
    ['Data kerja tampil tanpa menunggu cloud.', 'Work data appears without waiting for the cloud.', 'クラウドを待たずに作業データを表示します。'],
    ['Siap Audit', 'Audit-ready', '監査対応'],
    ['Perubahan penting mempunyai jejak aktivitas.', 'Material changes retain an activity trail.', '重要な変更には操作履歴が残ります。'],
    ['Sesuai Peran', 'Role-based', '権限別アクセス'],
    ['Akses mengikuti kewenangan setiap pengguna.', 'Access follows each user’s authority.', '各ユーザーの権限に応じてアクセスを制御します。'],
    ['Koneksi Aman', 'Secure Connection', '安全な接続'],
    ['AKSES PENGGUNA', 'USER ACCESS', 'ユーザーアクセス'],
    ['Masuk ke Worksheet Klaim', 'Sign in to Claim Worksheet', '申請ワークシートにログイン'],
    ['Gunakan nama pengguna kerja yang telah terdaftar.', 'Use your registered work username.', '登録済みの業務ユーザー名を使用してください。'],
    ['Nama pengguna', 'Username', 'ユーザー名'],
    ['Kata sandi', 'Password', 'パスワード'],
    ['Contoh: accounting01', 'Example: accounting01', '例：accounting01'],
    ['Masukkan kata sandi', 'Enter your password', 'パスワードを入力'],
    ['Tampilkan kata sandi', 'Show password', 'パスワードを表示'],
    ['Sembunyikan kata sandi', 'Hide password', 'パスワードを非表示'],
    ['Masuk', 'Sign In', 'ログイン'],
    ['Memproses...', 'Processing...', '処理中...'],
    ['Autentikasi dilindungi oleh Firebase.', 'Authentication is protected by Firebase.', '認証は Firebase により保護されています。'],
    ['Nama pengguna dan kata sandi wajib diisi.', 'Username and password are required.', 'ユーザー名とパスワードを入力してください。'],
    ['Nama pengguna atau kata sandi tidak sesuai.', 'The username or password is incorrect.', 'ユーザー名またはパスワードが正しくありません。'],

    ['Halaman Utama', 'Home', 'ホーム'],
    ['Lembar Kerja', 'Worksheets', 'ワークシート'],
    ['Masukkan Data', 'Data Entry', 'データ入力'],
    ['Input Cepat', 'Quick Entry', 'クイック入力'],
    ['Revisi', 'Revision', '修正'],
    ['Rekap Harian', 'Daily Recap', '日次集計'],
    ['Detail Pengajuan', 'Claim Details', '申請詳細'],
    ['Catatan Detail', 'Detail Records', '詳細記録'],
    ['Rekapitulasi', 'Recapitulation', '集計'],
    ['Menunggu Persetujuan', 'Pending Approval', '承認待ち'],
    ['Riwayat Klaim', 'Claim History', '申請履歴'],
    ['Statistik & Analitik', 'Statistics & Analytics', '統計・分析'],
    ['Ringkasan Manajemen', 'Management Summary', '管理サマリー'],
    ['Cari Klaim', 'Search Claims', '申請検索'],
    ['Pengaturan', 'Settings', '設定'],
    ['Log Aktivitas', 'Activity Log', '操作ログ'],
    ['Kalender SLA', 'SLA Calendar', 'SLAカレンダー'],
    ['GL Account', 'GL Account', 'GL勘定'],
    ['Data Karyawan', 'Employee Data', '従業員データ'],
    ['Basis Data & Cadangan', 'Database & Backup', 'データベース・バックアップ'],
    ['Pembaruan:', 'Updated:', '更新：'],
    ['Sinkronisasi Cloud:', 'Cloud Sync:', 'クラウド同期：'],
    ['Versi Sistem:', 'System Version:', 'システムバージョン：'],
    ['Belum Tersinkron', 'Not Yet Synchronized', '未同期'],
    ['Penyimpanan Lokal Utama · Sinkronisasi Latar Belakang · Sync Bertahap', 'Local-first Storage · Background Sync · Incremental Sync', 'ローカル優先保存・バックグラウンド同期・増分同期'],
    ['Hari Kerja (Standar)', 'Working Days (Standard)', '営業日（標準）'],
    ['Tanggal Kalender', 'Calendar Days', '暦日'],
    ['Tutup Menu', 'Close Menu', 'メニューを閉じる'],
    ['Buka menu navigasi', 'Open navigation menu', 'ナビゲーションを開く'],
    ['Tutup menu navigasi', 'Close navigation menu', 'ナビゲーションを閉じる'],
    ['Kembali', 'Back', '戻る'],
    ['Tamu', 'Guest', 'ゲスト'],
    ['Peran', 'Role', '権限'],
    ['Mode Gelap', 'Dark Mode', 'ダークモード'],
    ['Mode Terang', 'Light Mode', 'ライトモード'],
    ['Gelap', 'Dark', 'ダーク'],
    ['Terang', 'Light', 'ライト'],
    ['Sync', 'Sync', '同期'],
    ['Selamat Datang', 'Welcome', 'ようこそ'],
    ['Kembalikan periode ke bulan ini', 'Reset the period to this month', '期間を今月に戻す'],
    ['Oleh', 'by', '担当'],
    ['Belum ada riwayat status.', 'No status history yet.', 'ステータス履歴はまだありません。'],
    ['Penyesuaian Nominal', 'Amount Adjustment', '金額調整'],
    ['Approval', 'Approval', '承認'],
    ['Returned', 'Returned', '差戻'],
    ['Canceled', 'Canceled', '取消'],
    ['Pencapaian SLA', 'SLA Achievement', 'SLA達成率'],
    ['Rapor Individu', 'Individual Report', '個人レポート'],
    ['Top Pengaju', 'Top Submitters', '申請件数上位'],
    ['MANAGEMENT INSIGHT', 'MANAGEMENT INSIGHT', 'マネジメントインサイト'],
    ['Target Perusahaan', 'Company Target', '会社目標'],
    ['Gagal', 'Failed', '失敗'],
    ['Sinkronkan', 'Sync', '同期'],
    ['Keluar', 'Sign Out', 'ログアウト'],
    ['Ubah mode warna', 'Change color mode', '表示モードを変更'],
    ['Sinkronkan perubahan data', 'Sync data changes', 'データ変更を同期'],
    ['Keluar dari sistem', 'Sign out of the system', 'システムからログアウト'],
    ['Pilih bahasa', 'Choose language', '言語を選択'],
    ['Pilih font tampilan', 'Choose interface font', '表示フォントを選択'],
    ['Font tampilan', 'Interface font', '表示フォント'],

    ['PEMBERITAHUAN SISTEM', 'SYSTEM NOTICE', 'システム通知'],
    ['KONFIRMASI TINDAKAN', 'ACTION CONFIRMATION', '操作の確認'],
    ['Peringatan', 'Warning', '警告'],
    ['Konfirmasi', 'Confirmation', '確認'],
    ['Mengerti', 'Understood', '確認しました'],
    ['Batal', 'Cancel', 'キャンセル'],
    ['Ya, Lanjutkan', 'Yes, Continue', 'はい、続行'],
    ['Pilih Opsi', 'Select an Option', '項目を選択'],
    ['Cari pilihan...', 'Search options...', '選択肢を検索...'],
    ['Tidak ada pilihan yang sesuai.', 'No matching options.', '一致する選択肢はありません。'],

    ['Simpan', 'Save', '保存'],
    ['Simpan Data', 'Save Data', 'データを保存'],
    ['Simpan Status', 'Save Status', 'ステータスを保存'],
    ['Simpan Peran', 'Save Role', '権限を保存'],
    ['Simpan Mesin SLA', 'Save SLA Engine', 'SLA設定を保存'],
    ['Simpan Kalender', 'Save Calendar', 'カレンダーを保存'],
    ['Tutup', 'Close', '閉じる'],
    ['Ubah', 'Edit', '編集'],
    ['Hapus', 'Delete', '削除'],
    ['Hapus Semua', 'Delete All', 'すべて削除'],
    ['Hapus Pilihan', 'Delete Selected', '選択項目を削除'],
    ['Tambah Baris', 'Add Row', '行を追加'],
    ['Cari Data', 'Search Data', 'データを検索'],
    ['Cari Data...', 'Search Data...', 'データを検索...'],
    ['Bersihkan', 'Clear', 'クリア'],
    ['Terapkan', 'Apply', '適用'],
    ['Atur Ulang', 'Reset', 'リセット'],
    ['Sebelumnya', 'Previous', '前へ'],
    ['Berikutnya', 'Next', '次へ'],
    ['Tampilkan', 'Show', '表示件数'],
    ['Aksi', 'Action', '操作'],
    ['Status', 'Status', 'ステータス'],
    ['Status Terkini', 'Current Status', '現在のステータス'],
    ['Keterangan', 'Description', '説明'],
    ['Catatan', 'Notes', '備考'],
    ['Alasan', 'Reason', '理由'],
    ['Tanggal', 'Date', '日付'],
    ['Waktu', 'Time', '日時'],
    ['Pengguna', 'User', 'ユーザー'],
    ['Kategori', 'Category', 'カテゴリー'],
    ['Sinkronisasi', 'Synchronization', '同期'],
    ['Nama Karyawan', 'Employee Name', '従業員名'],
    ['Tipe Pengajuan', 'Claim Type', '申請種別'],
    ['Entitas', 'Entity', '法人'],
    ['Mata Uang', 'Currency', '通貨'],
    // Label kolom/riwayat untuk field noPR. Istilah lama "Nomor PR" dan
    // "No. Ref" sudah tidak dipakai di layar mana pun; nama field internal
    // tetap noPR agar data lama tidak perlu dimigrasikan.
    ['No.', 'No.', '番号'],
    ['Nomor Referensi', 'Reference Number', '参照番号'],
    ['Tanggal Submit', 'Submission Date', '申請日'],
    ['Tanggal Proses', 'Processing Date', '処理日'],
    ['Tgl Pymnt', 'Payment Date', '支払日'],
    ['PIC Pymnt', 'Payment PIC', '支払担当者'],
    ['Ref Pymnt', 'Payment Reference', '支払参照番号'],
    ['(opsional)', '(optional)', '（任意）'],
    ['Opsional - nomor transfer, batch pembayaran, atau voucher', 'Optional - transfer number, payment batch, or voucher', '任意 - 振込番号、支払バッチ、または伝票'],
    ['Boleh dikosongkan. Hanya referensi pencatatan worksheet; sistem ini tidak mengirim pembayaran ke bank.', 'May be left blank. A worksheet record reference only; this system does not send payments to a bank.', '空欄でも構いません。ワークシート記録用の参照のみで、本システムから銀行へ送金は行いません。'],
    ['Pembatalan pembayaran hanya dapat dilakukan oleh Finance atau Admin.', 'Only Finance or an Admin can cancel a payment.', '支払の取消はFinanceまたは管理者のみ実行できます。'],
    ['Klaim ini sudah dibayar. Pembatalan pembayaran hanya dapat dilakukan Finance atau Admin.', 'This claim has been paid. Only Finance or an Admin can cancel the payment.', 'この申請は支払済みです。支払の取消はFinanceまたは管理者のみ実行できます。'],
    ['Referensi pembayaran maksimal 120 karakter.', 'The payment reference may not exceed 120 characters.', '支払参照番号は120文字以内で入力してください。'],
    ['Tanpa referensi pembayaran', 'No payment reference', '支払参照番号なし'],
    ['Amount', 'Amount', '金額'],
    ['Jumlah', 'Quantity', '件数'],
    ['Peringkat', 'Rank', '順位'],
    ['Frekuensi Klaim', 'Claim Frequency', '申請回数'],
    ['Jumlah Revisi', 'Revision Count', '修正回数'],

    ['Bulan Ini', 'This Month', '今月'],
    ['Bulan Lalu', 'Last Month', '先月'],
    ['3 Bulan Terakhir', 'Last 3 Months', '直近3か月'],
    ['30 Hari Terakhir', 'Last 30 Days', '直近30日'],
    ['Kuartal Ini', 'This Quarter', '今四半期'],
    ['Tahun Ini', 'This Year', '今年'],
    ['Semua Waktu', 'All Time', '全期間'],
    ['Semua Periode', 'All Periods', '全期間'],
    ['Pilih Periode Manual', 'Select Custom Period', '期間を指定'],
    ['Pilih Periode Manual...', 'Select Custom Period...', '期間を指定...'],
    ['Pilih Periode:', 'Select Period:', '期間を選択：'],
    ['Filter Rentang...', 'Date Range...', '期間を指定...'],
    ['Filter Rentang Waktu...', 'Date Range...', '期間を指定...'],
    ['Per Hari', 'Daily', '日別'],
    ['Per Minggu', 'Weekly', '週別'],
    ['Per Bulan', 'Monthly', '月別'],
    ['Per Kuartal', 'Quarterly', '四半期別'],
    ['Per Tahun', 'Yearly', '年別'],

    ['In Process', 'In Process', '処理中'],
    ['Waiting Approval', 'Waiting Approval', '承認待ち'],
    ['Posted', 'Posted', '計上済み'],
    ['Paid', 'Paid', '支払済み'],
    ['Pembayaran Selesai', 'Paid Claims', '支払済み申請'],
    ['Klaim yang sudah dibayar oleh Finance.', 'Claims that have been paid by Finance.', 'Financeによる支払が完了した申請です。'],
    ['Periode Tgl Payment', 'Payment Date Period', '支払日期間'],
    ['Riwayat Pembayaran', 'Payment History', '支払履歴'],
    ['Seluruh klaim berstatus Paid pada periode terpilih', 'All Paid claims in the selected period', '選択期間のPaid申請'],
    ['Hold', 'Hold', '保留'],
    ['Returned by Finance', 'Returned by Finance', '財務部から返却'],
    ['Draft', 'Draft', '下書き'],
    ['Final', 'Final', '確定'],
    ['Selesai', 'Completed', '完了'],
    ['Terlambat', 'Late', '遅延'],
    ['Sangat Baik', 'Excellent', '良好'],
    ['Perlu Perhatian', 'Needs Attention', '要注意'],
    ['Tercapai', 'Achieved', '達成'],
    ['Belum tercapai', 'Not Achieved', '未達成'],

    ['Ringkasan Data Manajemen', 'Management Data Summary', '管理データサマリー'],
    ['Klik pada kartu indikator untuk melihat rincian datanya.', 'Select an indicator card to view its supporting details.', '指標カードを選択すると詳細データを確認できます。'],
    ['Periode Analisis Saat Ini (CP):', 'Current Analysis Period (CP):', '現在の分析期間（CP）：'],
    ['Periode Sebelumnya (PP):', 'Previous Period (PP):', '前期（PP）：'],
    ['s/d', 'to', '～'],
    ['Total Pengajuan', 'Total Claims', '申請合計'],
    ['Klik untuk lihat data', 'Select to view data', 'データを表示'],
    ['dibandingkan periode sebelumnya', 'compared with the previous period', '前期比'],
    ['Sebelumnya:', 'Previous:', '前期：'],
    ['Nilai Pengajuan', 'Claim Amount', '申請金額'],
    ['Total Nilai Pengajuan', 'Total Claim Amount', '申請金額合計'],
    ['Tidak dijumlahkan lintas mata uang.', 'Amounts are not totaled across currencies.', '異なる通貨の金額は合算しません。'],
    ['Buka Detail Analitik', 'Open Analytics Details', '分析詳細を開く'],
    ['Target Perusahaan: ≥', 'Company Target: ≥', '会社目標：≥'],
    ['Total Dokumen Tepat Waktu (CP):', 'On-time Documents (CP):', '期限内書類合計（CP）：'],
    ['Rasio Dokumen Bermasalah (Revisi)', 'Issue Document Ratio (Revision)', '問題書類比率（修正）'],
    ['Semakin kecil nilainya, semakin baik.', 'A lower value indicates better performance.', '値が低いほど良好です。'],
    ['Total Kasus Revisi (CP):', 'Total Revision Cases (CP):', '修正件数合計（CP）：'],
    ['Ringkasan Tabel Perbandingan', 'Comparison Table Summary', '比較表サマリー'],
    ['Unduh Excel', 'Download Excel', 'Excelをダウンロード'],
    ['Komponen Analisis', 'Analysis Component', '分析項目'],
    ['Pertumbuhan vs PP', 'Growth vs PP', 'PP比成長率'],
    ['MTD (Bulan Ini)', 'MTD (This Month)', 'MTD（今月）'],
    ['MTD Sebelumnya (PMTD)', 'Previous MTD (PMTD)', '前月同期（PMTD）'],
    ['Pertumbuhan vs PMTD', 'Growth vs PMTD', 'PMTD比成長率'],
    ['Periode Sama Tahun Lalu', 'Same Period Last Year', '前年同期'],
    ['Pertumbuhan vs SPLY', 'Growth vs SPLY', 'SPLY比成長率'],
    ['Total Volume Pengajuan (Dok)', 'Total Claim Volume (Documents)', '申請数合計（書類）'],
    ['Total Dokumen Posted (Selesai)', 'Total Posted Documents (Completed)', '計上済み書類合計（完了）'],
    ['Total Dokumen Direvisi', 'Total Revised Documents', '修正書類合計'],
    ['Analisis Perbandingan Tren (CP dan PP)', 'Trend Comparison Analysis (CP and PP)', 'トレンド比較分析（CP・PP）'],
    ['Distribusi Pencapaian SLA', 'SLA Achievement Distribution', 'SLA達成分布'],
    ['Berikut adalah rincian kecepatan proses berdasarkan filter periode yang Anda pilih:', 'The following processing-speed details follow your selected period filter:', '選択した期間フィルターに基づく処理速度の詳細です：'],
    ['Rasio Dokumen Revisi', 'Revision Document Ratio', '修正書類比率'],
    ['Perbandingan jumlah dokumen yang bermasalah terhadap total pengajuan di periode ini:', 'Comparison of issue documents against total claims in this period:', 'この期間の申請総数に対する問題書類数の比較：'],
    ['Tingkat Kesalahan Dokumen', 'Document Error Rate', '書類エラー率'],
    ['Total Pengajuan Masuk:', 'Total Claims Received:', '受付申請合計：'],
    ['Total Dokumen Direvisi:', 'Total Revised Documents:', '修正書類合計：'],
    ['Lihat Grafik Analitik Penuh', 'View Full Analytics Chart', '分析グラフ全体を表示'],
    ['Susur Data ke Halaman Revisi', 'Trace Data to the Revision Page', '修正ページでデータを追跡'],
    ['Statistik & Analitik Klaim', 'Claim Statistics & Analytics', '申請統計・分析'],
    ['Pantau tren volume pengajuan, performa SLA, dan rapor peringkat karyawan.', 'Monitor claim volume trends, SLA performance, and employee rankings.', '申請件数の推移、SLA実績、従業員ランキングを確認します。'],
    ['Total Dokumen Masuk', 'Total Documents Received', '受付書類総数'],
    ['Rata-rata SLA', 'Average SLA', '平均SLA'],
    ['ANALITIK OPERASIONAL', 'OPERATIONAL ANALYTICS', '業務分析'],
    ['Pilih Periode', 'Select Period', '期間を選択'],
    ['Sesuaikan data yang ditampilkan', 'Adjust the displayed data', '表示するデータを調整します'],
    ['Perubahan jumlah pengajuan dalam periode aktif', 'Claim volume changes in the active period', '選択期間内の申請件数の変化'],
    ['Distribusi ketepatan waktu proses', 'Process timeliness distribution', '処理時間の分布'],
    ['Filter Statistik dan Analitik', 'Statistics and Analytics filters', '統計・分析フィルター'],
    ['Ringkasan Statistik', 'Statistics summary', '統計サマリー'],
    ['Grafik Statistik', 'Statistics charts', '統計グラフ'],
    ['Preset periode Statistik dan Analitik', 'Statistics and Analytics period preset', '統計・分析の期間プリセット'],
    ['Kelompok waktu tren', 'Trend time grouping', 'トレンドの時間単位'],
    ['Cari rapor individu', 'Search individual report', '個人レポートを検索'],
    ['Atur ulang periode', 'Reset period', '期間をリセット'],
    ['Buka rincian →', 'Open details →', '詳細を開く →'],
    ['Tren Volume Pengajuan', 'Claim Volume Trend', '申請件数の推移'],
    ['Volume Pengajuan', 'Claim Volume', '申請件数'],
    ['Volume Pengajuan (Dok)', 'Claim Volume (Documents)', '申請件数（書類）'],
    ['Dokumen Selesai (Posted)', 'Completed Documents (Posted)', '完了書類（計上済み）'],
    ['Dokumen Direvisi', 'Revised Documents', '修正書類'],
    ['Pencapaian SLA (%)', 'SLA Achievement (%)', 'SLA達成率（%）'],
    ['Periode Aktif (CP)', 'Current Period (CP)', '当期（CP）'],
    ['Periode Sebelumnya (PP)', 'Previous Period (PP)', '前期（PP）'],
    ['Nilai / Volume', 'Value / Volume', '値／件数'],
    ['Performa SLA', 'SLA Performance', 'SLA実績'],
    ['Peringkat Revisi', 'Revision Ranking', '修正ランキング'],
    ['Peringkat Pengaju Klaim', 'Claimant Ranking', '申請者ランキング'],
    ['Klik untuk data pendukung →', 'Open supporting data →', '根拠データを表示 →'],
    ['Unduh Laporan Excel', 'Download Excel Report', 'Excelレポートをダウンロード'],
    ['Ekspor Laporan', 'Export Report', 'レポートを出力'],
    ['Memuat Data...', 'Loading Data...', 'データを読込中...'],
    ['Tidak ada pengajuan pada periode ini.', 'No claims were found for this period.', 'この期間の申請はありません。'],
    ['Tidak terdapat data revisi pada periode ini.', 'No revision data was found for this period.', 'この期間の修正データはありません。'],
    ['Menunggu Pencarian', 'Waiting for Search', '検索条件を待っています'],
    ['Tidak Ada Data Ditemukan', 'No Data Found', 'データが見つかりません'],
    ['Buka Pengajuan', 'Open Claim', '申請を開く'],
    ['Linimasa status', 'Status Timeline', 'ステータス履歴'],
    ['Rincian Nota', 'Receipt Details', '領収書詳細'],
    ['Rincian Data', 'Data Details', 'データ詳細'],
    ['Rincian Rapor Karyawan', 'Employee Report Details', '従業員レポート詳細'],

    ['AGENDA', 'AGENDA', '予定'],
    ['KONTROL ADMIN', 'ADMIN CONTROL', '管理者設定'],
    ['DATA INDUK', 'MASTER DATA', 'マスターデータ'],
    ['Libur Mendatang', 'Upcoming Holidays', '今後の休日'],
    ['Mesin & Simulator SLA', 'SLA Engine & Simulator', 'SLAエンジン・シミュレーター'],
    ['Daftar Hari Libur & Dasar Kebijakan', 'Holiday List & Policy Basis', '休日一覧・ポリシー根拠'],
    ['Hari Kerja', 'Working Days', '営業日'],
    ['Mode Uji', 'Test Mode', 'テストモード'],
    ['Jalankan Uji', 'Run Test', 'テスト実行'],
    ['Belum diuji', 'Not Yet Tested', '未テスト'],
    ['Menggunakan konfigurasi awal sistem.', 'Using the system default configuration.', 'システム初期設定を使用しています。'],
    ['Target SLA Perusahaan (%)', 'Company SLA Target (%)', '会社SLA目標（%）'],
    ['Hari yang dianggap akhir pekan', 'Days Treated as Weekends', '週末として扱う曜日'],
    ['Sabtu', 'Saturday', '土曜日'],
    ['Minggu', 'Sunday', '日曜日'],

    ['Menyiapkan pembaruan data...', 'Preparing data update...', 'データ更新を準備中...'],
    ['Perubahan belum dimulai.', 'The update has not started.', '更新はまだ開始されていません。'],
    ['Tersimpan di perangkat', 'Saved on Device', '端末に保存済み'],
    ['Semua perubahan sudah tersinkron', 'All Changes Synchronized', 'すべての変更を同期しました'],
    ['Data berhasil disimpan', 'Data saved successfully', 'データを保存しました'],
    ['Data tersimpan', 'Data saved', 'データを保存しました'],
    ['File Excel berhasil disiapkan.', 'The Excel file is ready.', 'Excelファイルを作成しました。'],
    ['Rentang tanggal tidak valid.', 'The date range is invalid.', '期間が無効です。'],
    ['Pilih rentang tanggal terlebih dahulu.', 'Select a date range first.', '先に期間を選択してください。'],
    ['Pengajuan tidak ditemukan.', 'Claim not found.', '申請が見つかりません。'],
    ['Tidak terdapat data untuk diekspor.', 'There is no data to export.', '出力するデータがありません。'],
    ['Tidak terdapat data pada periode Statistik yang dipilih.', 'No data was found in the selected Statistics period.', '選択した統計期間にデータがありません。'],
    ['Filter dan pencarian telah diatur ulang.', 'The filters and search have been reset.', 'フィルターと検索をリセットしました。'],
    ['Apakah Anda yakin ingin keluar dari sistem?', 'Are you sure you want to sign out?', 'ログアウトしてもよろしいですか？'],
    ['Perubahan status ini tidak diizinkan untuk peran Anda.', 'Your role is not authorized for this status change.', 'このステータス変更を行う権限がありません。'],
    ['Status sedang disimpan. Mohon tunggu.', 'The status is being saved. Please wait.', 'ステータスを保存しています。お待ちください。'],
    ['Referensi pembayaran wajib diisi sebelum status diubah menjadi Paid.', 'A payment reference is required before changing the status to Paid.', 'ステータスを支払済みに変更する前に、支払参照番号を入力してください。'],
    ['Alasan revisi wajib diisi.', 'A revision reason is required.', '修正理由を入力してください。'],
    ['Alasan atau catatan Finance wajib diisi untuk tindakan ini.', 'A Finance reason or note is required for this action.', 'この操作には財務部の理由または備考が必要です。'],
    ['Tanggal Submit tidak boleh melewati Tanggal Proses.', 'The Submission Date cannot be later than the Processing Date.', '申請日は処理日より後に設定できません。'],
    ['Tanggal tidak valid.', 'The date is invalid.', '日付が無効です。'],
    ['Isi minimal satu baris rincian.', 'Enter at least one detail row.', '明細を1行以上入力してください。'],
    ['Data final hanya dapat dibaca.', 'Final data is read-only.', '確定データは閲覧専用です。'],
    ['Tidak ada data aktif untuk disimpan pada menu ini.', 'There is no active data to save on this page.', 'この画面には保存対象のデータがありません。']
];

const WORKSHEET_ADDITIONAL_TRANSLATION_ROWS = [
    ['Daftar Nomor Referensi Dokumen', 'Document Reference Number List', '書類参照番号一覧'],
    ['Masukkan atau tempel nomor secara berurutan ke bawah. Tekan', 'Enter or paste the numbers sequentially below. Press', '番号を下に順番に入力または貼り付けます。'],
    ['untuk membuat baris baru.', 'to create a new row.', 'を押すと新しい行を作成します。'],
    ['Tutup (Esc)', 'Close (Esc)', '閉じる（Esc）'],
    ['Simpan Daftar (Ctrl+S)', 'Save List (Ctrl+S)', '一覧を保存（Ctrl+S）'],
    ['Penyesuaian Bertahap', 'Incremental Adjustment', '段階的調整'],
    ['Lakukan penambahan atau pengurangan nominal klaim. Sistem akan mengakumulasikan setiap perubahan ke Total Header.', 'Increase or decrease the claim amount. The system will accumulate each change in the Header Total.', '申請金額を加算または減算します。各変更はヘッダー合計に反映されます。'],
    ['Jenis Penyesuaian', 'Adjustment Type', '調整種別'],
    ['Pengurangan Klaim', 'Claim Deduction', '申請額の減額'],
    ['Penambahan Klaim', 'Claim Addition', '申請額の増額'],
    ['Nominal (mengikuti mata uang klaim)', 'Amount (uses the claim currency)', '金額（申請通貨に準拠）'],
    ['Alasan / Keterangan Nota', 'Reason / Receipt Notes', '理由／領収書備考'],
    ['*Tekan Esc untuk tutup', '*Press Esc to close', '※Escで閉じます'],
    ['Terapkan (Ctrl+S)', 'Apply (Ctrl+S)', '適用（Ctrl+S）'],
    ['Simulasi Rekap Jurnal', 'Journal Recap Simulation', '仕訳集計シミュレーション'],
    ['GRAND TOTAL', 'GRAND TOTAL', '総合計'],
    ['Tutup Simulasi', 'Close Simulation', 'シミュレーションを閉じる'],
    ['Riwayat Penyesuaian', 'Adjustment History', '調整履歴'],
    ['Batal Semua', 'Undo All', 'すべて取り消す'],
    ['Batal Terakhir', 'Undo Last', '直前を取り消す'],
    ['Selamat Datang, Otsuka People! ✨', 'Welcome, Otsuka People! ✨', 'ようこそ、Otsuka People! ✨'],
    ['Menyiapkan ruang kerja Anda...', 'Preparing your workspace...', 'ワークスペースを準備しています...'],
    ['Memuat...', 'Loading...', '読み込み中...'],
    ['Data Berhasil Diubah menjadi Posted', 'Data Successfully Changed to Posted', 'データを計上済みに変更しました'],
    ['Silakan cetak voucher dan serahkan dokumen RTP kepada Finance.', 'Print the voucher and submit the RTP documents to Finance.', '伝票を印刷し、RTP書類を財務部へ提出してください。'],
    ['Status & Linimasa Klaim', 'Claim Status & Timeline', '申請ステータス・履歴'],
    ['Status Baru', 'New Status', '新しいステータス'],
    ['Dikembalikan ke Accounting', 'Returned to Accounting', '経理へ返却'],
    ['Waktu Kejadian Historis', 'Historical Event Time', '過去イベント日時'],
    ['Kosongkan kolom ini untuk menggunakan waktu saat ini secara otomatis.', 'Leave this field blank to use the current time automatically.', '空欄の場合は現在時刻を自動的に使用します。'],
    ['Tahap Tindak Lanjut', 'Follow-up Stage', 'フォローアップ段階'],
    ['a. Feedback PIC', 'a. PIC Feedback', 'a. 担当者フィードバック'],
    ['b. Masukan Pengguna', 'b. User Input', 'b. ユーザー回答'],
    ['c. Selesai → Kembali ke In Process', 'c. Completed → Return to In Process', 'c. 完了 → 処理中へ戻す'],
    ['Catatan Proses', 'Process Notes', '処理備考'],
    ['Hanya referensi pencatatan worksheet; sistem ini tidak mengirim pembayaran ke bank.', 'For worksheet recording only; this system does not send payments to a bank.', 'ワークシート記録専用です。このシステムから銀行への支払いは行われません。'],
    ['Alasan atau Catatan Finance', 'Finance Reason or Notes', '財務部の理由または備考'],
    ['Riwayat Perubahan Status', 'Status Change History', 'ステータス変更履歴'],
    ['Batalkan Status Terakhir', 'Undo Last Status', '直前のステータスを取り消す'],
    ['Simpan Status (Ctrl+S)', 'Save Status (Ctrl+S)', 'ステータスを保存（Ctrl+S）'],
    ['Sortir A - Z (Terlama)', 'Sort A - Z (Oldest)', 'A～Z順（古い順）'],
    ['Sortir Z - A (Terbaru)', 'Sort Z - A (Newest)', 'Z～A順（新しい順）'],

    ['Info:', 'Information:', '情報：'],
    ['Selamat Datang di Worksheet Klaim', 'Welcome to the Claim Worksheet', '申請ワークシートへようこそ'],
    ['Pantau dan kelola seluruh pengajuan dokumen operasional pada halaman ini.', 'Monitor and manage all operational document claims on this page.', 'この画面で業務書類の申請を一元管理します。'],
    ['Ringkasan Status Dokumen', 'Document Status Summary', '書類ステータスサマリー'],
    ['Hari Ini', 'Today', '本日'],
    ['Pilih Periode Khusus...', 'Select a Custom Period...', '期間を指定...'],
    ['Buka ➔', 'Open ➔', '開く ➔'],
    ['Selesai (Posted)', 'Completed (Posted)', '完了（計上済み）'],
    ['TINDAK LANJUT PRIORITAS', 'PRIORITY FOLLOW-UP', '優先フォローアップ'],
    ['Lihat Detail ▶', 'View Details ▶', '詳細を見る ▶'],
    ['Tgl Submit', 'Submit Date', '申請日'],
    ['Karyawan / NIK', 'Employee / NIK', '従業員／NIK'],
    ['Status Saat Ini', 'Current Status', '現在のステータス'],
    ['Input Klaim Baru', 'New Claim Entry', '新規申請入力'],
    ['Buat pengajuan jurnal klaim melalui detail baris atau input cepat.', 'Create a claim journal through detailed rows or quick entry.', '明細行またはクイック入力から申請仕訳を作成します。'],
    ['Pantau dan perbarui status klaim yang memerlukan tindak lanjut atau revisi.', 'Monitor and update claims that require follow-up or revision.', 'フォローアップまたは修正が必要な申請を確認・更新します。'],
    ['Rekapitulasi Data', 'Data Recapitulation', 'データ集計'],
    ['Tinjau seluruh klaim berstatus In Process dan lakukan perubahan status secara massal menjadi Posted.', 'Review all In Process claims and change selected statuses to Posted in bulk.', '処理中の申請を確認し、選択した申請を一括で計上済みに変更します。'],
    ['Tinjau klaim yang saat ini telah berstatus Posted, Paid, atau Hold.', 'Review claims currently marked Posted, Paid, or Hold.', '計上済み、支払済み、または保留の申請を確認します。'],
    ['Tinjau analitik manajemen dan ringkasan kinerja.', 'Review management analytics and performance summaries.', '管理分析と実績サマリーを確認します。'],
    ['Kelola data induk GL, data karyawan, dan cadangan sistem.', 'Manage GL master data, employee data, and system backups.', 'GLマスタ、従業員データ、システムバックアップを管理します。'],
    ['Khusus Admin: kelola akun, hak akses, dan log aktivitas.', 'Admin only: manage accounts, access rights, and activity logs.', '管理者専用：アカウント、アクセス権、操作ログを管理します。'],
    ['Pantau tren volume, performa SLA tim, dan peringkat karyawan.', 'Monitor volume trends, team SLA performance, and employee rankings.', '件数推移、チームSLA実績、従業員ランキングを確認します。'],

    ['Form Input Data Jurnal', 'Journal Data Entry Form', '仕訳データ入力フォーム'],
    ['Sembunyikan Header', 'Hide Header', 'ヘッダーを非表示'],
    ['Belum Seimbang', 'Not Balanced', '不一致'],
    ['Tgl Proses', 'Processing Date', '処理日'],
    ['Tgl Submit Pengguna', 'User Submit Date', 'ユーザー申請日'],
    ['No.', 'No.', '番号'],
    ['NIK - Nama Karyawan - Entitas', 'NIK - Employee Name - Entity', 'NIK・従業員名・法人'],
    ['Total Header (', 'Header Total (', 'ヘッダー合計（'],
    ['Penyesuaian', 'Adjustment', '調整'],
    ['HITUNG', 'CALCULATE', '計算'],
    ['Petunjuk: blok sel untuk memilih, tempel data Excel untuk mengisi baris, gunakan ikon', 'Instructions: select cells, paste Excel data to fill rows, use the icon', '操作：セルを選択し、Excelデータを貼り付けて行を入力し、アイコン'],
    ['untuk memindahkan baris, atau tekan', 'to move rows, or press', 'で行を移動するか、'],
    ['untuk menyalin baris di atasnya.', 'to copy the row above.', 'で上の行をコピーします。'],
    ['Tgl Transaksi', 'Transaction Date', '取引日'],
    ['GL Account (Masukkan Huruf Awal)', 'GL Account (Enter Initial Letters)', 'GL勘定（先頭文字を入力）'],
    ['Amount (', 'Amount (', '金額（'],
    ['Hapus Baris Centang', 'Delete Selected Rows', '選択行を削除'],
    ['Total Baris:', 'Row Total:', '行合計：'],
    ['Simulasi Jurnal', 'Journal Simulation', '仕訳シミュレーション'],
    ['Simpan Data (Ctrl+S)', 'Save Data (Ctrl+S)', 'データを保存（Ctrl+S）'],
    ['Form Input Cepat', 'Quick Entry Form', 'クイック入力フォーム'],
    ['ALUR STATUS', 'STATUS WORKFLOW', 'ステータスフロー'],
    ['Belum Tersimpan', 'Not Yet Saved', '未保存'],
    ['Simpan klaim terlebih dahulu sebelum melanjutkan perubahan status.', 'Save the claim before continuing with a status change.', 'ステータスを変更する前に申請を保存してください。'],
    ['Simpan Ubah Status', 'Save and Change Status', '保存してステータス変更'],
    ['Catatan / Keterangan', 'Notes / Description', '備考／説明'],
    ['Salin baris data dari file Excel Admin, kemudian tempel pada area di bawah ini.', 'Copy data rows from the Admin Excel file, then paste them into the area below.', '管理用Excelからデータ行をコピーし、下の領域に貼り付けます。'],
    ['Format kolom otomatis dideteksi:', 'Column format is detected automatically:', '列形式は自動検出されます：'],
    ['Area Tempel Data Excel', 'Excel Data Paste Area', 'Excelデータ貼り付け領域'],
    ['Bersihkan Area', 'Clear Area', '領域をクリア'],
    ['Proses & Tambahkan ke Rekapitulasi', 'Process & Add to Recapitulation', '処理して集計へ追加'],
    ['Form Detail Pengajuan', 'Claim Detail Form', '申請明細フォーム'],
    ['Lengkapi rincian untuk setiap pengajuan.', 'Complete the details for each claim.', '各申請の明細を入力してください。'],
    ['Muat Data', 'Load Data', 'データを読み込む'],
    ['Menunggu Tarikan Data', 'Waiting to Load Data', 'データ読込待ち'],
    ['Silakan masukkan nomor pengajuan pada kolom pencarian di atas untuk memuat dan melengkapi rincian nota pengajuan.', 'Enter the claim number in the search field above to load and complete its receipt details.', '上の検索欄に申請番号を入力し、領収書明細を読み込んで入力してください。'],
    ['Status Pengajuan', 'Claim Status', '申請ステータス'],
    ['Posted / Selesai (baca-saja)', 'Posted / Completed (read-only)', '計上済み／完了（閲覧専用）'],
    ['Paid / Dibayar (baca-saja)', 'Paid (read-only)', '支払済み（閲覧専用）'],
    ['Alasan Revisi (Wajib)', 'Revision Reason (Required)', '修正理由（必須）'],
    ['Total Header Jurnal (Sistem)', 'Journal Header Total (System)', '仕訳ヘッダー合計（システム）'],
    ['*Tips: Tabel di bawah diprogram seperti spreadsheet/excel.', '*Tip: The table below works like a spreadsheet.', '※ヒント：下の表はスプレッドシートのように操作できます。'],
    ['Halaman', 'Page', 'ページ'],
    ['Deskripsi (Bensin, Tol, dll)', 'Description (Fuel, Tolls, etc.)', '内容（燃料、高速料金など）'],
    ['Amount Nota', 'Receipt Amount', '領収書金額'],
    ['Amount Klaim', 'Claim Amount', '申請金額'],
    ['Hapus Baris', 'Delete Row', '行を削除'],
    ['Sesuaikan Selisih Baris', 'Adjust Row Difference', '行差額を調整'],
    ['Total Amount Nota:', 'Total Receipt Amount:', '領収書金額合計：'],
    ['Ekspor Excel', 'Export Excel', 'Excel出力'],
    ['Hapus Detail Pengajuan', 'Delete Claim Details', '申請明細を削除'],
    ['Simpan sebagai Draft', 'Save as Draft', '下書きとして保存'],
    ['Finalisasi', 'Finalize', '確定'],

    ['Catatan Detail (Arsip Nota)', 'Detail Records (Receipt Archive)', '詳細記録（領収書保管）'],
    ['Rekapitulasi pengajuan yang rincian detailnya sudah dibuat (Draft / Final).', 'Claims whose detailed records have been created (Draft / Final).', '明細が作成済みの申請（下書き／確定）を集計します。'],
    ['Atur Ulang Waktu', 'Reset Period', '期間をリセット'],
    ['SLA', 'SLA', 'SLA'],
    ['PIC Penginput', 'Entry PIC', '入力担当者'],
    ['Status Detail', 'Detail Status', '明細ステータス'],
    ['Halaman 1 / 1', 'Page 1 / 1', '1 / 1ページ'],
    ['Halaman 1/1', 'Page 1/1', '1/1ページ'],
    ['Pemantauan Revisi', 'Revision Monitoring', '修正モニタリング'],
    ['Menampilkan seluruh histori revisi lintas periode. Gunakan pagination untuk membuka data lama.', 'Shows the complete revision history across periods. Use pagination to view older data.', '期間をまたぐすべての修正履歴を表示します。古いデータはページ送りで確認できます。'],
    ['Tampilan Daftar', 'List View', '一覧表示'],
    ['Tampilan Folder', 'Folder View', 'フォルダー表示'],
    ['Ubah Pilihan ke Posted', 'Change Selected to Posted', '選択項目を計上済みに変更'],
    ['Hapus Semua Data Aktif', 'Delete All Active Data', '有効データをすべて削除'],
    ['Ekspor Ringkasan', 'Export Summary', 'サマリー出力'],
    ['Ekspor Detail', 'Export Details', '明細出力'],
    ['Pemantauan Aktif', 'Active Monitoring', '有効データ'],
    ['Minimize', 'Minimize', '折りたたむ'],
    ['Karyawan', 'Employee', '従業員'],
    ['Tipe', 'Type', '種別'],
    ['Target Tindak Lanjut', 'Follow-up Target', 'フォローアップ期限'],
    ['Status & Keterangan', 'Status & Description', 'ステータス・説明'],
    ['Arsip Monitoring', 'Monitoring Archive', 'モニタリング保管'],
    ['Hapus Seluruh Tampilan', 'Delete All Displayed Data', '表示データをすべて削除'],
    ['Total Amount', 'Total Amount', '金額合計'],
    ['Tgl Pymnt', 'Payment Date', '支払日'],
    ['PIC Pymnt', 'Payment PIC', '支払担当者'],
    ['Diinput Oleh', 'Entered By', '入力者'],
    ['Status Data', 'Data Status', 'データステータス'],
    ['Klaim yang saat ini telah mencapai RTP: Posted, Paid, atau Hold.', 'Claims that have reached RTP: Posted, Paid, or Hold.', 'RTP到達済みの申請：計上済み、支払済み、または保留。'],
    ['Siap Diproses', 'Ready to Process', '処理準備完了'],
    ['Status Posted', 'Posted Status', '計上済みステータス'],
    ['Dalam Status Hold', 'On Hold', '保留中'],
    ['Memerlukan tindak lanjut', 'Requires follow-up', '要フォローアップ'],
    ['Dibayar Hari Ini (Paid)', 'Paid Today', '本日支払済み'],
    ['Tercatat pada worksheet', 'Recorded in the worksheet', 'ワークシートに記録済み'],
    ['Batalkan Status Posted Pilihan', 'Undo Posted for Selected', '選択項目の計上済みを取り消す'],
    ['Tgl RTP', 'RTP Date', 'RTP日'],
    ['Jam RTP', 'RTP Time', 'RTP時刻'],
    ['PIC Posted', 'Posted PIC', '計上担当者'],
    ['Dokumen siap diproses ke RTP dan menunggu persetujuan atau posting dari atasan.', 'Documents are ready for RTP and awaiting managerial approval or posting.', '書類はRTP処理の準備が完了し、上長の承認または計上待ちです。'],
    ['Masuk Persetujuan', 'Submit for Approval', '承認申請へ'],

    ['Data Induk GL Account', 'GL Account Master Data', 'GL勘定マスタ'],
    ['Tambahkan tipe pengajuan dan nama GL. Tipe pengajuan dapat dimasukkan secara manual apabila belum tersedia dalam daftar.', 'Add claim types and GL names. A claim type can be entered manually if it is not yet listed.', '申請種別とGL名を追加します。一覧にない申請種別は手動入力できます。'],
    ['Pencarian', 'Search', '検索'],
    ['Nama GL Account', 'GL Account Name', 'GL勘定名'],
    ['Tambah', 'Add', '追加'],
    ['Impor Excel', 'Import Excel', 'Excel取込'],
    ['Data Induk Karyawan', 'Employee Master Data', '従業員マスタ'],
    ['Pembaruan Terakhir:', 'Last Updated:', '最終更新：'],
    ['Cost Center', 'Cost Center', 'コストセンター'],
    ['Lokasi Kerja', 'Work Location', '勤務地'],
    ['Jabatan', 'Position', '役職'],
    ['Departemen', 'Department', '部署'],
    ['Basis Data & Cadangan Sistem', 'Database & System Backup', 'データベース・システムバックアップ'],
    ['Buat Cadangan Sekarang', 'Create Backup Now', '今すぐバックアップ'],
    ['Sistem membuat cadangan lokal secara berkala ketika browser tidak aktif dan mempertahankan tujuh tanggal terakhir. Proses pencadangan dan pemulihan hanya tersedia bagi Admin serta tidak mencakup kata sandi atau peran pengguna.', 'The system periodically creates local backups while the browser is idle and retains the latest seven dates. Backup and restore are available only to Admins and exclude passwords and user roles.', 'ブラウザ待機中にローカルバックアップを定期作成し、直近7日分を保持します。バックアップと復元は管理者専用で、パスワードとユーザー権限は含まれません。'],
    ['Sumber Data Aktif', 'Active Data Source', '有効なデータソース'],
    ['Aplikasi final menggunakan satu sumber aktif', 'The final application uses one active source', '最終アプリは一つの有効なデータソースを使用します'],
    ['. Setelah cache awal terbentuk, sinkronisasi hanya mengambil data baru, berubah, atau terhapus.', '. After the initial cache is established, synchronization retrieves only new, changed, or deleted data.', '。初期キャッシュ作成後は、新規・変更・削除されたデータのみを同期します。'],
    ['Cadangan Manual Skema 2 (Ekspor File)', 'Manual Backup Schema 2 (File Export)', '手動バックアップ・スキーマ2（ファイル出力）'],
    ['Berisi klaim aktif, data induk GL/karyawan, manifes jumlah dan total per valas, serta hash integritas. Kata sandi dan peran pengguna tidak disertakan.', 'Contains active claims, GL/employee master data, per-currency count and total manifests, and an integrity hash. Passwords and user roles are excluded.', '有効な申請、GL・従業員マスタ、通貨別件数・合計マニフェスト、整合性ハッシュを含みます。パスワードとユーザー権限は含まれません。'],
    ['Unduh Cadangan (.json)', 'Download Backup (.json)', 'バックアップをダウンロード（.json）'],
    ['Pemulihan Aman (Gabung/Upsert)', 'Safe Restore (Merge/Upsert)', '安全な復元（マージ／Upsert）'],
    ['File akan diperiksa terlebih dahulu. Klaim baru ditambahkan, klaim yang sama dipulihkan, dan transaksi aktif yang tidak terdapat dalam cadangan tetap dipertahankan. Proses pemulihan tidak menghapus data secara otomatis.', 'The file is validated first. New claims are added, matching claims are restored, and active transactions not included in the backup are retained. Restore never deletes data automatically.', '最初にファイルを検証します。新規申請は追加、一致する申請は復元し、バックアップにない有効取引は保持します。復元時にデータを自動削除しません。'],
    ['Pilih File & Tinjau', 'Select File & Review', 'ファイルを選択して確認'],
    ['Auto-Rotation Log (Max 7 Days)', 'Auto-Rotation Log (Max 7 Days)', '自動ローテーションログ（最大7日）'],
    ['Skema', 'Schema', 'スキーマ'],
    ['Jumlah Klaim', 'Claim Count', '申請件数'],
    ['Tindakan Pemulihan Aman', 'Safe Restore Action', '安全な復元操作'],

    ['Pencarian Klaim - Riwayat Komprehensif', 'Claim Search — Comprehensive History', '申請検索・総合履歴'],
    ['Menampilkan seluruh klaim aktif, arsip, dan riwayat berstatus Posted.', 'Shows all active claims, archives, and Posted history.', '有効な申請、保管データ、計上済み履歴をすべて表示します。'],
    ['Mode Viewer: akses terbatas pada pencarian dan peninjauan linimasa klaim.', 'Viewer mode: access is limited to claim search and timeline review.', '閲覧者モード：申請検索と履歴確認のみに制限されます。'],
    ['Pencarian NIK / Nama / No.', 'Search NIK / Name / No.', 'NIK／氏名／番号を検索'],
    ['Hasil pencarian untuk:', 'Search results for:', '検索結果：'],
    ['Silakan pilih periode tanggal submit dan masukkan kata kunci NIK atau nama, kemudian tekan tombol Cari Data.', 'Select a submit-date period and enter an NIK or name keyword, then select Search Data.', '申請日の期間を選び、NIKまたは氏名を入力して「データを検索」を押してください。'],
    ['Memuat persentase SLA...', 'Loading SLA percentage...', 'SLA達成率を読み込み中...'],
    ['Menampilkan pengaju dengan frekuensi revisi tertinggi.', 'Shows claimants with the highest revision frequency.', '修正頻度が高い申請者を表示します。'],
    ['Avg SLA', 'Average SLA', '平均SLA'],
    ['Nominal tidak dicampur antar mata uang; peringkat dibentuk per karyawan dan mata uang.', 'Amounts are not combined across currencies; rankings are calculated by employee and currency.', '異なる通貨の金額は合算せず、従業員・通貨別にランキングします。'],
    ['Frekuensi Klaim ▼', 'Claim Frequency ▼', '申請回数 ▼'],
    ['Rapor Individu Karyawan', 'Individual Employee Report', '従業員個別レポート'],
    ['Masukkan NIK atau nama karyawan. Data mengikuti filter tanggal Statistik & Analitik.', 'Enter an NIK or employee name. Data follows the Statistics & Analytics date filter.', 'NIKまたは従業員名を入力してください。統計・分析の日付フィルターに従います。'],
    ['Silakan masukkan NIK atau nama karyawan pada kolom pencarian di atas.', 'Enter an NIK or employee name in the search field above.', '上の検索欄にNIKまたは従業員名を入力してください。'],

    ['KONTROL HARI KERJA', 'WORKING DAY CONTROL', '営業日管理'],
    ['Kelola hari libur dan parameter perhitungan SLA. Perubahan hanya dapat dilakukan oleh Admin dan dapat diuji sebelum diterapkan.', 'Manage holidays and SLA calculation parameters. Only Admins can make changes, which can be tested before applying.', '休日とSLA計算条件を管理します。変更は管理者のみ可能で、適用前にテストできます。'],
    ['Tambah Tanggal', 'Add Date', '日付を追加'],
    ['Simpan Perubahan', 'Save Changes', '変更を保存'],
    ['Kontrol dampak SLA', 'SLA Impact Control', 'SLA影響管理'],
    ['Perubahan hari libur dapat mengubah angka SLA aktif dan historis. Cantumkan dasar keputusan pada kolom keterangan.', 'Holiday changes may affect current and historical SLA figures. Record the decision basis in the description field.', '休日の変更は現在および過去のSLA値に影響する場合があります。説明欄に判断根拠を記録してください。'],
    ['Total Hari Libur', 'Total Holidays', '休日合計'],
    ['Libur Tahun Ini', 'Holidays This Year', '今年の休日'],
    ['Zona Waktu', 'Time Zone', 'タイムゾーン'],
    ['Kalender kerja', 'Work Calendar', '勤務カレンダー'],
    ['Sen', 'Mon', '月'], ['Sel', 'Tue', '火'], ['Rab', 'Wed', '水'], ['Kam', 'Thu', '木'], ['Jum', 'Fri', '金'], ['Sab', 'Sat', '土'], ['Min', 'Sun', '日'],
    ['Hari ini', 'Today', '本日'],
    ['Hari libur', 'Holiday', '休日'],
    ['Akhir pekan', 'Weekend', '週末'],
    ['Kebijakan aktif', 'Active policy', '有効なポリシー'],
    ['Memuat konfigurasi mesin SLA...', 'Loading SLA engine configuration...', 'SLA設定を読み込み中...'],
    ['Ubah parameter perhitungan, kemudian uji menggunakan contoh tanggal sebelum menyimpannya.', 'Change the calculation parameters, then test them with sample dates before saving.', '計算条件を変更し、保存前にサンプル日付でテストしてください。'],
    ['Mulai menghitung', 'Start counting', '計算開始'],
    ['H+1 (setelah tanggal submit)', 'D+1 (after submit date)', '申請日の翌日から'],
    ['H+0 (tanggal submit ikut dihitung)', 'D+0 (include submit date)', '申請日を含む'],
    ['Mode standar', 'Standard mode', '標準モード'],
    ['Batas Maksimum Hijau (hari)', 'Green Maximum (days)', '緑の上限（日）'],
    ['Batas Maksimum Kuning (hari)', 'Yellow Maximum (days)', '黄の上限（日）'],
    ['Merah Dimulai pada Hari ke-', 'Red Starts on Day', '赤判定の開始日'],
    ['Uji tanpa mengubah klaim', 'Test without changing claims', '申請を変更せずにテスト'],
    ['Tanggal Selesai / Sampai Tanggal', 'Completion / End Date', '完了日／終了日'],
    ['Isi dua tanggal lalu jalankan simulator.', 'Enter two dates, then run the simulator.', '2つの日付を入力してシミュレーターを実行してください。'],
    ['Hanya Admin yang dapat mengubah daftar ini.', 'Only Admins can change this list.', 'この一覧を変更できるのは管理者のみです。'],
    ['Keterangan / Dasar', 'Description / Basis', '説明／根拠'],
    ['Belum tersinkron.', 'Not synchronized yet.', '未同期です。'],

    ['Pengguna & Log Aktivitas', 'Users & Activity Log', 'ユーザー・操作ログ'],
    ['Kelola peran pengguna Firebase. Pembuatan akun dan pengaturan ulang kata sandi tetap dilakukan melalui Firebase Authentication. Menu ini hanya tersedia bagi Admin.', 'Manage Firebase user roles. Account creation and password resets remain in Firebase Authentication. This page is available only to Admins.', 'Firebaseユーザー権限を管理します。アカウント作成とパスワード再設定はFirebase Authenticationで行います。この画面は管理者専用です。'],
    ['Nama Pengguna', 'Username', 'ユーザー名'],
    ['Firebase UID', 'Firebase UID', 'Firebase UID'],
    ['Peran / Akses', 'Role / Access', '権限／アクセス'],
    ['Accounting', 'Accounting', '経理'],
    ['Finance', 'Finance', '財務'],
    ['Finance (Input & Pembayaran)', 'Finance (Input & Payment)', '財務（入力・支払）'],
    ['Viewer', 'Viewer', '閲覧者'],
    ['Viewer (Hanya Baca)', 'Viewer (Read Only)', '閲覧者（閲覧専用）'],
    ['Admin', 'Administrator', '管理者'],
    ['Peran Akses', 'Access Role', 'アクセス権限'],
    ['Log Aktivitas Admin', 'Admin Activity Log', '管理者操作ログ'],
    ['Log Aktivitas', 'Activity Log', '操作ログ'],
    ['AUDIT TRAIL', 'AUDIT TRAIL', '監査証跡'],
    ['Jejak perubahan penting pada klaim, alur kerja, akses pengguna, dan aktivitas sistem.', 'Trace important changes across claims, workflow, user access, and system activity.', '申請、ワークフロー、ユーザーアクセス、システム操作の重要な変更履歴です。'],
    ['Retensi Log', 'Log Retention', 'ログ保持'],
    ['Total Audit', 'Total Audit', '監査ログ合計'],
    ['Log dalam cache', 'Logs in cache', 'キャッシュ内ログ'],
    ['Aktivitas tercatat', 'Recorded activity', '記録された操作'],
    ['Tersimpan di cloud', 'Stored in cloud', 'クラウド保存済み'],
    ['Perlu Sinkron', 'Needs Sync', '同期が必要'],
    ['Pending / hanya lokal', 'Pending / local only', '保留／ローカルのみ'],
    ['Telusuri Audit', 'Explore Audit', '監査ログを検索'],
    ['Semua log ditampilkan', 'Showing all logs', 'すべてのログを表示'],
    ['Pencarian', 'Search', '検索'],
    ['Peran', 'Role', '権限'],
    ['Kategori', 'Category', 'カテゴリー'],
    ['Sinkronisasi', 'Synchronization', '同期'],
    ['Buka detail untuk melihat pelaku, peran, kategori, status sinkronisasi, dan klaim terkait.', 'Open details to view the actor, role, category, sync status, and related claim.', '詳細を開くと、実行者、権限、カテゴリー、同期状態、関連申請を確認できます。'],
    ['Semua Peran', 'All Roles', 'すべての権限'],
    ['Semua Kategori', 'All Categories', 'すべてのカテゴリー'],
    ['Klaim', 'Claims', '申請'],
    ['Alur Kerja', 'Workflow', 'ワークフロー'],
    ['Impor', 'Import', '取込'],
    ['Ekspor', 'Export', '出力'],
    ['Data Induk', 'Master Data', 'マスターデータ'],
    ['Akses Peran', 'Role Access', '権限アクセス'],
    ['Cadangan', 'Backup', 'バックアップ'],
    ['Sistem', 'System', 'システム'],
    ['Semua Sinkronisasi', 'All Synchronization States', 'すべての同期状態'],
    ['Tersinkron', 'Synchronized', '同期済み'],
    ['Menunggu Sinkronisasi Cloud', 'Waiting for Cloud Sync', 'クラウド同期待ち'],
    ['Hanya Lokal', 'Local Only', 'ローカルのみ'],
    ['Aktivitas', 'Activity', '操作'],
    ['baris', 'rows', '行'],
    ['AUDIT ADMIN', 'ADMIN AUDIT', '管理者監査'],
    ['Detail Log Aktivitas', 'Activity Log Details', '操作ログ詳細'],
    ['Status Sinkronisasi', 'Synchronization Status', '同期状態'],
    ['Hasil Aksi', 'Action Result', '操作結果'],
    ['Sumber', 'Source', 'ソース'],
    ['Klaim Terkait', 'Related Claim', '関連申請'],
    ['Rincian', 'Details', '詳細'],
    ['Berikutnya ▶', 'Next ▶', '次へ ▶'],
    ['Informasi aplikasi', 'Application information', 'アプリケーション情報'],
    ['Keunggulan sistem', 'System advantages', 'システムの特長'],
    ['Contoh:', 'Example:', '例：'],
    ['Contoh: Nota kurang jelas sehingga nominal klaim dikurangi.', 'Example: The receipt is unclear, so the claim amount is reduced.', '例：領収書が不明瞭なため、申請金額を減額。'],
    ['Pilih tanggal dan waktu kejadian...', 'Select the event date and time...', 'イベントの日時を選択...'],
    ['Hapus waktu', 'Clear time', '時刻をクリア'],
    ['Tuliskan keterangan untuk PIC.', 'Enter instructions for the PIC.', '担当者への説明を入力してください。'],
    ['Contoh: nomor transfer, batch pembayaran, atau voucher', 'Example: transfer number, payment batch, or voucher', '例：振込番号、支払バッチ、伝票番号'],
    ['Tuliskan alasan yang jelas untuk keperluan audit dan tindak lanjut Accounting.', 'Enter a clear reason for audit purposes and Accounting follow-up.', '監査および経理のフォローアップ用に明確な理由を入力してください。'],
    ['Progres pembaruan data', 'Data update progress', 'データ更新の進捗'],
    ['Pilih rentang tanggal...', 'Select a date range...', '期間を選択...'],
    ['Referensi Dokumen', 'Document References', '書類参照番号'],
    ['Buka daftar referensi dokumen', 'Open the document reference list', '書類参照番号一覧を開く'],
    ['Masukkan nomor referensi', 'Enter a reference number', '参照番号を入力'],
    ['Masukkan NIK', 'Enter NIK', 'NIKを入力'],
    ['Otomatis', 'Automatic', '自動'],
    ['Mata uang klaim', 'Claim currency', '申請通貨'],
    ['Samakan Total Header dengan Total Baris', 'Match the Header Total to the Row Total', 'ヘッダー合計を行合計に合わせる'],
    ['Tahan & Geser', 'Hold & Drag', '長押しして移動'],
    ['Pilih Semua', 'Select All', 'すべて選択'],
    ['Komentar', 'Comments', 'コメント'],
    ['Alasan perubahan nominal (wajib diisi jika nilai berubah)', 'Reason for amount change (required when the value changes)', '金額変更理由（変更時は必須）'],
    ['Catatan opsional', 'Optional notes', '任意の備考'],
    ['Tempel baris data Excel di sini.', 'Paste Excel data rows here.', 'Excelデータ行をここに貼り付けます。'],
    ['Contoh format:', 'Format example:', '形式例：'],
    ['Masukkan nomor pengajuan', 'Enter a claim number', '申請番号を入力'],
    ['Tulis alasan dikembalikan...', 'Enter the return reason...', '返却理由を入力...'],
    ['Pencarian cepat', 'Quick search', 'クイック検索'],
    ['Preset periode Catatan Detail', 'Detail Records period preset', '詳細記録の期間プリセット'],
    ['Filter Tgl Proses...', 'Filter Processing Date...', '処理日を絞り込み...'],
    ['Atur ulang filter', 'Reset filters', 'フィルターをリセット'],
    ['Preset periode Rekapitulasi', 'Recapitulation period preset', '集計期間プリセット'],
    ['Pilihan periode Riwayat Klaim', 'Claim History period selection', '申請履歴の期間選択'],
    ['Filter Tgl RTP...', 'Filter RTP Date...', 'RTP日を絞り込み...'],
    ['Ringkasan antrean Finance sesuai periode Riwayat Klaim', 'Finance queue summary for the selected Claim History period', '申請履歴の選択期間に対応する財務キューサマリー'],
    ['Preset periode Waiting Approval', 'Pending Approval period preset', '承認待ちの期間プリセット'],
    ['Cari Tipe / Nama GL...', 'Search Type / GL Name...', '種別／GL名を検索...'],
    ['Masukkan atau pilih tipe', 'Enter or select a type', '種別を入力または選択'],
    ['Contoh: Bensin', 'Example: Fuel', '例：燃料'],
    ['Cari NIK / Nama...', 'Search NIK / Name...', 'NIK／氏名を検索...'],
    ['Masukkan nama', 'Enter a name', '氏名を入力'],
    ['Masukkan Cost Center', 'Enter a Cost Center', 'コストセンターを入力'],
    ['Masukkan lokasi', 'Enter a location', '勤務地を入力'],
    ['Masukkan jabatan', 'Enter a position', '役職を入力'],
    ['Masukkan departemen', 'Enter a department', '部署を入力'],
    ['Filter Tgl Submit...', 'Filter Submit Date...', '申請日を絞り込み...'],
    ['Masukkan NIK, Nama, atau No Excel lalu Enter...', 'Enter NIK, Name, or Excel No., then press Enter...', 'NIK、氏名、またはExcel番号を入力してEnter...'],
    ['Klik untuk melihat seluruh pengajuan penyusun angka ini', 'Select to view all claims supporting this figure', 'この数値の根拠となるすべての申請を表示'],
    ['Klik untuk melihat seluruh pengajuan penyusun amount', 'Select to view all claims supporting this amount', 'この金額の根拠となるすべての申請を表示'],
    ['Buka rincian klaim penyusun rata-rata SLA', 'Open the claims supporting the average SLA', '平均SLAの根拠となる申請を表示'],
    ['Preset periode Top Revisi', 'Top Revision period preset', '修正ランキングの期間プリセット'],
    ['Filter Waktu Revisi...', 'Filter Revision Period...', '修正期間を絞り込み...'],
    ['Preset periode Top Pengaju', 'Top Claimant period preset', '申請者ランキングの期間プリセット'],
    ['Filter Waktu Pengaju...', 'Filter Claimant Period...', '申請者期間を絞り込み...'],
    ['Amount ditampilkan sesuai mata uang masing-masing', 'Amounts are displayed in their respective currencies', '金額は各通貨で表示されます'],
    ['Masukkan NIK atau nama', 'Enter NIK or name', 'NIKまたは氏名を入力'],
    ['Bulan sebelumnya', 'Previous month', '前月'],
    ['Bulan berikutnya', 'Next month', '翌月'],
    ['Nilai ini otomatis satu hari setelah batas maksimum kuning.', 'This value is automatically one day after the yellow maximum.', 'この値は黄の上限の翌日に自動設定されます。'],
    ['contoh: finance01', 'example: finance01', '例：finance01'],
    ['Salin UID dari Firebase Authentication', 'Copy the UID from Firebase Authentication', 'Firebase AuthenticationからUIDをコピー'],
    ['Cari user, aktivitas, nomor pengajuan, atau ID claim...', 'Search user, activity, submission number, or claim ID...', 'ユーザー、操作、申請番号、申請IDを検索...'],
    ['Filter peran Log Aktivitas', 'Filter Activity Log roles', '操作ログの権限フィルター'],
    ['Filter kategori Log Aktivitas', 'Filter Activity Log categories', '操作ログのカテゴリーフィルター'],
    ['Filter sinkronisasi Log Aktivitas', 'Filter Activity Log synchronization', '操作ログの同期フィルター'],
    ['7 Hari Terakhir', 'Last 7 Days', '直近7日間'],
    ['Dokumen', 'Documents', '書類'],
    ['Target tercapai', 'Target achieved', '目標達成'],
    ['Target belum tercapai', 'Target not yet achieved', '目標未達成'],
    ['Kalender SLA berhasil disimpan.', 'The SLA calendar was saved successfully.', 'SLAカレンダーを保存しました。'],
    ['Kalender SLA gagal disimpan. Pastikan akun memiliki peran Admin dan izin Firebase telah diterapkan.', 'The SLA calendar could not be saved. Confirm that the account has the Admin role and the Firebase permissions are applied.', 'SLAカレンダーを保存できません。管理者権限とFirebaseの許可を確認してください。'],
    ['Batas kuning harus bilangan bulat, lebih besar dari hijau, dan maksimal 365.', 'The yellow limit must be an integer greater than the green limit and no more than 365.', '黄の上限は緑の上限より大きい365以下の整数にしてください。'],
    ['Target perusahaan harus berupa bilangan bulat 1–100 persen.', 'The company target must be an integer from 1 to 100 percent.', '会社目標は1～100の整数で指定してください。'],
    ['Konfigurasi mesin SLA berhasil disimpan.', 'The SLA engine configuration was saved successfully.', 'SLAエンジン設定を保存しました。'],
    ['Konfigurasi SLA gagal disimpan. Pastikan akun memiliki peran Admin dan izin Firebase telah diterapkan.', 'The SLA configuration could not be saved. Confirm that the account has the Admin role and the Firebase permissions are applied.', 'SLA設定を保存できません。管理者権限とFirebaseの許可を確認してください。'],
    ['Total baris telah disamakan secara otomatis.', 'The row total was matched automatically.', '行合計を自動で一致させました。'],
    ['Data terkunci (Posted/Paid/Hold) dan bersifat baca-saja. Gunakan alur koreksi yang sesuai.', 'Locked data (Posted/Paid/Hold) is read-only. Use the appropriate correction workflow.', 'ロック中のデータ（Posted/Paid/Hold）は閲覧専用です。適切な修正フローを使用してください。'],
    ['Tanggal tidak valid. Pastikan format DD/MM/YYYY telah sesuai.', 'The date is invalid. Confirm that it uses the DD/MM/YYYY format.', '日付が無効です。DD/MM/YYYY形式を確認してください。'],
    ['Data gagal disimpan ke perangkat. Form tetap dibuka.', 'The data could not be saved on the device. The form remains open.', 'デバイスにデータを保存できません。フォームは開いたままです。'],
    ['Klaim baru akan disimpan terlebih dahulu, kemudian panel alur status akan dibuka.', 'The new claim will be saved first, and then the status workflow panel will open.', '新規申請を先に保存し、その後ステータスフローパネルを開きます。'],
    ['Simpan & Ubah Status', 'Save & Change Status', '保存してステータス変更'],
    ['Perubahan status menggunakan validasi, peran, audit, dan progres yang sama dengan modul lainnya.', 'Status changes use the same validation, roles, audit trail, and progress tracking as other modules.', 'ステータス変更は他のモジュールと同じ検証、権限、監査、進捗管理を使用します。'],
    ['Status ini bersifat baca-saja untuk peran Anda. Linimasa tetap dapat ditinjau.', 'This status is read-only for your role. The timeline can still be reviewed.', 'このステータスは現在の権限では閲覧専用です。履歴は確認できます。'],
    ['Ubah Status', 'Change Status', 'ステータスを変更'],
    ['Proses alur status pada Input Cepat sedang berlangsung.', 'The Quick Entry status workflow is still in progress.', 'クイック入力のステータス処理中です。'],
    ['Terdapat perubahan pada Input Cepat yang belum disimpan. Simpan perubahan terlebih dahulu, kemudian lanjutkan ke alur status?', 'Quick Entry has unsaved changes. Save them before continuing to the status workflow?', 'クイック入力に未保存の変更があります。先に保存してからステータスフローを続行しますか？'],
    ['Lihat Klaim:', 'View Claim:', '申請を表示：'],
    ['Ubah Klaim:', 'Edit Claim:', '申請を編集：'],
    ['Alasan perubahan nominal pada kotak kuning wajib diisi.', 'A reason for the amount change is required in the yellow box.', '黄色の欄に金額変更の理由を入力してください。'],
    ['Perubahan Input Cepat berhasil disimpan pada perangkat.', 'Quick Entry changes were saved on the device.', 'クイック入力の変更をデバイスに保存しました。'],
    ['Ubah data', 'Edit data', 'データを編集'],
    ['Apakah Anda yakin ingin menghapus data klaim ini secara permanen?', 'Are you sure you want to permanently delete this claim?', 'この申請データを完全に削除しますか？'],
    ['Penghapusan gagal disimpan lokal; data dikembalikan.', 'The deletion could not be saved locally; the data was restored.', '削除をローカルに保存できなかったため、データを復元しました。'],
    ['Data berhasil dihapus.', 'The data was deleted successfully.', 'データを削除しました。'],
    ['Status Paid/Hold harus dikoreksi melalui Tindakan Finance agar alasan audit tercatat.', 'Paid/Hold status must be corrected through Finance Actions so the audit reason is recorded.', 'Paid/Holdステータスは、監査理由を記録するため財務アクションから修正してください。'],
    ['Pembatalan status gagal disimpan pada perangkat; data telah dikembalikan.', 'The status cancellation could not be saved on the device; the data was restored.', 'ステータス取消をデバイスに保存できなかったため、データを復元しました。'],
    ['Status Posted berhasil dibatalkan.', 'The Posted status was cancelled successfully.', 'Postedステータスを取り消しました。'],
    ['Hanya data berstatus Posted atau pada tahap Cleared yang dapat diarsipkan.', 'Only Posted data or data at the Cleared stage can be archived.', 'PostedまたはCleared段階のデータのみ保管できます。'],
    ['Perubahan arsip gagal disimpan ke perangkat.', 'The archive change could not be saved on the device.', '保管状態の変更をデバイスに保存できません。'],
    ['Data berhasil diarsipkan.', 'The data was archived successfully.', 'データを保管しました。'],
    ['Data berhasil dikembalikan ke daftar aktif.', 'The data was restored to the active list.', 'データを有効一覧に戻しました。'],
    ['Paid mencatat penyelesaian pembayaran pada lembar kerja. Referensi wajib diisi; sistem ini tidak mengirimkan dana.', 'Paid records payment completion in the worksheet. A reference is required; this system does not transfer funds.', 'Paidはワークシート上の支払完了を記録します。参照番号は必須で、本システムが送金することはありません。'],
    ['Hold mengunci nilai klaim. Finance wajib mencantumkan alasan agar tindak lanjut tercatat dengan jelas.', 'Hold locks the claim amount. Finance must provide a reason so follow-up is recorded clearly.', 'Holdは申請金額をロックします。フォローアップを明確に記録するため、財務部は理由を入力してください。'],
    ['Pengembalian membuka kembali klaim agar Accounting dapat memperbaiki data. Finance tetap tidak dapat mengubah nominal.', 'Returning a claim reopens it so Accounting can correct the data. Finance still cannot change the amount.', '返却すると申請が再開され、経理がデータを修正できます。財務部は引き続き金額を変更できません。'],
    ['Pelepasan Hold mengembalikan klaim ke antrean Posted.', 'Releasing Hold returns the claim to the Posted queue.', 'Hold解除により申請はPostedキューに戻ります。'],
    ['Tindakan Finance hanya dapat dilakukan oleh Finance atau Admin.', 'Finance actions can only be performed by Finance or Admin users.', '財務アクションは財務または管理者のみ実行できます。'],
    ['Tanggal/jam perubahan status tidak valid.', 'The status-change date/time is invalid.', 'ステータス変更日時が無効です。'],
    ['Perubahan status gagal disimpan lokal; data dikembalikan.', 'The status change could not be saved locally; the data was restored.', 'ステータス変更をローカルに保存できなかったため、データを復元しました。'],
    ['Daftar claim tidak ditemukan.', 'The claim list was not found.', '申請一覧が見つかりません。'],
    ['Master GL tidak ditemukan.', 'The GL master was not found.', 'GLマスタが見つかりません。'],
    ['Master karyawan tidak ditemukan.', 'The employee master was not found.', '従業員マスタが見つかりません。'],
    ['Browser tidak mendukung pemeriksaan hash.', 'This browser does not support hash verification.', 'このブラウザーはハッシュ検証に対応していません。'],
    ['Hash SHA-256 tidak cocok; file mungkin berubah/rusak.', 'The SHA-256 hash does not match; the file may have changed or be damaged.', 'SHA-256ハッシュが一致しません。ファイルが変更または破損している可能性があります。'],
    ['Pemulihan belum selesai. Data cloud yang lebih baru tetap dipertahankan; silakan periksa lalu ulangi.', 'Restore is incomplete. Newer cloud data was retained; review it and try again.', '復元は完了していません。より新しいクラウドデータは保持されています。確認後に再実行してください。'],
    ['Cadangan lokal tervalidasi berhasil dibuat.', 'A validated local backup was created successfully.', '検証済みローカルバックアップを作成しました。'],
    ['Cadangan lokal gagal dibuat.', 'The local backup could not be created.', 'ローカルバックアップを作成できません。'],
    ['Versi cadangan tidak ditemukan.', 'The backup version was not found.', 'バックアップバージョンが見つかりません。'],
    ['Cadangan JSON skema 2 beserta manifes dan hash berhasil diunduh.', 'The schema 2 JSON backup, manifest, and hash were downloaded successfully.', 'スキーマ2のJSONバックアップ、マニフェスト、ハッシュをダウンロードしました。'],
    ['File format lama diterima dan akan dinormalisasi ke schema 2.', 'The legacy-format file was accepted and will be normalized to schema 2.', '旧形式のファイルを受け付け、スキーマ2に正規化します。'],
    ['Data lokal tetap aman dan akan dicoba lagi.', 'Local data remains safe and the operation will be retried.', 'ローカルデータは安全に保持され、再試行されます。'],
    ['Cloud belum menerima pembaruan. Silakan coba lagi.', 'The cloud has not received the update yet. Please try again.', 'クラウドはまだ更新を受信していません。再度お試しください。'],
    ['Ubah status Finance secara langsung', 'Change Finance status directly', '財務ステータスを直接変更'],
    ['Ubah status', 'Change status', 'ステータスを変更'],
    ['Data Excel berhasil ditempel.', 'The Excel data was pasted successfully.', 'Excelデータを貼り付けました。'],
    ['Tutup detail Activity Log', 'Close Activity Log details', '操作ログ詳細を閉じる'],

    ['Pengaturan Tampilan', 'Display Settings', '表示設定'],
    ['Sesuaikan bahasa, font, dan tema aplikasi.', 'Adjust the application language, font, and theme.', 'アプリの言語、フォント、テーマを設定します。'],
    ['Tema', 'Theme', 'テーマ'],
    ['Font Tampilan', 'Display Font', '表示フォント'],
    ['Bahasa', 'Language', '言語'],
    ['Profil dan Pengaturan', 'Profile and Settings', 'プロフィールと設定'],
    ['Buka profil dan pengaturan', 'Open profile and settings', 'プロフィールと設定を開く'],
    ['Pilih Status Tujuan', 'Select Target Status', '変更先ステータスを選択'],
    ['Pilih satu tindakan yang diizinkan untuk peran Anda.', 'Select an action authorized for your role.', '権限で許可された操作を選択してください。'],
    ['Lanjutkan proses Accounting', 'Continue Accounting processing', '経理処理を続行'],
    ['Kembalikan untuk perbaikan', 'Return for correction', '修正のため返却'],
    ['Kirim ke antrean persetujuan', 'Send to the approval queue', '承認待ちへ送る'],
    ['Selesaikan proses RTP', 'Complete the RTP process', 'RTP処理を完了'],
    ['Catat penyelesaian pembayaran', 'Record payment completion', '支払完了を記録'],
    ['Tahan proses dengan alasan', 'Place on hold with a reason', '理由を付けて保留'],
    ['Kembalikan untuk tindak lanjut', 'Return for follow-up', 'フォローアップのため返却'],

    ['Tidak terdapat data pada rincian ini.', 'No data was found for these details.', 'この詳細に該当するデータはありません。'],
    ['Buka rincian nota', 'Open receipt details', '領収書明細を開く'],
    ['Buka pengajuan lengkap', 'Open the complete claim', '申請全体を開く'],
    ['Lihat linimasa', 'View timeline', '履歴を表示'],
    ['Dasar tanggal: Tanggal Submit (cadangan: Tgl Proses)', 'Date basis: Submission Date (fallback: Processing Date)', '日付基準：申請日（予備：処理日）'],
    ['Seluruh Data', 'All Data', '全データ'],
    ['Rincian Data Amount', 'Amount Data Details', '金額データ詳細'],
    ['Rincian Total Dokumen', 'Total Document Details', '書類合計の詳細'],
    ['Rincian Penyusun Rata-rata SLA', 'Average SLA Supporting Details', '平均SLAの根拠明細'],
    ['Rincian Pendukung Pencapaian SLA', 'SLA Achievement Supporting Details', 'SLA達成の根拠明細'],
    ['Masukkan minimal dua karakter untuk memulai pencarian.', 'Enter at least two characters to start searching.', '検索を開始するには2文字以上入力してください。'],
    ['Data karyawan tidak ditemukan pada periode ini.', 'No employee data was found for this period.', 'この期間の従業員データは見つかりません。'],
    ['Buka rincian', 'Open details', '詳細を開く'],
    ['Rasio Revisi', 'Revision Ratio', '修正率'],
    ['Pilih baris untuk membuka detail dan catatan revisi.', 'Select a row to open its details and revision notes.', '行を選択して詳細と修正備考を開きます。'],
    ['Tipe:', 'Type:', '種類：'],
    ['Diinput oleh:', 'Entered by:', '入力者：'],
    ['Riwayat Revisi:', 'Revision History:', '修正履歴：'],
    ['Tidak ada catatan revisi.', 'There are no revision notes.', '修正備考はありません。'],
    ['Buka Dokumen', 'Open Document', '書類を開く'],
    ['Belum ada data pada periode ini.', 'There is no data for this period yet.', 'この期間にはまだデータがありません。'],
    ['Buka rincian riwayat dokumen karyawan', 'Open the employee document history details', '従業員の書類履歴詳細を開く'],
    ['(Buka rincian 🔍)', '(Open details 🔍)', '（詳細を開く 🔍）'],
    ['Total Amount:', 'Total Amount:', '合計金額：'],
    ['Sangat Baik + Perhatian', 'Excellent + Needs Attention', '良好＋要注意'],
    ['Data tidak ditemukan.', 'No data was found.', 'データが見つかりません。'],
    ['Total:', 'Total:', '合計：'],
    ['Nilai:', 'Amount:', '金額：'],
    ['Periode:', 'Period:', '期間：'],
    ['Filter:', 'Filter:', 'フィルター：']
];

const WORKSHEET_P18_TRANSLATION_ROWS = [
    // Sumber label sidebar memakai Bahasa Indonesia seperti menu lainnya,
    // supaya tampilan Bahasa Indonesia tidak menyisakan satu item berbahasa Inggris.
    ['Data Klaim', 'Claim Data', '申請データ'],
    ['Claim Data', 'Claim Data', '申請データ'],
    ['In Process', 'In Process', '処理中'],
    ['Pending Approval', 'Pending Approval', '承認待ち'],
    ['Claim History', 'Claim History', '申請履歴'],
    ['Canceled Claim', 'Canceled Claim', '取消済み申請'],
    ['Editor Teks', 'Text Editor', 'テキスト編集'],
    ['Editor Teks Website', 'Website Text Editor', 'Webサイトテキスト編集'],
    ['ADMIN CONTENT CONTROL', 'ADMIN CONTENT CONTROL', '管理者コンテンツ管理'],
    ['Ubah teks antarmuka tanpa menyentuh source code. Override dapat dibuat terpisah untuk Bahasa Indonesia, English, dan 日本語.', 'Edit interface copy without changing source code. Overrides can be maintained separately for Bahasa Indonesia, English, and 日本語.', 'ソースコードを変更せずにUIテキストを編集できます。インドネシア語・英語・日本語ごとに上書きを管理できます。'],
    ['Atur Ulang Draft', 'Reset Draft', '下書きをリセット'],
    ['Simpan Perubahan Teks', 'Save Text Changes', 'テキスト変更を保存'],
    ['Cari teks, misalnya login, rekapitulasi, status...', 'Search text, for example login, recapitulation, status...', 'ログイン、集計、ステータスなどのテキストを検索...'],
    ['Bahasa yang diedit', 'Editing language', '編集する言語'],
    ['Perubahan berlaku untuk semua perangkat setelah sinkronisasi Firestore. Kosongkan override untuk kembali menggunakan teks bawaan sistem.', 'Changes apply to all devices after Firestore synchronization. Clear an override to return to the system default text.', 'Firestore同期後、変更はすべての端末に反映されます。上書きを空にすると既定テキストに戻ります。'],
    ['Status & Linimasa Klaim', 'Claim Status & Timeline', '申請ステータスとタイムライン'],
    ['CLAIM WORKFLOW', 'CLAIM WORKFLOW', '申請ワークフロー'],
    ['Pantau posisi klaim, ubah status, dan telusuri seluruh catatan proses dalam satu tampilan.', 'Track the claim position, change status, and review the full process trail in one view.', '申請の現在位置、ステータス変更、処理履歴を一つの画面で確認できます。'],
    ['Status Saat Ini', 'Current Status', '現在のステータス'],
    ['Pilih Status Tujuan', 'Select Target Status', '変更先ステータスを選択'],
    ['Pilih satu tindakan yang diizinkan untuk peran Anda.', 'Choose an action allowed for your role.', '権限に応じて許可された操作を選択してください。'],
    ['Waktu Kejadian Historis', 'Historical Event Time', '履歴イベント時刻'],
    ['Kosongkan kolom ini untuk menggunakan waktu saat ini secara otomatis.', 'Leave this field blank to use the current time automatically.', '空欄の場合は現在時刻を自動使用します。'],
    ['Hapus waktu', 'Clear time', '時刻をクリア'],
    ['Tahap Tindak Lanjut', 'Follow-up Stage', 'フォローアップ段階'],
    ['Catatan Proses', 'Process Notes', '処理メモ'],
    ['Tuliskan keterangan untuk PIC.', 'Enter notes for the PIC.', '担当者向けのメモを入力してください。'],
    ['Alasan Cancel', 'Cancellation Reason', '取消理由'],
    ['Claim menjadi inactive dan tidak masuk Statistik/Management Summary. Status dapat dikembalikan ke In Process bila claim perlu diproses kembali.', 'The claim becomes inactive and is excluded from Statistics/Management Summary. It can be returned to In Process if processing needs to resume.', '申請は無効となり統計・管理サマリーから除外されます。必要に応じて処理中へ戻せます。'],
    ['Riwayat Perubahan Status', 'Status Change History', 'ステータス変更履歴'],
    ['Jejak status dan penyesuaian tersusun kronologis', 'Status and adjustment trail in chronological order', 'ステータスと調整履歴を時系列で表示'],
    ['Batalkan Status Terakhir', 'Undo Last Status', '直前のステータスを取消'],
    ['Rekap Harian', 'Daily Recap', '日次集計'],
    ['DAILY IMPORT', 'DAILY IMPORT', '日次インポート'],
    ['Tempel data dari Excel Admin, validasi otomatis, lalu simpan batch claim baru tanpa mengganggu pekerjaan yang sedang dibuka.', 'Paste data from the Admin Excel file, validate it automatically, then save a batch of new claims without interrupting the work currently open.', '管理用Excelからデータを貼り付け、自動検証後、現在の作業を中断せずに新規申請を一括保存します。'],
    ['Format Kolom', 'Column Format', '列フォーマット'],
    ['Tahapan Rekap Harian', 'Daily Recap Steps', '日次集計の手順'],
    ['Tempel Data', 'Paste Data', 'データ貼付'],
    ['Salin baris langsung dari Excel.', 'Copy rows directly from Excel.', 'Excelから行を直接コピーします。'],
    ['Validasi', 'Validate', '検証'],
    ['Duplikat, tanggal, mata uang, dan nominal diperiksa.', 'Duplicates, dates, currencies, and amounts are checked.', '重複、日付、通貨、金額を検証します。'],
    ['Simpan Batch', 'Save Batch', '一括保存'],
    ['Data masuk ke cache lokal lalu sinkron ke cloud.', 'Data is saved to local cache and then synchronized to the cloud.', 'ローカルキャッシュへ保存後、クラウドへ同期します。'],
    ['Area Tempel Data Excel', 'Excel Paste Area', 'Excel貼付エリア'],
    ['Satu baris Excel = satu claim baru.', 'One Excel row = one new claim.', 'Excel 1行 = 新規申請1件です。'],
    ['Proses & Tambahkan ke Rekapitulasi', 'Process & Add to Recapitulation', '処理して集計へ追加'],
    ['0 baris siap dibaca', '0 rows ready to read', '読み取り可能な行 0件'],
    ['Claim aktif yang masih diproses Accounting, termasuk data yang dikembalikan oleh Finance.', 'Active claims still being processed by Accounting, including claims returned by Finance.', '経理で処理中の有効な申請（財務から返却されたものを含む）。'],
    ['Claim inactive. Nominal tetap tercatat di Rekapitulasi tetapi dikeluarkan dari Statistik dan Management Summary.', 'Inactive claims. Amounts remain recorded in Recapitulation but are excluded from Statistics and Management Summary.', '無効な申請です。金額は集計に残りますが、統計と管理サマリーから除外されます。'],
    ['Status & Keterangan', 'Status & Notes', 'ステータス・備考'],
    ['Tgl Cancel', 'Cancel Date', '取消日'],
    ['PIC Cancel', 'Cancel PIC', '取消担当者'],
    ['Alasan Cancel', 'Cancellation Reason', '取消理由'],
    ['Detail Catatan', 'Note Details', 'メモ詳細'],
    ['Kembalikan ke In Process', 'Return to In Process', '処理中へ戻す'],
    ['Claim canceled dapat diproses kembali melalui status In Process.', 'A canceled claim can be processed again by returning it to In Process.', '取消済み申請は処理中へ戻すことで再処理できます。'],
    ['Status berhasil dikembalikan ke In Process.', 'Status was returned to In Process.', 'ステータスを処理中へ戻しました。'],
    ['Alasan reverse cancel wajib diisi.', 'A reason for reversing the cancellation is required.', '取消解除の理由を入力してください。'],
    ['Alasan Mengaktifkan Kembali', 'Reactivation Reason', '再有効化理由'],
    ['Tuliskan alasan claim diproses kembali.', 'Enter why the claim is being processed again.', '申請を再処理する理由を入力してください。'],
    ['Menampilkan seluruh histori revisi lintas periode. Gunakan pagination untuk membuka data lama.', 'Shows the complete revision history across periods. Use pagination to view older data.', '期間をまたぐすべての修正履歴を表示します。古いデータはページ送りで確認できます。'],
    ['Pemantauan Revisi', 'Revision Monitoring', '修正モニタリング'],
    ['Pemantauan Aktif', 'Active Monitoring', '有効モニタリング'],
    ['Arsip Monitoring', 'Monitoring Archive', 'モニタリングアーカイブ'],
    ['Perluas', 'Expand', '展開'],
    ['Minimize', 'Minimize', '最小化'],
    ['Tampilan Daftar', 'List View', '一覧表示'],
    ['Tampilan Folder', 'Folder View', 'フォルダー表示'],
    ['Ubah Pilihan ke Posted', 'Change Selected to Posted', '選択項目を計上済みに変更'],
    ['Hapus Semua Data Aktif', 'Delete All Active Data', '有効データをすべて削除'],
    ['Ekspor Ringkasan', 'Export Summary', 'サマリーを出力'],
    ['Ekspor Detail', 'Export Details', '詳細を出力'],
    ['Pencarian cepat', 'Quick search', 'クイック検索'],
    ['Cari No. pengajuan, NIK, nama, tipe...', 'Search claim no., NIK, name, type...', '申請番号、NIK、氏名、種別を検索...'],
    ['Detail Catatan Cancel', 'Cancellation Note Details', '取消メモ詳細'],
    ['Detail Catatan Aktivasi Kembali', 'Reactivation Note Details', '再有効化メモ詳細'],
    ['Tidak ada claim aktif pada filter ini.', 'No active claims match this filter.', 'このフィルターに一致する有効な申請はありません。'],
    ['Tidak ada claim canceled pada filter ini.', 'No canceled claims match this filter.', 'このフィルターに一致する取消済み申請はありません。'],
    ['Perubahan dan adjustment berhasil disimpan. Data tetap terbuka.', 'Changes and adjustments were saved. The current claim remains open.', '変更と調整を保存しました。現在の申請画面を開いたままにします。'],
    ['Status sedang disimpan. Mohon tunggu.', 'The status is being saved. Please wait.', 'ステータスを保存しています。しばらくお待ちください。'],
    ['Perubahan status ini tidak diizinkan untuk peran Anda.', 'This status change is not allowed for your role.', 'このステータス変更は現在の権限では許可されていません。'],
    ['Alasan revisi wajib diisi.', 'A revision reason is required.', '修正理由を入力してください。'],
    ['Alasan cancel wajib diisi.', 'A cancellation reason is required.', '取消理由を入力してください。'],
    ['Referensi pembayaran wajib diisi sebelum status diubah menjadi Paid.', 'A payment reference is required before changing the status to Paid.', 'Paidへ変更する前に支払参照番号を入力してください。'],
    ['Alasan atau catatan Finance wajib diisi untuk tindakan ini.', 'A Finance reason or note is required for this action.', 'この操作にはFinanceの理由またはメモが必要です。'],
    ['Tanggal/jam perubahan status tidak valid.', 'The status change date/time is invalid.', 'ステータス変更日時が無効です。'],
    ['Menyimpan...', 'Saving...', '保存中...'],
    ['Draft editor teks dikembalikan ke versi tersimpan.', 'The text editor draft was restored to the saved version.', 'テキスト編集の下書きを保存済みの状態へ戻しました。'],
    ['Editor teks hanya dapat disimpan Admin.', 'Only Admin can save website text changes.', 'Webサイトテキストの変更を保存できるのはAdminのみです。'],
    ['Perubahan teks berhasil disimpan dan berlaku lintas perangkat.', 'Text changes were saved and will apply across devices.', 'テキスト変更を保存しました。すべての端末へ反映されます。'],
    ['Perubahan teks gagal disimpan. Periksa izin Firebase Admin.', 'Text changes could not be saved. Check the Admin Firebase permissions.', 'テキスト変更を保存できませんでした。AdminのFirebase権限を確認してください。'],
    ['Tidak ada teks yang cocok.', 'No matching text was found.', '一致するテキストがありません。'],
    ['Override aktif', 'Override active', '上書き有効'],
    ['Teks bawaan sistem', 'System default', 'システム既定'],
    ['Bersihkan', 'Clear', 'クリア'],
    ['CLAIM NOTE', 'CLAIM NOTE', '申請メモ'],
    ['Detail Catatan', 'Note Details', 'メモ詳細'],
    ['Oleh:', 'By:', '担当：'],
    ['Status', 'Status', 'ステータス'],
    ['Penyesuaian', 'Adjustment', '調整'],
    ['Revisi', 'Revision', '修正'],
    ['Ubah Password', 'Change Password', 'パスワード変更'],
    ['Untuk keamanan, masukkan password saat ini lalu password baru. Perubahan berlaku langsung pada Firebase Authentication untuk akun yang sedang login.', 'For security, enter the current password and then the new password. The change applies immediately to the signed-in Firebase Authentication account.', 'セキュリティのため、現在のパスワードと新しいパスワードを入力してください。変更はログイン中のFirebase Authenticationアカウントへ直ちに適用されます。'],
    ['Simpan Password', 'Save Password', 'パスワードを保存'],
    ['Claim canceled dapat diproses kembali melalui status In Process. Riwayat cancel tetap tersimpan pada linimasa.', 'A canceled claim can be processed again by returning it to In Process. The cancellation history remains in the timeline.', '取消済み申請は処理中へ戻すことで再処理できます。取消履歴はタイムラインに残ります。'],
    ['Ringkasan kinerja operasional, perbandingan periode, SLA, dan tren utama dalam satu tampilan.', 'Operational performance, period comparisons, SLA, and key trends in one view.', '業務実績、期間比較、SLA、主要トレンドを一つの画面で確認できます。'],
    ['Periode Analisis', 'Analysis Period', '分析期間'],
    ['Atur rentang data manajemen', 'Set the management data range', '管理データの期間を設定'],
    ['Filter Ringkasan Manajemen', 'Management Summary Filter', '管理サマリーフィルター'],
    ['Preset periode Ringkasan Manajemen', 'Management Summary period preset', '管理サマリー期間プリセット'],
    ['Kelola peran pengguna Firebase. Role Accounting disimpan sebagai accounting. Perubahan kata sandi dilakukan oleh pengguna yang sedang login melalui menu profil.', 'Manage Firebase user roles. The Accounting role is stored as accounting. Password changes are performed by the signed-in user through the profile menu.', 'Firebaseユーザー権限を管理します。Accounting権限はaccountingとして保存されます。パスワード変更はログイン中のユーザーがプロフィールメニューから行います。'],
    ['Hapus > 1 Hari', 'Delete > 1 Day', '1日超を削除'],
    ['Hapus > 3 Hari', 'Delete > 3 Days', '3日超を削除'],
    ['Hapus > 7 Hari', 'Delete > 7 Days', '7日超を削除'],
    ['Pilih status tujuan', 'Select target status', '変更先ステータスを選択'],
    ['Contoh: double pengajuan, pengajuan tidak jadi diproses, atau alasan lain yang dapat diaudit.', 'Example: duplicate submission, submission no longer needs processing, or another auditable reason.', '例：重複申請、処理不要となった申請、または監査可能なその他の理由。'],
    ['Tempel baris data Excel di sini...', 'Paste Excel rows here...', 'Excelの行をここに貼り付け...'],
    ['Pilihan periode In Process', 'In Process period options', '処理中の期間選択'],
    ['Pilihan periode Canceled Claim', 'Canceled Claim period options', '取消済み申請の期間選択'],
    ['Filter Tgl Cancel...', 'Filter Cancel Date...', '取消日を絞り込み...'],
    ['Atur ulang filter Top Revisi', 'Reset Top Revision filter', '修正上位フィルターをリセット'],
    ['Atur ulang filter Top Pengaju', 'Reset Top Claimant filter', '申請者上位フィルターをリセット'],
    // V3.2.2 copy cleanup: aliases for refreshed Indonesian UI wording.
    ['WORKSHEET KLAIM', 'CLAIM WORKSHEET', '申請ワークシート'],
    ['Pengelolaan klaim Accounting dan Finance.', 'Accounting and Finance claim management.', 'Accounting・Finance申請管理。'],
    ['Pencatatan, pemantauan, tindak lanjut, dan pembayaran klaim dalam satu aplikasi.', 'Record, monitor, follow up, and process claim payments in one application.', '申請の記録・監視・フォローアップ・支払処理を一つのアプリで行います。'],
    ['ALUR KLAIM', 'CLAIM WORKFLOW', '申請ワークフロー'],
    ['Alasan Pembatalan', 'Cancellation Reason', '取消理由'],
    ['Contoh: pengajuan ganda, pengajuan tidak jadi diproses, atau alasan lain yang dapat diaudit.', 'Example: duplicate submission, submission no longer needs processing, or another auditable reason.', '例：重複申請、処理不要となった申請、または監査可能なその他の理由。'],
    ['Klaim dinonaktifkan dan tidak masuk Statistik & Analitik maupun Ringkasan Manajemen. Status dapat dikembalikan ke In Process jika klaim perlu diproses kembali.', 'The claim is deactivated and excluded from Statistics & Analytics and Management Summary. It can be returned to In Process if processing needs to resume.', '申請は無効化され、統計・分析および管理サマリーから除外されます。必要に応じてIn Processへ戻せます。'],
    ['Tuliskan alasan klaim diproses kembali.', 'Enter why the claim is being processed again.', '申請を再処理する理由を入力してください。'],
    ['Klaim yang dibatalkan dapat diproses kembali melalui status In Process. Riwayat pembatalan tetap tersimpan pada linimasa.', 'A canceled claim can be processed again through In Process. The cancellation history remains in the timeline.', '取消済み申請はIn Processを通じて再処理できます。取消履歴はタイムラインに残ります。'],
    ['Referensi Pembayaran', 'Payment Reference', '支払参照番号'],
    ['CATATAN KLAIM', 'CLAIM NOTE', '申請メモ'],
    ['Klaim Dibatalkan', 'Canceled Claim', '取消済み申請'],
    ['Format Jurnal Klaim', 'Claim Journal Format', '申請仕訳フォーマット'],
    ['Layar ini hanya menampilkan klaim lama yang masih memiliki baris jurnal. Pengajuan baru dibuat melalui Input Pengajuan Baru.', 'This screen only shows legacy claims that still contain journal lines. New submissions are created through New Submission Entry.', 'この画面では仕訳明細を持つ旧申請のみ表示します。新規申請は「新規申請入力」から作成します。'],
    ['Akun Anda hanya memiliki akses baca pada layar ini. Tindakan pembayaran, jika diizinkan untuk peran Anda, dilakukan melalui menu Data Payment.', 'Your account has read-only access on this screen. Payment actions, when permitted for your role, are performed from the Data Payment menu.', 'この画面では閲覧のみ可能です。権限がある場合、支払操作はData Paymentメニューから行います。'],
    ['Satu formulir untuk merekam satu pengajuan klaim, tanpa jurnal maupun akun GL.', 'One form to record one claim submission without journal lines or GL accounts.', '仕訳明細やGL勘定を使わず、1件の申請を1つのフォームで登録します。'],
    ['Data utama pengajuan.', 'Main submission data.', '申請の基本情報。'],
    ['Tanggal terisi otomatis saat klaim mulai diproses.', 'The date is filled automatically when claim processing starts.', '申請処理の開始時に日付が自動入力されます。'],
    ['Pengajuan tetap dapat disimpan walaupun hardcopy belum diterima.', 'The submission can still be saved even if the hardcopy has not been received.', 'ハードコピー未受領でも申請を保存できます。'],
    ['REKAP HARIAN', 'DAILY RECAP', '日次集計'],
    ['Tempel data dari Excel Admin, validasi otomatis, lalu simpan beberapa pengajuan baru tanpa mengganggu pekerjaan yang sedang dibuka.', 'Paste data from the Admin Excel file, validate it automatically, then save multiple new submissions without interrupting the current work.', '管理用Excelからデータを貼り付け、自動検証後、現在の作業を中断せず複数の新規申請を保存します。'],
    ['Satu baris Excel = satu pengajuan baru.', 'One Excel row = one new submission.', 'Excel 1行 = 新規申請1件です。'],
    ['DATA KLAIM', 'CLAIM DATA', '申請データ'],
    ['Klaim yang masih berstatus Revisi', 'Claims still in Revision status', '修正ステータスの申請'],
    ['Seluruh klaim Accounting dan Finance dalam satu tabel, lengkap dengan SLA dan status terkini.', 'All Accounting and Finance claims in one table, with SLA and current status.', 'AccountingとFinanceの全申請を、SLAと最新ステータス付きで一覧表示します。'],
    ['Klaim aktif yang masih diproses Accounting, termasuk data yang dikembalikan oleh Finance.', 'Active claims still being processed by Accounting, including claims returned by Finance.', 'Accountingで処理中の有効な申請（Financeから返却されたものを含む）。'],
    ['Daftar Klaim Aktif', 'Active Claim List', 'アクティブ申請一覧'],
    ['Klaim berstatus In Process dan Returned by Finance', 'Claims with In Process and Returned by Finance status', 'In ProcessおよびReturned by Financeの申請'],
    ['Klaim yang telah mencapai RTP dan menunggu proses pembayaran Finance. Hardcopy wajib diterima sebelum pembayaran dapat dilakukan.', 'Claims that have reached RTP and are waiting for Finance payment processing. Hardcopy must be received before payment can be processed.', 'RTPに到達しFinanceの支払処理を待つ申請です。支払前にハードコピー受領が必要です。'],
    ['Seluruh klaim berstatus Posted', 'All claims with Posted status', 'Postedステータスの全申請'],
    ['Klaim yang sementara ditahan oleh Finance dan masih memerlukan tindak lanjut sebelum pembayaran.', 'Claims temporarily held by Finance that still require follow-up before payment.', 'Financeで一時保留され、支払前にフォローアップが必要な申請。'],
    ['Klaim Ditahan', 'Held Claims', '保留中の申請'],
    ['Seluruh klaim berstatus Hold', 'All claims with Hold status', 'Holdステータスの全申請'],
    ['Klaim yang telah dikembalikan oleh Finance kepada Accounting untuk diperbaiki atau ditindaklanjuti.', 'Claims returned by Finance to Accounting for correction or follow-up.', 'FinanceからAccountingへ修正またはフォローアップのため返却された申請。'],
    ['Klaim Dikembalikan', 'Returned Claims', '返却された申請'],
    ['Seluruh klaim berstatus Returned by Finance', 'All claims with Returned by Finance status', 'Returned by Financeステータスの全申請'],
    ['Klaim yang dibatalkan tetap tercatat di Rekapitulasi, tetapi dikeluarkan dari Statistik & Analitik serta Ringkasan Manajemen.', 'Canceled claims remain recorded in Recapitulation but are excluded from Statistics & Analytics and Management Summary.', '取消済み申請は集計に残りますが、統計・分析および管理サマリーから除外されます。'],
    ['Filter Klaim Dibatalkan', 'Canceled Claim Filter', '取消済み申請フィルター'],
    ['Pilihan periode Klaim Dibatalkan', 'Canceled Claim period options', '取消済み申請の期間選択'],
    ['Periode Tgl Pembatalan', 'Cancellation Date Period', '取消日の期間'],
    ['Daftar Klaim Dibatalkan', 'Canceled Claim List', '取消済み申請一覧'],
    ['Jejak RTP, pembayaran, dan status klaim terkini', 'RTP, payment, and current claim status trail', 'RTP・支払・最新ステータスの記録'],
    ['Dokumen yang menunggu persetujuan sebelum dapat di-Posted oleh Accounting.', 'Documents waiting for approval before Accounting can mark them as Posted.', 'AccountingがPostedにする前の承認待ち書類。'],
    ['PENCARIAN KLAIM', 'CLAIM LOOKUP', '申請検索'],
    ['Telusuri klaim berdasarkan Tanggal Submit dan kata kunci NIK, nama karyawan, atau nomor pengajuan.', 'Search claims by Submit Date and a keyword such as NIK, employee name, or submission number.', '提出日とNIK・従業員名・申請番号のキーワードで申請を検索します。'],
    ['Masukkan NIK, nama, atau No. Pengajuan lalu Enter...', 'Enter NIK, name, or submission number, then press Enter...', 'NIK、氏名、または申請番号を入力してEnter...'],
    ['Cari user, aktivitas, nomor pengajuan, atau ID klaim...', 'Search user, activity, submission number, or claim ID...', 'ユーザー、操作、申請番号、または申請IDを検索...'],
    ['Tinjau seluruh klaim Accounting dan Finance dalam satu tabel, lengkap dengan SLA dan status terkini.', 'Review all Accounting and Finance claims in one table, including SLA and current status.', 'AccountingとFinanceの全申請を、SLAと最新ステータス付きで一覧確認します。']
];

const WORKSHEET_P19_TRANSLATION_ROWS = [
    ['Akun ini hanya memiliki akses baca.', 'This account has read-only access.', 'このアカウントは閲覧のみ可能です。'],
    ['Tindakan ini hanya dapat dilakukan Admin.', 'This action can only be performed by Admin.', 'この操作はAdminのみ実行できます。'],
    ['Log aktivitas pada cloud gagal dibersihkan.', 'Cloud activity logs could not be cleared.', 'クラウドの操作ログを削除できませんでした。'],
    ['Akun GL tidak boleh mengandung angka.', 'The GL account must not contain numbers.', 'GLアカウントに数字は使用できません。'],
    ['✅ Perubahan baru disimpan; data yang tidak berubah dilewati. (Shift+S)', '✅ New changes were saved; unchanged data was skipped. (Shift+S)', '✅ 新しい変更を保存しました。変更のないデータはスキップしました。（Shift+S）'],
    ['Sesi pengguna belum siap.', 'The user session is not ready yet.', 'ユーザーセッションの準備ができていません。'],
    ['Fitur ubah password belum siap.', 'The password change feature is not ready yet.', 'パスワード変更機能の準備ができていません。'],
    ['Password saat ini wajib diisi dan password baru minimal 8 karakter.', 'Enter the current password and a new password of at least 8 characters.', '現在のパスワードと8文字以上の新しいパスワードを入力してください。'],
    ['Konfirmasi password baru tidak sama.', 'The new password confirmation does not match.', '新しいパスワードの確認入力が一致しません。'],
    ['Password baru harus berbeda dari password saat ini.', 'The new password must be different from the current password.', '新しいパスワードは現在のパスワードと異なるものにしてください。'],
    ['Password berhasil diubah.', 'Password changed successfully.', 'パスワードを変更しました。'],
    ['Password saat ini tidak sesuai.', 'The current password is incorrect.', '現在のパスワードが正しくありません。'],
    ['Password baru terlalu lemah.', 'The new password is too weak.', '新しいパスワードが弱すぎます。'],
    ['Password gagal diubah. Silakan login ulang lalu coba kembali.', 'The password could not be changed. Sign in again and try once more.', 'パスワードを変更できませんでした。再ログインしてもう一度お試しください。'],
    ['Detail log aktivitas tidak ditemukan.', 'Activity log details were not found.', '操作ログの詳細が見つかりません。'],
    ['Nama pengguna (minimal dua karakter), Firebase UID, dan peran wajib valid.', 'Username (at least two characters), Firebase UID, and role must be valid.', 'ユーザー名（2文字以上）、Firebase UID、権限を正しく入力してください。'],
    ['Firebase belum siap.', 'Firebase is not ready yet.', 'Firebaseの準備ができていません。'],
    ['Peran pengguna berhasil disimpan.', 'The user role was saved successfully.', 'ユーザー権限を保存しました。'],
    ['Peran gagal disimpan. Pastikan akun yang aktif memiliki peran Admin.', 'The role could not be saved. Make sure the active account has the Admin role.', '権限を保存できませんでした。現在のアカウントがAdmin権限を持っていることを確認してください。'],
    ['Peran pengguna berhasil dihapus.', 'The user role was removed successfully.', 'ユーザー権限を削除しました。'],
    ['Peran pengguna gagal dihapus.', 'The user role could not be removed.', 'ユーザー権限を削除できませんでした。'],
    ['Data berhasil diubah menjadi Posted.', 'The data was successfully changed to Posted.', 'データをPostedへ変更しました。'],
    ['Pilih minimal satu filter atau gunakan tombol Bersihkan.', 'Select at least one filter or use the Clear button.', '少なくとも1つのフィルターを選択するか、クリアボタンを使用してください。'],
    ['Format tanggal tidak sesuai. Gunakan format DD/MM/YYYY.', 'Invalid date format. Use DD/MM/YYYY.', '日付形式が正しくありません。DD/MM/YYYYを使用してください。'],
    ['Editor teks hanya dapat diakses Admin.', 'The text editor can only be accessed by Admin.', 'テキストエディターはAdminのみ利用できます。'],
    ['Referensi dokumen berhasil disimpan.', 'Document references were saved successfully.', '書類参照番号を保存しました。'],
    ['Tidak terdapat data untuk dihapus.', 'There is no data to delete.', '削除するデータがありません。'],
    ['Penyimpanan lokal gagal; data dikembalikan.', 'Local save failed; the data was restored.', 'ローカル保存に失敗したため、データを元に戻しました。'],
    ['Data terkunci (Posted/Paid/Hold) bersifat baca-saja.', 'Locked data (Posted/Paid/Hold) is read-only.', 'ロック済みデータ（Posted/Paid/Hold）は閲覧のみ可能です。'],
    ['Pembatalan penyesuaian masih diproses.', 'The adjustment reversal is still being processed.', '調整の取消処理中です。'],
    ['Penyimpanan lokal gagal; data dikembalikan seperti semula.', 'Local save failed; the data was restored to its previous state.', 'ローカル保存に失敗したため、データを元の状態へ戻しました。'],
    ['Penyesuaian yang dipilih berhasil dibatalkan.', 'The selected adjustments were successfully reversed.', '選択した調整を取り消しました。'],
    ['Tidak terdapat riwayat penyesuaian.', 'There is no adjustment history.', '調整履歴がありません。'],
    ['Penyesuaian berhasil dibatalkan.', 'The adjustment was successfully reversed.', '調整を取り消しました。'],
    ['Penyimpanan lokal massal gagal; data dikembalikan seperti semula.', 'Bulk local save failed; the data was restored to its previous state.', '一括ローカル保存に失敗したため、データを元の状態へ戻しました。'],
    ['Seluruh penyesuaian berhasil dibatalkan.', 'All adjustments were successfully reversed.', 'すべての調整を取り消しました。'],
    ['NIK dan nama wajib diisi.', 'NIK and name are required.', 'NIKと氏名は必須です。'],
    ['Data karyawan berhasil disimpan.', 'Employee data was saved successfully.', '従業員データを保存しました。'],
    ['Data karyawan berhasil dihapus.', 'Employee data was deleted successfully.', '従業員データを削除しました。'],
    ['Data GL tersebut telah tersedia.', 'That GL data already exists.', 'そのGLデータは既に登録されています。'],
    ['Data GL berhasil disimpan.', 'GL data was saved successfully.', 'GLデータを保存しました。'],
    ['Data GL berhasil dihapus.', 'GL data was deleted successfully.', 'GLデータを削除しました。'],
    ['Data berhasil disalin ke papan klip.', 'Data was copied to the clipboard.', 'データをクリップボードへコピーしました。'],
    ['Data berhasil ditempel pada area yang dipilih.', 'Data was pasted into the selected area.', '選択した領域へデータを貼り付けました。'],
    ['Data berhasil ditempel.', 'Data was pasted successfully.', 'データを貼り付けました。'],
    ['Status pertama tidak dapat dibatalkan.', 'The first status cannot be undone.', '最初のステータスは取り消せません。'],
    ['Pembatalan status gagal disimpan ke perangkat.', 'The status reversal could not be saved on this device.', 'ステータス取消を端末へ保存できませんでした。'],
    ['Status terakhir berhasil dibatalkan.', 'The latest status was successfully undone.', '直前のステータスを取り消しました。'],
    ['Laporan Excel berhasil diunduh.', 'The Excel report was downloaded successfully.', 'Excelレポートをダウンロードしました。'],
    ['Data header belum lengkap atau nominal bernilai nol.', 'Header data is incomplete or the amount is zero.', 'ヘッダーデータが未完了、または金額が0です。'],
    ['Perubahan formulir harus disimpan oleh Accounting atau Admin terlebih dahulu.', 'Form changes must first be saved by Accounting or Admin.', 'フォーム変更は先にAccountingまたはAdminが保存してください。'],
    ['Impor sebelumnya masih sedang diproses.', 'The previous import is still being processed.', '前回のインポート処理がまだ完了していません。'],
    ['Area input masih kosong. Silakan tempel data Excel terlebih dahulu.', 'The input area is empty. Paste the Excel data first.', '入力欄が空です。先にExcelデータを貼り付けてください。'],
    ['Format matriks data tidak sesuai. Mohon periksa kembali.', 'The data matrix format is invalid. Please check it again.', 'データ行列の形式が正しくありません。再確認してください。'],
    ['Impor gagal disimpan. Data tidak dimasukkan ke Rekapitulasi.', 'The import could not be saved. No data was added to Recapitulation.', 'インポートを保存できませんでした。データは集計へ追加されていません。'],
    ['Pilih minimal satu data yang akan diubah menjadi Posted.', 'Select at least one record to change to Posted.', 'Postedへ変更するデータを1件以上選択してください。'],
    ['Tanggal atau jam perubahan massal ke Posted tidak valid.', 'The date or time for the bulk Posted change is invalid.', 'Posted一括変更の日時が無効です。'],
    ['Perubahan status massal gagal disimpan pada perangkat.', 'The bulk status change could not be saved on this device.', 'ステータス一括変更を端末へ保存できませんでした。'],
    ['Tidak ada data terpilih yang dapat diubah menjadi Posted.', 'None of the selected data can be changed to Posted.', '選択したデータにPostedへ変更できるものがありません。'],
    ['Pembatalan massal hanya berlaku untuk status Posted. Paid/Hold wajib dikoreksi satu per satu dengan alasan audit.', 'Bulk reversal only applies to Posted. Paid/Hold must be corrected individually with an audit reason.', '一括取消はPostedのみ対象です。Paid/Holdは監査理由を付けて1件ずつ修正してください。'],
    ['Pembatalan massal gagal disimpan pada perangkat; data telah dikembalikan.', 'The bulk reversal could not be saved on this device; the data was restored.', '一括取消を端末へ保存できなかったため、データを元に戻しました。'],
    ['Status Posted pada data terpilih berhasil dibatalkan.', 'Posted status was successfully reversed for the selected data.', '選択したデータのPostedステータスを取り消しました。'],
    ['Pilih minimal satu data untuk dihapus.', 'Select at least one record to delete.', '削除するデータを1件以上選択してください。'],
    ['Penghapusan massal gagal disimpan lokal; data dikembalikan.', 'Bulk deletion could not be saved locally; the data was restored.', '一括削除をローカル保存できなかったため、データを元に戻しました。'],
    ['Data yang dipilih berhasil dihapus.', 'The selected data was deleted successfully.', '選択したデータを削除しました。'],
    ['Pilih minimal satu data revisi untuk dihapus.', 'Select at least one revision record to delete.', '削除する修正データを1件以上選択してください。'],
    ['Silakan simpan data sebagai Draft terlebih dahulu sebelum melakukan penyesuaian.', 'Save the data as Draft before making an adjustment.', '調整を行う前にデータをDraftとして保存してください。'],
    ['Penyesuaian sebelumnya masih dalam proses penyimpanan.', 'The previous adjustment is still being saved.', '前回の調整を保存中です。'],
    ['Nominal dan alasan wajib diisi.', 'Amount and reason are required.', '金額と理由は必須です。'],
    ['Penyesuaian menyebabkan total header bernilai nol atau negatif sehingga tidak dapat disimpan.', 'The adjustment would make the header total zero or negative, so it cannot be saved.', '調整後のヘッダー合計が0以下になるため保存できません。'],
    ['Penyesuaian gagal disimpan pada perangkat.', 'The adjustment could not be saved on this device.', '調整を端末へ保存できませんでした。'],
    ['Penyesuaian berhasil disimpan. Silakan lanjutkan input atau tekan Esc untuk menutup.', 'The adjustment was saved. Continue editing or press Esc to close.', '調整を保存しました。入力を続けるか、Escで閉じてください。'],
    ['Membuka rincian data berdasarkan urutan yang dipilih.', 'Opening data details in the selected order.', '選択した順序でデータ詳細を開きます。'],
    ['Silakan pilih rentang Tanggal Submit terlebih dahulu.', 'Select the Submit Date range first.', '先に提出日の期間を選択してください。'],
    ['Silakan masukkan NIK, nama, atau nomor dokumen terlebih dahulu.', 'Enter an NIK, name, or document number first.', '先にNIK、氏名、または書類番号を入力してください。'],
    ['Pilihan lama berada di luar periode/filter aktif. Pilih ulang data yang ingin diekspor.', 'The previous selection is outside the active period/filter. Select the data to export again.', '以前の選択は現在の期間・フィルター外です。出力するデータを選び直してください。'],
    ['Mode ekspor tidak dikenali.', 'The export mode is not recognized.', '出力モードを認識できません。'],
    ['Masukkan nomor referensi atau NIK terlebih dahulu.', 'Enter a reference number or NIK first.', '先に参照番号またはNIKを入力してください。'],
    ['Baris yang telah memiliki penyesuaian harus dinetralkan terlebih dahulu (Amount Klaim = Amount Nota), kemudian jalankan penyesuaian.', 'Rows with an existing adjustment must first be neutralized (Claim Amount = Receipt Amount), then run the adjustment.', '既に調整がある行は先に中立化（申請金額＝領収書金額）してから調整を実行してください。'],
    ['Tidak terdapat perbedaan antara Amount Nota dan Amount Klaim untuk disesuaikan.', 'There is no difference between Receipt Amount and Claim Amount to adjust.', '領収書金額と申請金額に調整対象の差額がありません。'],
    ['Penyelesaian dilakukan melalui menu Status setelah rincian berstatus Final.', 'Completion is performed through the Status menu after the details are Final.', '明細がFinalになった後、Statusメニューから完了処理を行ってください。'],
    ['Rincian gagal disimpan pada perangkat.', 'The details could not be saved on this device.', '明細を端末へ保存できませんでした。'],
    ['Rincian belum dapat dihapus karena masih terdapat penyesuaian aktif. Netralkan Amount Klaim, kemudian jalankan penyesuaian terlebih dahulu.', 'The details cannot be deleted while an active adjustment remains. Neutralize the Claim Amount, then process the adjustment first.', '有効な調整が残っているため明細を削除できません。申請金額を中立化し、先に調整を処理してください。'],
    ['Penghapusan detail gagal disimpan lokal; data dikembalikan.', 'Detail deletion could not be saved locally; the data was restored.', '明細削除をローカル保存できなかったため、データを元に戻しました。'],
    ['Rincian pengajuan berhasil dihapus.', 'The claim details were deleted successfully.', '申請明細を削除しました。'],
    ['Belum terdapat data yang tersimpan.', 'There is no saved data yet.', '保存済みデータはまだありません。'],
    ['Rincian nota berhasil diekspor ke Excel.', 'Receipt details were exported to Excel successfully.', '領収書明細をExcelへ出力しました。'],
    ['Kolom Alasan Revisi wajib diisi sebelum status diubah menjadi Revisi.', 'The Revision Reason field is required before changing the status to Revision.', 'ステータスを修正へ変更する前に修正理由を入力してください。'],
    ['Apakah Anda yakin ingin menghapus peran yang dipilih? Akun Firebase tidak akan dihapus, tetapi aksesnya akan kembali menjadi Viewer (hanya baca).', 'Are you sure you want to remove the selected role? The Firebase account will not be deleted, but its access will return to Viewer (read-only).', '選択した権限を削除しますか？Firebaseアカウントは削除されませんが、アクセス権はViewer（閲覧のみ）へ戻ります。'],
    ['Apakah Anda yakin ingin membatalkan penyesuaian terakhir?', 'Are you sure you want to reverse the latest adjustment?', '直前の調整を取り消しますか？'],
    ['⚠️ Apakah Anda yakin ingin membatalkan seluruh penyesuaian sekaligus? Sistem akan membatalkannya satu per satu mulai dari transaksi terakhir.', '⚠️ Are you sure you want to reverse all adjustments? The system will reverse them one by one starting from the latest transaction.', '⚠️ すべての調整を取り消しますか？最新の取引から1件ずつ取り消します。'],
    ['Apakah Anda yakin ingin menghapus data karyawan yang dipilih?', 'Are you sure you want to delete the selected employee data?', '選択した従業員データを削除しますか？'],
    ['Apakah Anda yakin ingin menghapus data GL yang dipilih?', 'Are you sure you want to delete the selected GL data?', '選択したGLデータを削除しますか？'],
    ['Apakah Anda yakin ingin membatalkan status terakhir? Jejak sebelumnya tetap disimpan untuk keperluan audit.', 'Are you sure you want to undo the latest status? The previous trail will remain stored for audit purposes.', '直前のステータスを取り消しますか？以前の履歴は監査用に保持されます。'],
    ['Data telah berstatus Final. Apakah Anda yakin ingin mengembalikan rincian ini ke status Draft?', 'The data is Final. Are you sure you want to return these details to Draft?', 'データはFinalです。この明細をDraftへ戻しますか？'],
    ['Apakah Anda yakin ingin menghapus seluruh rincian nota ini?', 'Are you sure you want to delete all of these receipt details?', 'この領収書明細をすべて削除しますか？'],
    ['⏳ Membaca Data...', '⏳ Reading Data...', '⏳ データ読込中...'],
    ['⚡ Proses & Masuk Rekapitulasi', '⚡ Process & Add to Recapitulation', '⚡ 処理して集計へ追加'],
    ['Ubah kata sandi', 'Change password', 'パスワードを変更'],
    ['Pemulihan dibatalkan.', 'Recovery was canceled.', '復元をキャンセルしました。'],
    ['File cadangan ditolak.', 'The backup file was rejected.', 'バックアップファイルを受け付けられませんでした。'],
    ['Format JSON tidak valid.', 'The JSON format is invalid.', 'JSON形式が無効です。'],
    ['Pengguna lain telah lebih dahulu mengubah data yang sama. Versi cloud terbaru dipertahankan agar tidak tertimpa. Silakan periksa kembali klaim terkait sebelum menyimpan ulang.', 'Another user changed the same data first. The latest cloud version was kept to prevent overwriting. Review the related claims before saving again.', '別のユーザーが同じデータを先に変更しました。上書きを防ぐため最新のクラウド版を保持しています。再保存する前に該当申請を確認してください。'],
    ['...dan lainnya', '...and more', '…ほか'],
    ['⚠ PERINGATAN ⚠', '⚠ WARNING ⚠', '⚠ 警告 ⚠'],
    ['Apakah Anda yakin ingin menghapus seluruh data yang tampil sesuai filter secara permanen?', 'Are you sure you want to permanently delete all data currently shown by the filter?', '現在のフィルターで表示されている全データを完全に削除しますか？'],
    ['Dihapus: 0', 'Deleted: 0', '削除：0'],
    ['Tidak berubah:', 'Unchanged:', '変更なし：'],
    ['Diperbarui:', 'Updated:', '更新：'],
    ['Baru:', 'New:', '新規：'],
    ['Data saat ini yang tidak ada dalam cadangan tetap disimpan:', 'Current data not included in the backup will be retained:', 'バックアップに含まれない現在のデータは保持されます：'],
    ['Data saat ini yang tetap dipertahankan:', 'Current data that will be retained:', '保持される現在のデータ：'],
    ['Posted/Paid/Hold yang dilindungi dan tidak ditimpa:', 'Protected Posted/Paid/Hold records that will not be overwritten:', '保護され上書きされないPosted/Paid/Hold：']
];

const WORKSHEET_P20_TRANSLATION_ROWS = [
    ['Minimal satu baris detail wajib diisi.', 'At least one detail row is required.', '明細を1行以上入力してください。'],
    ['NIK dan nama belum lengkap.', 'NIK and name are incomplete.', 'NIKと氏名が未入力です。'],
    ['Nomor referensi belum diisi.', 'The reference number has not been entered.', '参照番号が未入力です。'],
    ['Tanggal proses/submit tidak valid.', 'The process/submit date is invalid.', '処理日・提出日が無効です。'],
    ['Total header harus lebih dari 0.', 'The header total must be greater than 0.', 'ヘッダー合計は0より大きい必要があります。'],
    ['Mata uang belum valid.', 'The currency is invalid.', '通貨が無効です。'],
    ['Minimal satu line item wajib tersedia.', 'At least one line item is required.', '明細行を1件以上入力してください。'],
    ['Total header belum sama dengan total line item.', 'The header total does not match the line item total.', 'ヘッダー合計と明細行合計が一致していません。'],
    ['Data uji belum valid. Tanggal selesai harus sama atau setelah tanggal submit.', 'The test data is invalid. The completion date must be on or after the submit date.', 'テストデータが無効です。完了日は提出日以降にしてください。'],
    ['Tidak ada data historis.', 'There is no historical data.', '履歴データがありません。'],
    ['🎉 Kosong! Tidak ada dokumen yang menunggu approval.', '🎉 Clear! There are no documents waiting for approval.', '🎉 対象なし！承認待ちの書類はありません。'],
    ['Tidak ada histori data revisi/confirm yang aktif.', 'There is no active revision/confirmation history.', '有効な修正・確認履歴はありません。'],
    ['Belum ada data yang diarsipkan.', 'There is no archived data yet.', 'アーカイブ済みデータはまだありません。'],
    ['Nonaktifkan claim dan keluarkan dari statistik', 'Deactivate the claim and exclude it from statistics', '申請を無効化し統計から除外'],
    ['Ubah status klaim', 'Change claim status', '申請ステータスを変更'],
    ['Alasan Hold', 'Hold Reason', 'Hold理由'],
    ['Alasan Pengembalian ke Accounting', 'Reason for Return to Accounting', 'Accounting返却理由'],
    ['Alasan Pembatalan Paid', 'Paid Cancellation Reason', 'Paid取消理由'],
    ['Catatan Pelepasan Hold', 'Hold Release Note', 'Hold解除メモ'],
    ['Pembatalan Paid menghapus pembayaran aktif, tetapi referensi dan alasannya tetap tersimpan dalam linimasa.', 'Canceling Paid removes the active payment, but its reference and reason remain in the timeline.', 'Paid取消では有効な支払情報を解除しますが、参照番号と理由はタイムラインに保持されます。'],
    ['Pembatalan Paid hanya dapat dilakukan oleh Finance yang mencatat pembayaran ini atau oleh Admin.', 'Only the Finance user who recorded this payment, or an Admin, can cancel the Paid status.', 'Paidの取消は、この支払を登録したFinance担当者または管理者のみが行えます。'],
    ['Finance hanya dapat mengubah status pada klaim yang sudah berstatus Posted, Hold, atau Paid.', 'Finance can only change the status of claims that are already Posted, Hold, or Paid.', 'FinanceはPosted・Hold・Paidの申請のみステータスを変更できます。'],
    ['Klaim yang sudah final hanya dapat diubah melalui alur Finance.', 'A finalized claim can only be changed through the Finance workflow.', '確定済みの申請はFinanceの手続きでのみ変更できます。'],
    ['Tidak ada perubahan status yang tersedia untuk peran Anda pada klaim ini.', 'No status change is available to your role for this claim.', 'この申請に対してあなたの権限で実行できるステータス変更はありません。'],
    ['Peran Anda hanya dapat melihat status dan linimasa klaim ini.', 'Your role can only view the status and timeline of this claim.', 'あなたの権限ではこの申請のステータスとタイムラインの閲覧のみ可能です。'],
    ['Revisi - Cleared', 'Revision - Cleared', '修正 - 解消'],
    ['Belum terdapat cadangan lokal.', 'There is no local backup yet.', 'ローカルバックアップはまだありません。'],
    ['Cadangan lokal gagal dibaca.', 'The local backup could not be read.', 'ローカルバックアップを読み込めませんでした。'],
    ['Perangkat dan cloud sudah sinkron.', 'The device and cloud are synchronized.', '端末とクラウドは同期済みです。'],
    ['File lama/tanpa hash; validasi struktur tetap dijalankan.', 'Legacy/no-hash file; structural validation will still run.', '旧形式またはハッシュなしのファイルです。構造検証は続行します。'],
    ['Browser tidak mendukung pemeriksaan hash.', 'The browser does not support hash verification.', 'このブラウザはハッシュ検証に対応していません。'],
    ['Hash SHA-256 cocok.', 'SHA-256 hash matches.', 'SHA-256ハッシュが一致しました。'],
    ['Hash SHA-256 tidak cocok; file mungkin berubah/rusak.', 'SHA-256 hash does not match; the file may have changed or be corrupted.', 'SHA-256ハッシュが一致しません。ファイルが変更または破損している可能性があります。'],
    ['File format lama diterima dan akan dinormalisasi ke schema 2.', 'The legacy file format was accepted and will be normalized to schema 2.', '旧形式ファイルを受け付け、schema 2へ正規化します。'],
    ['Apakah Anda ingin melakukan pemulihan dengan mode gabung/perbarui tanpa penghapusan?', 'Do you want to restore using merge/update mode without deleting data?', '削除を行わず、結合・更新モードで復元しますか？'],
    ['Jumlah Claim', 'Claim Count', '申請件数'],
    ['Periode Tgl Submit', 'Submit Date Period', '提出日期間'],
    ['Top Revisi', 'Top Revisions', '修正上位'],
    ['Tidak ada data', 'No data', 'データなし'],
    ['Biarkan kosong untuk Live Time (Saat Ini)', 'Leave blank to use Live Time (Now)', '空欄の場合は現在時刻を使用'],
    ['Periode Sama Tahun Lalu (SPLY)', 'Same Period Last Year (SPLY)', '前年同期（SPLY）'],
    ['Ringkasan Eksekutif', 'Executive Summary', 'エグゼクティブサマリー'],
    ['Insight SLA dan revisi', 'SLA and revision insights', 'SLA・修正インサイト'],
    ['Pilih Manual...', 'Select Manually...', '手動で選択...'],
    ['Detail kosong (Sudah Posted)', 'No details (Already Posted)', '明細なし（Posted済み）'],
    ['Status klaim', 'Claim status', '申請ステータス'],
    ['Tulis catatan...', 'Write a note...', 'メモを入力...'],
    ['Masukkan deskripsi', 'Enter description', '説明を入力'],
    ['Hapus Rincian Nota', 'Delete Receipt Details', '領収書明細を削除'],
    ['No Pengajuan', 'Claim No.', '申請番号'],
    ['Menunggu Pencarian', 'Waiting for Search', '検索待ち'],
    ['Silakan pilih periode tanggal submit dan ketik kata kunci NIK/Nama, lalu tekan tombol Cari Data.', 'Select a submit-date period and enter an NIK/name keyword, then press Search Data.', '提出日の期間を選び、NIK・氏名のキーワードを入力して「データ検索」を押してください。'],
    ['Cadangan tidak valid:', 'Invalid backup:', 'バックアップが無効です：'],
    ['Rincian belum dapat difinalisasi:', 'Details cannot be finalized yet:', '明細をまだFinalにできません：']
];

const WORKSHEET_P22_TRANSLATION_ROWS = [
    ['Aksi', 'Actions', '操作'],
    ['Kembalikan ke daftar aktif', 'Return to the active list', 'アクティブ一覧に戻す'],
    ['Arsipkan', 'Archive', 'アーカイブ'],
    ['PIC Proses', 'Process PIC', '処理担当者'],
    ['Cache lokal aktif; Firestore hanya membaca data baru atau yang berubah.', 'Local cache is active; Firestore only reads new or changed data.', 'ローカルキャッシュが有効です。Firestoreは新規・変更分のみ読み取ります。'],
    ['Bootstrap cache selesai; listener penuh langsung diganti menjadi sync bertahap.', 'Cache bootstrap finished; the full listener switches straight to incremental sync.', 'キャッシュの初期化が完了し、全件リスナーは増分同期へ切り替わりました。'],
    ['LEMBAR KERJA', 'WORKSHEET', 'ワークシート'],
    ['Masukkan Data', 'Enter Data', 'データ入力'],
    ['Buat pengajuan jurnal lengkap dengan rincian baris transaksi dan penyesuaian.', 'Create a full journal claim with transaction lines and adjustments.', '取引明細と調整を含む仕訳申請を作成します。'],
    ['Input Cepat', 'Quick Entry', 'クイック入力'],
    ['Rekam pengajuan ringkas tanpa rincian baris, cocok untuk klaim sederhana.', 'Record a compact claim without line details, suited to simple claims.', '明細なしで簡易に申請を登録します。単純な申請向けです。'],
    ['Detail Pengajuan', 'Claim Details', '申請明細'],
    ['Lengkapi rincian nota untuk pengajuan yang sudah tercatat di Rekapitulasi.', 'Complete the receipt details for a claim already recorded in the recap.', '集計に登録済みの申請に領収書明細を追加します。'],
    ['Catatan Detail', 'Detail Notes', '明細メモ'],
    ['Rekapitulasi pengajuan yang rincian detailnya sudah dibuat, baik Draft maupun Final.', 'Claims whose details have been created, both Draft and Final.', '明細が作成済みの申請（下書き・確定の両方）。'],
    ['Arsip Rincian Nota', 'Receipt Detail Archive', '領収書明細アーカイブ'],
    ['Buka Detail untuk meninjau atau melengkapi rincian', 'Open Detail to review or complete the entries', '「詳細を開く」で内容を確認・補完できます'],
    ['Filter Catatan Detail', 'Detail Notes filter', '明細メモフィルター'],
    ['Buka modul In Process', 'Open the In Process module', 'In Processモジュールを開く'],
    ['Buka modul Pemantauan Revisi', 'Open the Revision Monitoring module', '修正監視モジュールを開く'],
    ['Buka modul Menunggu Persetujuan', 'Open the Waiting Approval module', '承認待ちモジュールを開く'],
    ['Buka modul Riwayat Klaim', 'Open the Claim History module', '申請履歴モジュールを開く'],
    ['Akun Anda hanya memiliki akses baca pada layar ini. Perubahan status pembayaran tetap dapat dilakukan melalui tombol Tindakan Finance pada daftar claim.', 'Your account has read-only access on this screen. Payment status changes are still available through the Finance Action button in the claim lists.', 'このアカウントはこの画面では閲覧のみです。支払いステータスの変更は申請一覧の「Finance操作」ボタンから引き続き行えます。'],
    ['CLAIM DATA', 'CLAIM DATA', '申請データ'],
    ['Seluruh claim Accounting dan Finance dalam satu tabel, lengkap dengan SLA dan status terkini.', 'Every Accounting and Finance claim in one table, with SLA and current status.', 'AccountingとFinanceの全申請を、SLAと最新ステータス付きで一覧表示します。'],
    ['Periode Tgl Proses', 'Process Date Period', '処理日の期間'],
    ['Periode Tgl RTP', 'RTP Date Period', 'RTP日の期間'],
    ['Periode Tgl Cancel', 'Cancel Date Period', '取消日の期間'],
    ['Atur rentang data yang ditampilkan', 'Set the range of data shown', '表示するデータの範囲を設定'],
    ['Daftar Rekapitulasi', 'Recap List', '集計一覧'],
    ['Pilih baris untuk tindakan massal', 'Select rows for bulk actions', '一括操作する行を選択'],
    ['Daftar Claim Aktif', 'Active Claim List', 'アクティブ申請一覧'],
    ['Claim berstatus In Process dan Returned by Finance', 'Claims with status In Process and Returned by Finance', 'In ProcessとReturned by Financeの申請'],
    ['Daftar Claim Dibatalkan', 'Canceled Claim List', '取消申請一覧'],
    ['Beserta alasan dan PIC yang membatalkan', 'Including the reason and who canceled it', '取消理由と担当者を含む'],
    ['Antrean Persetujuan', 'Approval Queue', '承認待ちキュー'],
    ['Pilih baris untuk diproses secara massal', 'Select rows to process in bulk', '一括処理する行を選択'],
    ['Daftar Riwayat', 'History List', '履歴一覧'],
    ['Jejak RTP, pembayaran, dan status akhir claim', 'RTP, payment, and final claim status trail', 'RTP・支払い・最終ステータスの記録'],
    ['Cari Revisi', 'Search Revisions', '修正を検索'],
    ['No. pengajuan, NIK, nama, atau tipe', 'Claim no., NIK, name, or type', '申請番号・NIK・氏名・種別'],
    ['Tindakan Massal', 'Bulk Actions', '一括操作'],
    ['Berlaku untuk baris yang dicentang pada tabel di bawah', 'Applies to the rows ticked in the table below', '下の表でチェックした行に適用されます'],
    ['Pemantauan Aktif', 'Active Monitoring', 'アクティブ監視'],
    ['Claim yang masih berstatus Revisi', 'Claims still in Revisi status', 'まだRevisiステータスの申請'],
    ['Arsip Monitoring', 'Monitoring Archive', '監視アーカイブ'],
    ['Revisi yang sudah selesai atau berstatus final', 'Revisions that are done or in a final status', '完了済みまたは最終ステータスの修正'],
    ['Daftar', 'List', '一覧'],
    ['Folder', 'Folder', 'フォルダ'],
    ['☑️ Ubah ke Posted', '☑️ Change to Posted', '☑️ Postedに変更'],
    ['Ubah ke Posted', 'Change to Posted', 'Postedに変更'],
    ['🛑 Hapus Tampilan', '🛑 Delete This View', '🛑 表示中を削除'],
    ['Hapus Tampilan', 'Delete This View', '表示中を削除'],
    ['↩ Batalkan Posted', '↩ Reverse Posted', '↩ Postedを取消'],
    ['Batalkan Posted', 'Reverse Posted', 'Postedを取消'],
    ['Filter In Process', 'In Process filter', 'In Processフィルター'],
    ['Filter Canceled Claim', 'Canceled Claim filter', '取消申請フィルター'],
    ['Filter Waiting Approval', 'Waiting Approval filter', '承認待ちフィルター'],
    ['Filter Riwayat Klaim', 'Claim History filter', '申請履歴フィルター'],
    ['Filter Rekapitulasi', 'Recapitulation filter', '集計フィルター'],
    ['Filter Pemantauan Revisi', 'Revision Monitoring filter', '修正監視フィルター'],
    ['Mode tampilan Rekapitulasi', 'Recapitulation view mode', '集計の表示モード'],
    ['Mode tampilan Riwayat Klaim', 'Claim History view mode', '申請履歴の表示モード'],
    ['Mode tampilan Revisi', 'Revision view mode', '修正の表示モード']
];

const WORKSHEET_P21_TRANSLATION_ROWS = [
    ['Geser tabel ke samping untuk melihat kolom MTD dan tahun lalu.', 'Scroll the table sideways to see the MTD and last-year columns.', '表を横にスクロールするとMTDと前年の列が表示されます。'],
    ['Periode Berjalan', 'Current Period', '当期'],
    ['Tahun Lalu', 'Last Year', '前年'],
    ['Month to Date', 'Month to Date', '月初来'],
    ['Login & Akun', 'Login & Account', 'ログインとアカウント'],
    ['Navigasi & Menu', 'Navigation & Menu', 'ナビゲーションとメニュー'],
    ['Klaim & Workflow', 'Claims & Workflow', '申請とワークフロー'],
    ['Tabel & Filter', 'Tables & Filters', '表とフィルター'],
    ['Notifikasi & Pesan', 'Notifications & Messages', '通知とメッセージ'],
    ['Master Data & Sistem', 'Master Data & System', 'マスタデータとシステム'],
    ['Statistik & Laporan', 'Statistics & Reports', '統計とレポート'],
    ['Teks Lainnya', 'Other Text', 'その他のテキスト'],
    ['Kelompok teks antarmuka', 'Interface text groups', 'UIテキストのグループ'],
    ['Jumlah teks per halaman', 'Texts per page', '1ページあたりのテキスト数'],
    ['CLAIM LOOKUP', 'CLAIM LOOKUP', '申請検索'],
    ['Pencarian Klaim', 'Claim Search', '申請検索'],
    ['Telusuri seluruh klaim aktif, arsip, dan riwayat berstatus Posted dalam satu pencarian.', 'Search every active, archived, and Posted claim in one place.', 'アクティブ・アーカイブ・Posted済みの全申請をまとめて検索します。'],
    ['Periode Tanggal Submit', 'Submit Date Period', '提出日の期間'],
    ['Tentukan rentang waktu yang ditelusuri', 'Set the range to search', '検索する期間を設定'],
    ['Kata Kunci', 'Keyword', 'キーワード'],
    ['NIK, nama karyawan, atau nomor dokumen', 'NIK, employee name, or document number', 'NIK・従業員名・書類番号'],
    ['Hasil Pencarian', 'Search Results', '検索結果'],
    ['Formulir pencarian klaim', 'Claim search form', '申請検索フォーム'],
    ['Hasil pencarian klaim', 'Claim search results', '申請検索結果'],
    ['Preset periode Pencarian Klaim', 'Claim Search period preset', '申請検索の期間プリセット'],
    ['Tampilkan password', 'Show password', 'パスワードを表示'],
    ['Sembunyikan password', 'Hide password', 'パスワードを非表示'],
    ['Akun yang sedang login', 'Signed-in account', 'ログイン中のアカウント'],
    ['Kekuatan password akan tampil di sini.', 'Password strength will appear here.', 'パスワード強度がここに表示されます。'],
    ['Terlalu pendek — minimal 8 karakter.', 'Too short — at least 8 characters.', '短すぎます — 8文字以上にしてください。'],
    ['Lemah — tambahkan huruf besar, angka, atau simbol.', 'Weak — add uppercase letters, numbers, or symbols.', '弱い — 大文字・数字・記号を追加してください。'],
    ['Cukup — masih bisa diperkuat.', 'Fair — it can still be stronger.', '普通 — さらに強化できます。'],
    ['Kuat.', 'Strong.', '強い。'],
    ['Sangat kuat.', 'Very strong.', '非常に強い。'],
    ['Minimal 8 karakter', 'At least 8 characters', '8文字以上'],
    ['Berbeda dari password saat ini', 'Different from the current password', '現在のパスワードと異なる'],
    ['Konfirmasi sama dengan password baru', 'Confirmation matches the new password', '確認用が新しいパスワードと一致'],
    ['ACCOUNT SECURITY', 'ACCOUNT SECURITY', 'アカウントセキュリティ'],
    ['Masukkan password saat ini, lalu password baru. Perubahan langsung berlaku pada Firebase Authentication untuk akun yang sedang login.', 'Enter your current password, then the new one. The change applies immediately in Firebase Authentication for the signed-in account.', '現在のパスワードと新しいパスワードを入力してください。変更はログイン中のアカウントのFirebase Authenticationに即時反映されます。'],
    // Teks yang sebelumnya belum tersentuh: placeholder, title/tooltip, dan
    // label layar Executive, Master Kalender, Master User, dan Ganti Password.
    ['Masukkan GL', 'Enter GL', 'GLを入力'],
    ['Catatan penyesuaian', 'Adjustment note', '調整メモ'],
    ['Tarik ke bawah untuk menyalin sel', 'Drag down to copy the cell', '下へドラッグしてセルをコピー'],
    ['Tambahkan catatan', 'Add a note', 'メモを追加'],
    ['Buka Rincian Nota', 'Open Receipt Details', '領収書明細を開く'],
    ['Final SLA (Kerja)', 'Final SLA (working days)', '最終SLA（営業日）'],
    ['Buat Rincian Nota', 'Create Receipt Details', '領収書明細を作成'],
    ['Lihat Rincian Nota', 'View Receipt Details', '領収書明細を表示'],
    ['Lihat data', 'View data', 'データを表示'],
    ['Ubah data', 'Edit data', 'データを編集'],
    ['Detail kosong (Sudah Posted)', 'No details (already Posted)', '明細なし（Posted済み）'],
    ['Tidak ada data rekapitulasi.', 'No recap data.', '集計データがありません。'],
    ['Tidak ada data rekapitulasi pada periode ini.', 'No recap data for this period.', 'この期間の集計データはありません。'],
    ['Bulan/Tahun Proses', 'Process Month/Year', '処理年月'],
    ['Tanpa Tanggal Proses', 'No Process Date', '処理日なし'],
    ['Item', 'Items', '件'],
    ['Disesuaikan', 'Adjusted', '調整済み'],
    ['Periode Analisis Saat Ini (CP)', 'Current Analysis Period (CP)', '当期分析期間（CP）'],
    ['vs periode sebelumnya', 'vs previous period', '前期比'],
    ['Tepat Waktu (CP)', 'On Time (CP)', '期限内（CP）'],
    ['CP, PP, MTD, PMTD, dan periode sama tahun lalu', 'CP, PP, MTD, PMTD, and the same period last year', 'CP・PP・MTD・PMTD・前年同期'],
    ['Perbandingan indikator utama antara CP dan PP', 'Key indicator comparison between CP and PP', 'CPとPPの主要指標比較'],
    ['Mulai H+1; hijau sampai 3 hari; kuning sampai 7 hari; merah mulai 8 hari; target perusahaan 90%.', 'Starts at D+1; green up to 3 days; yellow up to 7 days; red from 8 days; company target 90%.', 'D+1から起算。3日までは緑、7日までは黄、8日以降は赤。全社目標は90%。'],
    ['Contoh: Libur nasional / cuti bersama', 'Example: public holiday / collective leave', '例：祝日・一斉休暇'],
    ['Hapus tanggal', 'Remove date', '日付を削除'],
    ['Akses & Peran', 'Access & Roles', 'アクセスと権限'],
    ['♻️ Pulihkan dan Gabungkan', '♻️ Restore and Merge', '♻️ 復元してマージ'],
    ['Pulihkan dan Gabungkan', 'Restore and Merge', '復元してマージ'],
    ['Password Saat Ini', 'Current Password', '現在のパスワード'],
    ['Password Baru', 'New Password', '新しいパスワード'],
    ['Konfirmasi Password Baru', 'Confirm New Password', '新しいパスワード（確認）'],
    ['Password saat ini', 'Current password', '現在のパスワード'],
    ['Password baru', 'New password', '新しいパスワード'],
    ['Ulangi password baru', 'Repeat the new password', '新しいパスワードを再入力'],
    ['Halaman', 'Page', 'ページ'],
    ['dari', 'of', '/'],
    ['Data', 'records', '件'],
    ['Batas hijau harus bilangan bulat 0–99.', 'The green threshold must be an integer between 0 and 99.', '緑のしきい値は0〜99の整数で入力してください。'],
    ['NIK tersebut telah tersedia.', 'That NIK already exists.', 'そのNIKは既に登録されています。'],
    ['Seluruh filter telah dibersihkan.', 'All filters have been cleared.', 'すべてのフィルターを解除しました。'],
    // Dipecah per baris karena translateUiText menerjemahkan tiap baris terpisah.
    ['⚠️ Apakah Anda yakin ingin membatalkan seluruh penyesuaian sekaligus?', '⚠️ Are you sure you want to reverse all adjustments at once?', '⚠️ すべての調整を一括で取り消しますか？'],
    ['Sistem akan membatalkannya satu per satu mulai dari transaksi terakhir.', 'The system will reverse them one by one starting from the latest transaction.', '最新の取引から1件ずつ取り消します。']
];

const WORKSHEET_P26_TRANSLATION_ROWS = [
    ['Muat Pengajuan', 'Load Claim', '申請を読み込む'],
    ['Muat pengajuan', 'Load claim', '申請の読み込み'],
    ['Masukkan nomor pengajuan untuk menarik data header dan rincian notanya.', 'Enter a claim number to pull its header data and receipt details.', '申請番号を入力すると、ヘッダー情報と領収書明細を読み込みます。'],
    ['Cari nomor pengajuan', 'Search a claim number', '申請番号を検索'],
    ['Ringkasan Pengajuan', 'Claim Summary', '申請サマリー'],
    ['Ringkasan pengajuan', 'Claim summary', '申請サマリー'],
    ['Data header diambil dari Rekapitulasi dan tidak dapat diubah dari layar ini.', 'Header data comes from the Recap and cannot be edited on this screen.', 'ヘッダー情報は集計から取得され、この画面では編集できません。'],
    ['Rincian nota', 'Receipt details', '領収書明細'],
    ['Isi setiap baris transaksi hingga Amount Klaim seimbang dengan total header.', 'Fill in every transaction line until the Claim Amount balances with the header total.', '請求金額がヘッダー合計と一致するまで各取引明細を入力してください。'],
    ['Tabel di bawah diprogram seperti spreadsheet: gunakan Tab dan Enter untuk berpindah antar sel.', 'The table below behaves like a spreadsheet: use Tab and Enter to move between cells.', '下の表は表計算ソフトのように操作できます。TabとEnterでセルを移動します。'],
    ['Bersihkan pencarian', 'Clear search', '検索をクリア'],
    ['Cari data pada filter kolom', 'Search values in the column filter', '列フィルターの値を検索'],
    ['Kata kunci pencarian klaim', 'Claim search keyword', '申請検索キーワード'],
    ['Cari teks antarmuka', 'Search interface text', 'インターフェース文言を検索'],
    ['Cari log aktivitas', 'Search the activity log', 'アクティビティログを検索'],
    ['Cari tipe atau nama GL', 'Search a type or GL name', '種別またはGL名を検索'],
    ['Cari NIK atau nama karyawan', 'Search an employee ID or name', '社員番号または氏名を検索'],
    ['PENGATURAN', 'SETTINGS', '設定'],
    ['Kelola pasangan tipe pengajuan dan nama GL Account yang dipakai seluruh modul lembar kerja.', 'Manage the claim type and GL Account pairs used by every worksheet module.', 'すべてのワークシートで使用する申請種別とGLアカウントの組み合わせを管理します。'],
    ['Pencarian Data Induk', 'Master Data Search', 'マスタデータ検索'],
    ['Pencarian GL Account', 'GL Account search', 'GLアカウント検索'],
    ['Pencarian karyawan', 'Employee search', '社員検索'],
    ['Saring berdasarkan tipe pengajuan atau nama GL', 'Filter by claim type or GL name', '申請種別またはGL名で絞り込み'],
    ['Saring berdasarkan NIK atau nama karyawan', 'Filter by employee ID or name', '社員番号または氏名で絞り込み'],
    ['Tambah GL Account', 'Add GL Account', 'GLアカウントを追加'],
    ['Tipe pengajuan dapat diketik manual apabila belum tersedia dalam daftar', 'A claim type can be typed manually when it is not yet on the list', '一覧にない申請種別は手入力できます'],
    ['Impor Excel menambahkan data baru tanpa menghapus daftar yang sudah ada.', 'Excel import adds new records without deleting the existing list.', 'Excelインポートは既存の一覧を削除せずに新規データを追加します。'],
    ['Daftar GL Account', 'GL Account List', 'GLアカウント一覧'],
    ['Klik Ubah untuk menyunting satu baris', 'Click Edit to modify a single row', '「編集」をクリックすると1行ずつ修正できます'],
    ['Sumber NIK, nama, entitas, dan cost center yang mengisi otomatis seluruh formulir pengajuan.', 'The source of employee ID, name, entity, and cost center that auto-fills every claim form.', 'すべての申請フォームに自動入力される社員番号・氏名・法人・コストセンターの基となるデータです。'],
    ['Tambah Karyawan', 'Add Employee', '社員を追加'],
    ['Tambah karyawan', 'Add employee', '社員の追加'],
    ['NIK wajib unik; kolom lain melengkapi data pengisian otomatis', 'The employee ID must be unique; the other fields complete the auto-fill data', '社員番号は重複不可です。他の項目は自動入力用の情報を補完します'],
    ['Impor Excel memperbarui data dengan NIK yang sama dan menambahkan NIK baru.', 'Excel import updates records with a matching employee ID and adds new ones.', 'Excelインポートは同じ社員番号のデータを更新し、新しい社員番号を追加します。'],
    ['Daftar Karyawan', 'Employee List', '社員一覧'],
    ['Daftar karyawan', 'Employee list', '社員一覧'],
    ['Gunakan ikon filter pada judul kolom untuk penyaringan lanjutan', 'Use the filter icon in the column headers for advanced filtering', '列見出しのフィルターアイコンで詳細な絞り込みができます'],
    ['Cadangan lokal dibuat berkala ketika browser tidak aktif dan menyimpan tujuh tanggal terakhir. Kata sandi dan peran pengguna tidak pernah disertakan.', 'Local backups run periodically while the browser is idle and keep the last seven dates. Passwords and user roles are never included.', 'ローカルバックアップはブラウザが待機中に定期実行され、直近7日分を保持します。パスワードとユーザー権限は含まれません。'],
    ['Cadangan Manual Skema 2', 'Manual Backup Scheme 2', '手動バックアップ（スキーマ2）'],
    ['Log Rotasi Otomatis', 'Automatic Rotation Log', '自動ローテーションログ'],
    ['Log rotasi cadangan', 'Backup rotation log', 'バックアップのローテーションログ'],
    ['Maksimal tujuh tanggal terakhir yang tersimpan', 'Only the last seven dates are kept', '保持されるのは直近7日分のみです']
];

const WORKSHEET_P28_TRANSLATION_ROWS = [
    ['Dibatalkan', 'Canceled', '取消済み'],
    ['Tgl Pembatalan', 'Cancellation Date', '取消日'],
    ['PIC Pembatalan', 'Cancellation PIC', '取消担当者'],
    ['Detail Catatan Pembatalan', 'Cancellation Note Details', '取消メモ詳細'],
    ['Tidak ada klaim aktif pada filter ini.', 'No active claims match this filter.', 'このフィルターに一致する有効な申請はありません。'],
    ['Tidak ada klaim yang dibatalkan pada filter ini.', 'No canceled claims match this filter.', 'このフィルターに一致する取消済み申請はありません。'],
    ['Tidak ada klaim yang menunggu proses pembayaran pada periode ini.', 'No claims are waiting for payment in this period.', 'この期間に支払待ちの申請はありません。'],
    ['Tidak ada klaim yang sedang ditahan.', 'No claims are currently on Hold.', '現在Hold中の申請はありません。'],
    ['Tidak ada klaim yang dikembalikan ke Accounting pada periode ini.', 'No claims were returned to Accounting in this period.', 'この期間にAccountingへ返却された申請はありません。'],
    ['Klaim nonaktif dan tidak dihitung dalam SLA/statistik', 'Inactive claim; excluded from SLA/statistics', '無効な申請。SLA・統計の対象外です。'],
    ['Nonaktif', 'Inactive', '無効'],
    ['Batalkan klaim dan keluarkan dari statistik', 'Cancel the claim and exclude it from statistics', '申請を取消し、統計から除外します'],
    ['Belum ada hardcopy yang tercatat untuk klaim ini.', 'No hardcopy has been recorded for this claim.', 'この申請にはハードコピーがまだ記録されていません。'],
    ['Alasan pembatalan wajib diisi.', 'A cancellation reason is required.', '取消理由を入力してください。'],
    ['Alasan aktivasi kembali wajib diisi.', 'A reactivation reason is required.', '再有効化理由を入力してください。'],
    ['Bulk Payment', 'Bulk Payment', '一括支払'],
    ['Bulk Payment hanya dapat dilakukan oleh Finance atau Admin.', 'Bulk Payment can only be performed by Finance or Admin.', '一括支払はFinanceまたはAdminのみ実行できます。'],
    ['Pilih minimal satu klaim Ready to Payment.', 'Select at least one Ready to Payment claim.', 'Ready to Paymentの申請を1件以上選択してください。'],
    ['Referensi Pembayaran (Opsional)', 'Payment Reference (Optional)', '支払参照番号（任意）'],
    ['Tanggal/Jam Pembayaran (Opsional)', 'Payment Date/Time (Optional)', '支払日時（任意）'],
    ['Kosong = waktu saat ini', 'Blank = current time', '空欄 = 現在時刻'],
    ['Referensi pembayaran maksimal 120 karakter.', 'Payment reference is limited to 120 characters.', '支払参照番号は120文字以内です。'],
    ['Tanggal atau jam Bulk Payment tidak valid.', 'Bulk Payment date or time is invalid.', '一括支払の日時が無効です。'],
    ['Bulk Payment gagal disimpan. Tidak ada pilihan yang ditandai Paid.', 'Bulk Payment could not be saved. No selected claims were marked Paid.', '一括支払を保存できませんでした。選択した申請はPaidになっていません。'],
    ['Bawaannya seluruh riwayat pembayaran', 'Defaults to the full payment history', '既定では支払履歴を全期間表示します。'],
    ['Seluruh klaim berstatus Paid', 'All claims with Paid status', 'Paidステータスの全申請'],
    ['Tidak ada klaim berstatus Paid pada filter ini.', 'No Paid claims match this filter.', 'このフィルターに一致するPaid申請はありません。'],
    ['Tidak ada klaim yang menunggu proses pembayaran pada filter ini.', 'No claims waiting for payment match this filter.', 'このフィルターに一致する支払待ち申請はありません。'],
    ['Tidak ada klaim yang dikembalikan ke Accounting pada filter ini.', 'No claims returned to Accounting match this filter.', 'このフィルターに一致するAccounting返却申請はありません。']
];

const WORKSHEET_P27_TRANSLATION_ROWS = [
    ['Tahun Posted', 'Posted Year', '計上年'],
    ['Tahun Proses', 'Process Year', '処理年'],
    ['data', 'records', '件'],
    ['Pilih bulan', 'Select month', '月を選択'],
    ['Pilih tahun', 'Select year', '年を選択'],
    ['Worksheet Klaim', 'Claim Worksheet', '申請ワークシート']
];

const WORKSHEET_TRANSLATIONS = Object.freeze([...WORKSHEET_TRANSLATION_ROWS, ...WORKSHEET_ADDITIONAL_TRANSLATION_ROWS, ...WORKSHEET_P18_TRANSLATION_ROWS, ...WORKSHEET_P19_TRANSLATION_ROWS, ...WORKSHEET_P20_TRANSLATION_ROWS, ...WORKSHEET_P21_TRANSLATION_ROWS, ...WORKSHEET_P22_TRANSLATION_ROWS, ...WORKSHEET_P26_TRANSLATION_ROWS, ...WORKSHEET_P27_TRANSLATION_ROWS, ...WORKSHEET_P28_TRANSLATION_ROWS].reduce((catalog, row) => {
    catalog[row[0]] = { en: row[1], ja: row[2] };
    return catalog;
}, {}));

const WORKSHEET_DYNAMIC_TRANSLATIONS = [
    { re: /^Status diubah menjadi (.+) dan tersimpan di perangkat\. Pengiriman ke cloud sedang berjalan\.$/i, en: m => `Status changed to ${m[1]} and saved on this device. Sending to the cloud is in progress.`, ja: m => `ステータスを${m[1]}に変更し、端末に保存しました。クラウドへの送信を実行中です。` },
    { re: /^Claim (.+) ditolak cloud \((.+) \u2192 (.+)\): (.+)$/i, en: m => `Claim ${m[1]} was rejected by the cloud (${m[2]} \u2192 ${m[3]}): ${m[4]}`, ja: m => `申請 ${m[1]} はクラウドに拒否されました（${m[2]} \u2192 ${m[3]}）：${m[4]}` },
    { re: /^Apakah Anda ingin memulihkan cadangan (.+) dengan mode aman\?$/i, en: m => `Do you want to restore backup ${m[1]} using safe mode?`, ja: m => `バックアップ ${m[1]} を安全モードで復元しますか？` },
    { re: /^(?:Claim|Klaim) urutan (\d+): ID kosong\/tidak valid\.$/i, en: m => `Claim ${m[1]}: ID is empty/invalid.`, ja: m => `申請${m[1]}：IDが空または無効です。` },
    { re: /^(?:Claim|Klaim) ID (.+) muncul lebih dari sekali\.$/i, en: m => `Claim ID ${m[1]} appears more than once.`, ja: m => `申請ID ${m[1]} が重複しています。` },
    { re: /^(?:Claim|Klaim) (.+): totalHeader harus angka nol atau positif\.$/i, en: m => `Claim ${m[1]}: totalHeader must be zero or positive.`, ja: m => `申請 ${m[1]}：totalHeaderは0以上である必要があります。` },
    { re: /^(?:Claim|Klaim) (.+): kode mata uang tidak valid\.$/i, en: m => `Claim ${m[1]}: invalid currency code.`, ja: m => `申請 ${m[1]}：通貨コードが無効です。` },
    { re: /^Baris (\d+): deskripsi wajib diisi\.$/i, en: m => `Row ${m[1]}: description is required.`, ja: m => `${m[1]}行目：説明は必須です。` },
    { re: /^Baris (\d+): tanggal transaksi tidak valid\.$/i, en: m => `Row ${m[1]}: transaction date is invalid.`, ja: m => `${m[1]}行目：取引日が無効です。` },
    { re: /^Baris (\d+): Amount Nota harus lebih dari 0\.$/i, en: m => `Row ${m[1]}: Receipt Amount must be greater than 0.`, ja: m => `${m[1]}行目：領収書金額は0より大きい必要があります。` },
    { re: /^Baris (\d+): Amount Claim tidak boleh negatif\.$/i, en: m => `Row ${m[1]}: Claim Amount cannot be negative.`, ja: m => `${m[1]}行目：申請金額を負数にはできません。` },
    { re: /^Total detail efektif (.+) belum sama dengan header (.+)\.$/i, en: m => `Effective detail total ${m[1]} does not match header ${m[2]}.`, ja: m => `有効明細合計 ${m[1]} がヘッダー ${m[2]} と一致していません。` },
    { re: /^(\d+) role legacy berhasil dimigrasikan menjadi Accounting\.$/i, en: m => `${m[1]} legacy roles were migrated to Accounting.`, ja: m => `${m[1]}件の旧権限をAccountingへ移行しました。` },
    { re: /^(\d+) log aktivitas berhasil dibersihkan\.$/i, en: m => `${m[1]} activity logs were cleared.`, ja: m => `${m[1]}件の操作ログを削除しました。` },
    { re: /^(\d+) data berhasil dihapus\.$/i, en: m => `${m[1]} records were deleted.`, ja: m => `${m[1]}件のデータを削除しました。` },
    { re: /^Impor selesai\. (\d+) data baru ditambahkan dan (\d+) data lama dilewati\.$/i, en: m => `Import complete. ${m[1]} new records were added and ${m[2]} existing records were skipped.`, ja: m => `インポート完了。新規${m[1]}件を追加し、既存${m[2]}件をスキップしました。` },
    { re: /^(\d+) data GL berhasil diimpor\.$/i, en: m => `${m[1]} GL records were imported.`, ja: m => `${m[1]}件のGLデータをインポートしました。` },
    { re: /^Peringatan:\s*Terdapat (\d+) data yang memerlukan tindak lanjut lebih dari tiga hari\.$/i, en: m => `Warning: ${m[1]} records require follow-up for more than three days.`, ja: m => `警告：${m[1]}件のデータが3日を超えてフォローアップ待ちです。` },
    { re: /^Pemulihan selesai:\s*(\d+) data baru, (\d+) data dipulihkan, dan tidak ada data yang dihapus\.$/i, en: m => `Recovery complete: ${m[1]} new records, ${m[2]} restored, and no data deleted.`, ja: m => `復元完了：新規${m[1]}件、復元${m[2]}件、削除0件。` },
    { re: /^Gagal memproses\. Seluruh (\d+) data tersebut sudah terdaftar di sistem\.$/i, en: m => `Processing failed. All ${m[1]} records are already registered in the system.`, ja: m => `処理できませんでした。${m[1]}件すべてが既に登録されています。` },
    { re: /^(.+) Sinkronisasi cloud berjalan\.$/i, en: m => `${m[1]} Cloud synchronization is in progress.`, ja: m => `${m[1]} クラウド同期中です。` },
    { re: /^(\d+) data yang dipilih berhasil dihapus\.$/i, en: m => `${m[1]} selected records were deleted.`, ja: m => `選択した${m[1]}件のデータを削除しました。` },
    { re: /^Mode perhitungan SLA berhasil diubah menjadi (.+)\.$/i, en: m => `SLA calculation mode was changed to ${m[1]}.`, ja: m => `SLA計算モードを${m[1]}へ変更しました。` },
    { re: /^(\d+) penyesuaian berhasil dicatat\.$/i, en: m => `${m[1]} adjustments were recorded.`, ja: m => `${m[1]}件の調整を記録しました。` },
    { re: /^Rincian berhasil disimpan sebagai (.+)\.$/i, en: m => `Details were saved as ${m[1]}.`, ja: m => `明細を${m[1]}として保存しました。` },
    { re: /^Data (.+) belum dapat diselesaikan:$/i, en: m => `Data ${m[1]} cannot be completed yet:`, ja: m => `データ ${m[1]} はまだ完了できません：` },
    { re: /^Konflik terdeteksi pada (\d+) klaim\.$/i, en: m => `A conflict was detected in ${m[1]} claims.`, ja: m => `${m[1]}件の申請で競合を検出しました。` },
    { re: /^(\d+) data belum dapat diselesaikan\. Perbaiki dahulu:$/i, en: m => `${m[1]} records cannot be completed yet. Fix them first:`, ja: m => `${m[1]}件のデータはまだ完了できません。先に修正してください：` },
    { re: /^Apakah Anda yakin ingin membatalkan (\d+) penyesuaian yang dipilih\?$/i, en: m => `Are you sure you want to reverse ${m[1]} selected adjustments?`, ja: m => `選択した${m[1]}件の調整を取り消しますか？` },
    { re: /^Apakah Anda yakin ingin membatalkan status Posted dan mengembalikan data ini ke '(.+)'\?$/i, en: m => `Are you sure you want to undo Posted and return this data to '${m[1]}'?`, ja: m => `Postedを取り消してこのデータを「${m[1]}」へ戻しますか？` },
    { re: /^Apakah Anda yakin ingin membatalkan status Posted pada (\d+) data dan mengembalikannya ke In Process\?$/i, en: m => `Are you sure you want to undo Posted for ${m[1]} records and return them to In Process?`, ja: m => `${m[1]}件のPostedを取り消して処理中へ戻しますか？` },
    { re: /^Apakah Anda yakin ingin menghapus (\d+) data yang dipilih secara permanen\?$/i, en: m => `Are you sure you want to permanently delete ${m[1]} selected records?`, ja: m => `選択した${m[1]}件のデータを完全に削除しますか？` },
    { re: /^Apakah Anda yakin ingin menghapus (\d+) data revisi\/konfirmasi yang dipilih secara permanen dari database\?$/i, en: m => `Are you sure you want to permanently delete ${m[1]} selected revision/confirmation records from the database?`, ja: m => `選択した修正・確認データ${m[1]}件をデータベースから完全に削除しますか？` },
    { re: /^Sistem menemukan (\d+) perubahan penyesuaian\. Nilai tambahan yang akan diterapkan: (.+)\. Apakah proses dilanjutkan\?$/i, en: m => `The system found ${m[1]} adjustment changes. Additional amount to apply: ${m[2]}. Continue?`, ja: m => `調整変更を${m[1]}件検出しました。適用する追加金額：${m[2]}。続行しますか？` },
    { re: /^Baru:\s*(\d+)$/i, en: m => `New: ${m[1]}`, ja: m => `新規：${m[1]}` },
    { re: /^Diperbarui:\s*(\d+)$/i, en: m => `Updated: ${m[1]}`, ja: m => `更新：${m[1]}` },
    { re: /^Tidak berubah:\s*(\d+)$/i, en: m => `Unchanged: ${m[1]}`, ja: m => `変更なし：${m[1]}` },
    { re: /^Posted\/Paid\/Hold yang dilindungi dan tidak ditimpa:\s*(\d+)$/i, en: m => `Protected Posted/Paid/Hold records not overwritten: ${m[1]}`, ja: m => `保護され上書きされないPosted/Paid/Hold：${m[1]}` },
    { re: /^Data saat ini yang tidak ada dalam cadangan tetap disimpan:\s*(\d+)$/i, en: m => `Current data not in the backup retained: ${m[1]}`, ja: m => `バックアップ外で保持される現在データ：${m[1]}` },
    { re: /^Data saat ini yang tetap dipertahankan:\s*(\d+)$/i, en: m => `Current data retained: ${m[1]}`, ja: m => `保持される現在データ：${m[1]}` },
    { re: /^(\d+) baris siap dibaca$/i, en: m => `${m[1]} rows ready to read`, ja: m => `読み取り可能な行 ${m[1]}件` },
    { re: /^(\d+) teks$/i, en: m => `${m[1]} texts`, ja: m => `${m[1]}件のテキスト` },
    { re: /^Belum Seimbang \(Selisih:\s*(.+)$/i, en: m => `Not Balanced (Difference: ${m[1]}`, ja: m => `不一致（差額：${m[1]}` },
    { re: /^Detail Catatan:\s*(.+)$/i, en: m => `Note Details: ${m[1]}`, ja: m => `メモ詳細：${m[1]}` },
    { re: /^Oleh:\s*(.+)$/i, en: m => `By: ${m[1]}`, ja: m => `担当：${m[1]}` },
    { re: /^(\d+) baris$/i, en: m => `${m[1]} rows`, ja: m => `${m[1]}行` },
    { re: /^(\d+) data$/i, en: m => `${m[1]} records`, ja: m => `${m[1]}件` },
    { re: /^(\d+) Dok$/i, en: m => `${m[1]} Docs`, ja: m => `${m[1]}件` },
    { re: /^\((\d+) Dokumen\)$/i, en: m => `(${m[1]} Documents)`, ja: m => `（${m[1]}件）` },
    { re: /^(\d+) dari (\d+) dokumen$/i, en: m => `${m[1]} of ${m[2]} documents`, ja: m => `${m[2]}件中${m[1]}件` },
    { re: /^(\d+) dari (\d+) Dok$/i, en: m => `${m[1]} of ${m[2]} docs`, ja: m => `${m[2]}件中${m[1]}件` },
    { re: /^Pencapaian SLA \(≤\s*(\d+) Hari\)$/i, en: m => `SLA Achievement (≤ ${m[1]} Days)`, ja: m => `SLA達成（${m[1]}日以内）` },
    { re: /^Total Nilai Pengajuan \(([A-Z]{3})\)$/i, en: m => `Total Claim Amount (${m[1].toUpperCase()})`, ja: m => `申請金額合計（${m[1].toUpperCase()}）` },
    { re: /^Pencapaian SLA \(%\) · Target (\d+(?:[.,]\d+)?)%$/i, en: m => `SLA Achievement (%) · Target ${m[1]}%`, ja: m => `SLA達成率（%）・目標 ${m[1]}%` },
    { re: /^Pencapaian SLA:\s*(\d+(?:[.,]\d+)?)%$/i, en: m => `SLA Achievement: ${m[1]}%`, ja: m => `SLA達成率：${m[1]}%` },
    { re: /^Target perusahaan:\s*(\d+(?:[.,]\d+)?)%\s*—\s*(Tercapai|Belum tercapai)\.$/i, en: m => `Company target: ${m[1]}% — ${/^tercapai$/i.test(m[2]) ? 'Achieved' : 'Not achieved'}.`, ja: m => `会社目標：${m[1]}% — ${/^tercapai$/i.test(m[2]) ? '達成' : '未達成'}。` },
    { re: /^∑ Pilihan:\s*([A-Z]{3})\s+(.+)$/i, en: m => `∑ Selected: ${m[1].toUpperCase()} ${m[2]}`, ja: m => `∑ 選択合計：${m[1].toUpperCase()} ${m[2]}` },
    { re: /^(\d+) Dokumen$/i, en: m => `${m[1]} Documents`, ja: m => `${m[1]}件` },
    { re: /^(\d+(?:[.,]\d+)?) Hari Kerja$/i, en: m => `${m[1]} Working Days`, ja: m => `${m[1]}営業日` },
    { re: /^Halaman\s+(\d+)\s*\/\s*(\d+)$/i, en: m => `Page ${m[1]} / ${m[2]}`, ja: m => `${m[1]} / ${m[2]}ページ` },
    { re: /^(\d+(?:[.,]\d+)?) Hari$/i, en: m => `${m[1]} Days`, ja: m => `${m[1]}日` },
    { re: /^(\d+(?:[.,]\d+)?) hari$/i, en: m => `${m[1]} days`, ja: m => `${m[1]}日` },
    { re: /^(\d+) Berkas$/i, en: m => `${m[1]} Documents`, ja: m => `${m[1]}件` },
    { re: /^(\d+) Kali Revisi$/i, en: m => `${m[1]} Revisions`, ja: m => `修正${m[1]}回` },
    { re: /^Status berhasil diperbarui menjadi (.+)\.$/i, en: m => `Status successfully updated to ${m[1]}.`, ja: m => `ステータスを「${m[1]}」に更新しました。` },
    { re: /^Berhasil masuk\. Akses untuk (.+) sedang disiapkan\.$/i, en: m => `Signed in successfully. Preparing access for ${m[1]}.`, ja: m => `ログインしました。${m[1]} のアクセスを準備しています。` },
    { re: /^Buka rincian klaim (.+)$/i, en: m => `Open claim details for ${m[1]}`, ja: m => `${m[1]} の申請詳細を開く` },
    { re: /^Buka rincian revisi klaim (.+)$/i, en: m => `Open revision details for ${m[1]}`, ja: m => `${m[1]} の修正詳細を開く` },
    { re: /^Baris (\d+): tanggal belum valid\.$/i, en: m => `Row ${m[1]}: the date is invalid.`, ja: m => `${m[1]}行目：日付が無効です。` },
    { re: /^Tanggal (.+) tercatat lebih dari sekali\.$/i, en: m => `Date ${m[1]} is listed more than once.`, ja: m => `日付 ${m[1]} が重複しています。` },
    { re: /^Memperbarui cloud (\d+)\/(\d+)$/i, en: m => `Updating cloud ${m[1]}/${m[2]}`, ja: m => `クラウド更新 ${m[1]}/${m[2]}` },
    { re: /^Ekspor Excel berhasil: (\d+) klaim dan (\d+) baris\.$/i, en: m => `Excel export completed: ${m[1]} claims and ${m[2]} rows.`, ja: m => `Excel出力完了：申請${m[1]}件、${m[2]}行。` },
    { re: /^Target perusahaan (\d+)%$/i, en: m => `Company target ${m[1]}%`, ja: m => `会社目標 ${m[1]}%` },
    { re: /^Terlambat (\d+) hari$/i, en: m => `${m[1]} days late`, ja: m => `${m[1]}日遅延` },
    { re: /^Dokumen tertahan >\s*(\d+) Hari$/i, en: m => `Documents pending > ${m[1]} Days`, ja: m => `${m[1]}日超の保留書類` },
    { re: /^Sangat Baik \(≤\s*(\d+) Hari\)$/i, en: m => `Excellent (≤ ${m[1]} Days)`, ja: m => `良好（${m[1]}日以内）` },
    { re: /^Perlu Perhatian \((\d+)-(\d+) Hari\)$/i, en: m => `Needs Attention (${m[1]}-${m[2]} Days)`, ja: m => `要注意（${m[1]}～${m[2]}日）` },
    { re: /^Terlambat \(>\s*(\d+) Hari\)$/i, en: m => `Late (> ${m[1]} Days)`, ja: m => `遅延（${m[1]}日超）` },
    { re: /^(\d+(?:[.,]\d+)?)x revisi$/i, en: m => `${m[1]}x revisions`, ja: m => `修正${m[1]}回` },
    { re: /^\((\d+) kali pengembalian\)$/i, en: m => `(${m[1]} returns)`, ja: m => `（返却${m[1]}回）` },
    { re: /^(\d+) dokumen sumber$/i, en: m => `${m[1]} source documents`, ja: m => `根拠書類${m[1]}件` },
    { re: /^Periode:\s*(.+)$/i, en: m => `Period: ${m[1]}`, ja: m => `期間：${m[1]}` },
    { re: /^Filter:\s*(.+)$/i, en: m => `Filter: ${m[1]}`, ja: m => `フィルター：${m[1]}` },
    { re: /^Rincian Klaim dalam ([A-Z]{3})$/i, en: m => `Claim Details in ${m[1].toUpperCase()}`, ja: m => `${m[1].toUpperCase()}申請の詳細` },
    { re: /^Rincian Status (.+)$/i, en: m => `${m[1]} Status Details`, ja: m => `ステータス「${m[1]}」の詳細` },
    { re: /^Rincian Klaim (.+) \(NIK (.+)\)$/i, en: m => `Claim Details for ${m[1]} (NIK ${m[2]})`, ja: m => `${m[1]} の申請詳細（NIK ${m[2]}）` },
    { re: /^Rincian Revisi (.+) \(NIK (.+)\)$/i, en: m => `Revision Details for ${m[1]} (NIK ${m[2]})`, ja: m => `${m[1]} の修正詳細（NIK ${m[2]}）` },
    { re: /^Rincian Volume Periode (.+)$/i, en: m => `Volume Details for ${m[1]}`, ja: m => `${m[1]}の件数詳細` },
    { re: /^Rincian Performa SLA:\s*(.+)$/i, en: m => `SLA Performance Details: ${m[1]}`, ja: m => `SLA実績詳細：${m[1]}` },
    { re: /^Rincian Rapor:\s*(.+)$/i, en: m => `Report Details: ${m[1]}`, ja: m => `レポート詳細：${m[1]}` },
    { re: /^Sangat Baik \(≤\s*(\d+) Hari\):$/i, en: m => `Excellent (≤ ${m[1]} Days):`, ja: m => `良好（${m[1]}日以内）：` },
    { re: /^Perlu Perhatian \((\d+)-(\d+) Hari\):$/i, en: m => `Needs Attention (${m[1]}-${m[2]} Days):`, ja: m => `要注意（${m[1]}～${m[2]}日）：` },
    { re: /^Terlambat \(>\s*(\d+) Hari\):$/i, en: m => `Late (> ${m[1]} Days):`, ja: m => `遅延（${m[1]}日超）：` },
    { re: /^Total Amount:\s*(.+)$/i, en: m => `Total Amount: ${m[1]}`, ja: m => `合計金額：${m[1]}` },
    { re: /^Frekuensi Klaim\s*([↓↑⇅])$/i, en: m => `Claim Frequency ${m[1]}`, ja: m => `申請回数 ${m[1]}` },

    // P21 — label pagination dan catatan dinamis. Ditulis sebagai pola supaya
    // seluruh modul memakai satu terjemahan tanpa perlu mengubah tiap render.
    { re: /^Halaman (\d+) dari (\d+) \((\d+) Data\)$/i, en: m => `Page ${m[1]} of ${m[2]} (${m[3]} records)`, ja: m => `${m[1]} / ${m[2]} ページ（${m[3]}件）` },
    { re: /^Halaman (\d+) \/ (\d+) \((\d+) Data\)$/i, en: m => `Page ${m[1]} / ${m[2]} (${m[3]} records)`, ja: m => `${m[1]} / ${m[2]} ページ（${m[3]}件）` },
    { re: /^Halaman (\d+) dari (\d+) \((\d+) Karyawan\)$/i, en: m => `Page ${m[1]} of ${m[2]} (${m[3]} employees)`, ja: m => `${m[1]} / ${m[2]} ページ（従業員${m[3]}名）` },
    { re: /^Halaman (\d+)\/(\d+) · (\d+) log$/i, en: m => `Page ${m[1]}/${m[2]} · ${m[3]} logs`, ja: m => `${m[1]}/${m[2]} ページ・ログ${m[3]}件` },
    { re: /^Halaman (\d+) dari (\d+)$/i, en: m => `Page ${m[1]} of ${m[2]}`, ja: m => `${m[1]} / ${m[2]} ページ` },
    { re: /^Halaman (\d+)\/(\d+)$/i, en: m => `Page ${m[1]}/${m[2]}`, ja: m => `${m[1]}/${m[2]} ページ` },
    { re: /^Halaman (\d+) \/ (\d+)$/i, en: m => `Page ${m[1]} / ${m[2]}`, ja: m => `${m[1]} / ${m[2]} ページ` },
    { re: /^([\d.,]+) klaim ditemukan$/i, en: m => `${m[1]} claims found`, ja: m => `${m[1]}件の申請が見つかりました` },
    { re: /^(\d+) perubahan ditolak cloud dan belum tersimpan\. Data lokal aman; tekan Sinkronkan untuk mencoba lagi\.$/i, en: m => `${m[1]} change(s) were rejected by the cloud and are not saved yet. Local data is safe; press Sync to try again.`, ja: m => `${m[1]}件の変更がクラウドに拒否され、まだ保存されていません。ローカルデータは安全です。「同期」を押して再試行してください。` },
    { re: /^Konfigurasi terakhir:\s*(.+?)\s+oleh\s+(.+)$/i, en: m => `Last configured: ${m[1]} by ${m[2]}`, ja: m => `最終設定：${m[1]}（${m[2]}）` },
    { re: /^Catatan:\s*(.+)$/i, en: m => `Note: ${m[1]}`, ja: m => `メモ：${m[1]}` },
    { re: /^SLA \(Kerja\):\s*(\d+) Hari$/i, en: m => `SLA (working): ${m[1]} days`, ja: m => `SLA（営業日）：${m[1]}日` },
    { re: /^Zona waktu: (.+) \| Terakhir diperbarui: (.+) \| Oleh: (.+)$/i, en: m => `Time zone: ${m[1]} | Last updated: ${m[2]} | By: ${m[3]}`, ja: m => `タイムゾーン：${m[1]}｜最終更新：${m[2]}｜更新者：${m[3]}` }
];

const WORKSHEET_DATE_WORDS = {
    en: {
        Januari:'January', Februari:'February', Maret:'March', April:'April', Mei:'May', Juni:'June', Juli:'July', Agustus:'August', September:'September', Oktober:'October', November:'November', Desember:'December',
        Senin:'Monday', Selasa:'Tuesday', Rabu:'Wednesday', Kamis:'Thursday', Jumat:'Friday', Sabtu:'Saturday', Minggu:'Sunday'
    },
    ja: {
        Januari:'1月', Februari:'2月', Maret:'3月', April:'4月', Mei:'5月', Juni:'6月', Juli:'7月', Agustus:'8月', September:'9月', Oktober:'10月', November:'11月', Desember:'12月',
        Senin:'月曜日', Selasa:'火曜日', Rabu:'水曜日', Kamis:'木曜日', Jumat:'金曜日', Sabtu:'土曜日', Minggu:'日曜日'
    }
};

let worksheetUiCopyOverrides = {};
let worksheetUiCopyEditorDraft = null;
let worksheetUiCopyUnsubscribe = null;

function getWorksheetCopyOverride(source, language) {
    const key = String(source === null || source === undefined ? '' : source).trim();
    const row = worksheetUiCopyOverrides && worksheetUiCopyOverrides[key];
    if(!row || typeof row !== 'object') return null;
    const value = row[language];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

let worksheetLanguage = (() => {
    try {
        const saved = localStorage.getItem(WORKSHEET_LANGUAGE_KEY);
        return WORKSHEET_SUPPORTED_LANGUAGES.includes(saved) ? saved : 'id';
    } catch (_) { return 'id'; }
})();
let worksheetFont = (() => {
    try {
        const saved = localStorage.getItem(WORKSHEET_FONT_KEY);
        return WORKSHEET_SUPPORTED_FONTS.includes(saved) ? saved : 'google-sans';
    } catch (_) { return 'google-sans'; }
})();
const worksheetAttributeTranslations = new WeakMap();
let worksheetTranslationFrame = 0;
const worksheetTranslationQueue = new Set();

function translateWorksheetCoreText(text, language = worksheetLanguage) {
    const source = String(text === null || text === undefined ? '' : text);
    if(!source.trim()) return source;
    const directOverride = getWorksheetCopyOverride(source.trim(), language);
    if(directOverride !== null) return directOverride;
    if(language === 'id') return source;
    const exact = WORKSHEET_TRANSLATIONS[source.trim()];
    if(exact && exact[language]) return exact[language];

    const decorated = source.trim().match(/^([^A-Za-z0-9]*)([\s\S]+)$/);
    if(decorated && decorated[1]) {
        const bodyOverride = getWorksheetCopyOverride(decorated[2].trim(), language);
        if(bodyOverride !== null) return `${decorated[1]}${bodyOverride}`;
        const bodyTranslation = WORKSHEET_TRANSLATIONS[decorated[2].trim()];
        if(bodyTranslation && bodyTranslation[language]) return `${decorated[1]}${bodyTranslation[language]}`;
        for(const pattern of WORKSHEET_DYNAMIC_TRANSLATIONS) {
            const bodyMatch = decorated[2].trim().match(pattern.re);
            if(bodyMatch) return `${decorated[1]}${pattern[language](bodyMatch)}`;
        }
    }

    for(const pattern of WORKSHEET_DYNAMIC_TRANSLATIONS) {
        const match = source.trim().match(pattern.re);
        if(match) return pattern[language](match);
    }

    let dated = source;
    const dateWords = WORKSHEET_DATE_WORDS[language] || {};
    Object.entries(dateWords).forEach(([from, to]) => {
        dated = dated.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    });
    return dated;
}

function translateUiText(value, language = worksheetLanguage) {
    const source = String(value === null || value === undefined ? '' : value);
    if(!source.trim()) return source;
    const leading = (source.match(/^\s*/) || [''])[0];
    const trailing = (source.match(/\s*$/) || [''])[0];
    const core = source.slice(leading.length, source.length - trailing.length);
    const translated = core.split('\n').map(line => translateWorksheetCoreText(line, language)).join('\n');
    return `${leading}${translated}${trailing}`;
}
window.translateUiText = translateUiText;
window.getWorksheetLanguage = () => worksheetLanguage;

function shouldSkipWorksheetTranslation(node) {
    const parent = node && node.parentElement;
    return !parent || ['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE'].includes(parent.tagName) || !!parent.closest('[data-i18n-skip], .flatpickr-calendar');
}

function translateWorksheetTextNode(node) {
    if(!node || shouldSkipWorksheetTranslation(node)) return;
    const current = node.nodeValue;
    if(node.__worksheetI18nSource === undefined || node.__worksheetI18nRendered !== current) node.__worksheetI18nSource = current;
    if(node.__worksheetI18nRendered === current && node.__worksheetI18nLanguage === worksheetLanguage) return;
    const next = translateUiText(node.__worksheetI18nSource, worksheetLanguage);
    node.__worksheetI18nRendered = next;
    node.__worksheetI18nLanguage = worksheetLanguage;
    if(current !== next) node.nodeValue = next;
}

function translateWorksheetAttributes(element) {
    if(!element || element.nodeType !== 1 || element.closest('[data-i18n-skip], .flatpickr-calendar')) return;
    const attributes = ['placeholder', 'title', 'aria-label'];
    const state = worksheetAttributeTranslations.get(element) || {};
    attributes.forEach(attribute => {
        if(!element.hasAttribute(attribute)) return;
        const current = element.getAttribute(attribute);
        const entry = state[attribute];
        if(!entry || entry.rendered !== current) state[attribute] = { source: current, rendered: current };
        const next = translateUiText(state[attribute].source, worksheetLanguage);
        state[attribute].rendered = next;
        if(current !== next) element.setAttribute(attribute, next);
    });
    worksheetAttributeTranslations.set(element, state);
}

function applyWorksheetTranslations(root = document.body) {
    if(!root) return;
    if(root.nodeType === Node.TEXT_NODE) {
        translateWorksheetTextNode(root);
        return;
    }
    if(root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if(root.nodeType === Node.ELEMENT_NODE) translateWorksheetAttributes(root);
    root.querySelectorAll && root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(translateWorksheetAttributes);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while((textNode = walker.nextNode())) translateWorksheetTextNode(textNode);
}
window.applyWorksheetTranslations = applyWorksheetTranslations;

function scheduleWorksheetTranslation(root) {
    if(root) worksheetTranslationQueue.add(root);
    if(worksheetTranslationFrame) return;
    const schedule = window.requestAnimationFrame || (callback => setTimeout(callback, 16));
    worksheetTranslationFrame = schedule(() => {
        worksheetTranslationFrame = 0;
        const roots = Array.from(worksheetTranslationQueue);
        worksheetTranslationQueue.clear();
        roots.forEach(applyWorksheetTranslations);
        if(typeof window.syncAllEnhancedSelects === 'function') window.syncAllEnhancedSelects();
    });
}

function updateWorksheetLanguageSwitches() {
    document.querySelectorAll('[data-language-switch] [data-language]').forEach(button => {
        const active = button.dataset.language === worksheetLanguage;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function localizeWorksheetCalendars() {
    const locales = {
        id: {
            rangeSeparator:' ➔ ', firstDayOfWeek:1,
            weekdays:{ shorthand:['Min','Sen','Sel','Rab','Kam','Jum','Sab'], longhand:['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'] },
            months:{ shorthand:['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'], longhand:['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'] }
        },
        en: {
            rangeSeparator:' to ', firstDayOfWeek:1,
            weekdays:{ shorthand:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], longhand:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] },
            months:{ shorthand:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], longhand:['January','February','March','April','May','June','July','August','September','October','November','December'] }
        },
        ja: {
            rangeSeparator:' ～ ', firstDayOfWeek:1,
            weekdays:{ shorthand:['日','月','火','水','木','金','土'], longhand:['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'] },
            months:{ shorthand:['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], longhand:['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'] }
        }
    };
    document.querySelectorAll('input').forEach(input => {
        const picker = input._flatpickr;
        if(!picker) return;
        try {
            picker.set('locale', locales[worksheetLanguage]);
            picker.set('altFormat', worksheetLanguage === 'ja' ? 'Y年m月d日' : 'd M Y');
            picker.redraw();
            picker.updateValue(false);
        } catch(error) {
            console.warn('[Bahasa] Kalender belum dapat diperbarui:', error);
        }
    });
}

function setAppLanguage(language, options = {}) {
    if(!WORKSHEET_SUPPORTED_LANGUAGES.includes(language)) return false;
    worksheetLanguage = language;
    document.documentElement.lang = language === 'ja' ? 'ja' : language;
    document.documentElement.dataset.appLanguage = language;
    if(options.persist !== false) {
        try { localStorage.setItem(WORKSHEET_LANGUAGE_KEY, language); } catch (_) {}
    }
    const titleSource = 'Worksheet Klaim - Operasional & Pelaporan';
    document.title = translateUiText(titleSource, language);
    updateWorksheetLanguageSwitches();
    applyWorksheetTranslations(document.body);
    localizeWorksheetCalendars();
    if(typeof window.syncAllEnhancedSelects === 'function') window.syncAllEnhancedSelects(true);
    document.dispatchEvent(new CustomEvent('worksheet:languagechange', { detail:{ language } }));
    return true;
}
window.setAppLanguage = setAppLanguage;

function refreshWorksheetChartFonts() {
    if(!window.Chart || !window.Chart.defaults || !window.Chart.defaults.font) return;
    window.Chart.defaults.font.family = WORKSHEET_FONT_FAMILIES[worksheetFont];
    const instances = window.Chart.instances ? Object.values(window.Chart.instances) : [];
    instances.forEach(chart => {
        try { if(chart && typeof chart.update === 'function') chart.update('none'); } catch (_) {}
    });
}

function setAppFont(font, options = {}) {
    if(!WORKSHEET_SUPPORTED_FONTS.includes(font)) return false;
    worksheetFont = font;
    document.documentElement.dataset.appFont = font;
    const select = document.getElementById('app-font-select');
    if(select && select.value !== font) select.value = font;
    if(options.persist !== false) {
        try { localStorage.setItem(WORKSHEET_FONT_KEY, font); } catch (_) {}
    }
    refreshWorksheetChartFonts();
    if(typeof window.syncAllEnhancedSelects === 'function') window.syncAllEnhancedSelects();
    document.dispatchEvent(new CustomEvent('worksheet:fontchange', { detail:{ font } }));
    return true;
}
window.setAppFont = setAppFont;
window.getWorksheetFont = () => worksheetFont;

function initializeWorksheetFont() {
    setAppFont(worksheetFont, { persist:false });
    if(document.fonts && typeof document.fonts.load === 'function') {
        const activeFamily = WORKSHEET_FONT_FAMILIES[worksheetFont];
        document.fonts.load(`600 16px ${activeFamily}`).then(refreshWorksheetChartFonts).catch(() => {});
    }
}

function getBaseWorksheetTranslation(source, language) {
    const key = String(source || '').trim();
    if(language === 'id') return key;
    const row = WORKSHEET_TRANSLATIONS[key];
    return row && row[language] ? row[language] : key;
}

function getUiCopyCatalogSources() {
    return Object.keys(WORKSHEET_TRANSLATIONS).filter(Boolean).sort((a,b) => a.localeCompare(b, 'id'));
}

// Katalog teks berjumlah ribuan baris. Tanpa pengelompokan, admin harus
// menggulir satu daftar panjang untuk menemukan satu label. Setiap teks
// dipetakan ke satu section berdasarkan kata kunci, dicek berurutan supaya
// hasilnya selalu sama untuk teks yang cocok di lebih dari satu section.
const UI_COPY_SECTIONS = [
    { key:'akun', label:'Login & Akun', icon:'🔐', re:/\b(login|masuk|keluar|logout|password|kata sandi|akun|pengguna|peran|role|akses|sesi|admin|viewer|finance|accounting|otentikasi|kredensial|profil)\b/i },
    { key:'navigasi', label:'Navigasi & Menu', icon:'🧭', re:/\b(menu|halaman utama|beranda|dashboard|navigasi|lembar kerja|rekapitulasi|statistik|analitik|ringkasan manajemen|cari klaim|pengaturan|kembali|tutup|buka|batal|simpan|lanjut|berikutnya|sebelumnya)\b/i },
    { key:'klaim', label:'Klaim & Workflow', icon:'📄', re:/\b(klaim|claim|pengajuan|status|posted|paid|hold|revisi|cancel|canceled|dibatalkan|approval|persetujuan|proses|nota|detail|adjust|penyesuaian|workflow|linimasa|riwayat|arsip|finance|pembayaran|payment)\b/i },
    { key:'tabel', label:'Tabel & Filter', icon:'▤', re:/\b(tabel|kolom|baris|filter|sortir|urutkan|halaman|pagination|tampilkan|pilih|centang|ekspor|export|impor|import|unduh|excel|xlsx|cari|pencarian|kata kunci|periode|rentang|tanggal|preset)\b/i },
    { key:'pesan', label:'Notifikasi & Pesan', icon:'🔔', re:/\b(berhasil|gagal|error|kesalahan|wajib|tidak valid|minimal|maksimal|peringatan|perhatian|konfirmasi|yakin|apakah|silakan|mohon|periksa|coba lagi|tersimpan|terhapus|diperbarui|kosong|belum|sudah)\b/i },
    { key:'master', label:'Master Data & Sistem', icon:'⚙️', re:/\b(master|gl|karyawan|nik|entitas|kalender|libur|sla|backup|cadangan|pulihkan|sinkronisasi|firestore|cloud|database|penyimpanan|log|aktivitas|audit|sistem|versi|bahasa|font|tema)\b/i },
    { key:'laporan', label:'Statistik & Laporan', icon:'📊', re:/\b(statistik|laporan|grafik|chart|tren|rapor|peringkat|rata-rata|total|jumlah|nilai|persentase|target|pencapaian|perbandingan|indikator|volume|amount|mata uang|currency)\b/i }
];
const UI_COPY_FALLBACK_SECTION = { key:'lainnya', label:'Teks Lainnya', icon:'🗂️' };

function getUiCopySectionKey(source) {
    const text = String(source || '');
    const match = UI_COPY_SECTIONS.find(section => section.re.test(text));
    return match ? match.key : UI_COPY_FALLBACK_SECTION.key;
}

function getUiCopySectionMeta(key) {
    return UI_COPY_SECTIONS.find(section => section.key === key) || UI_COPY_FALLBACK_SECTION;
}

function groupUiCopySources(sources) {
    const groups = new Map();
    [...UI_COPY_SECTIONS.map(section => section.key), UI_COPY_FALLBACK_SECTION.key]
        .forEach(key => groups.set(key, []));
    (sources || []).forEach(source => groups.get(getUiCopySectionKey(source)).push(source));
    return groups;
}

let uiCopyActiveSection = UI_COPY_SECTIONS[0].key;
let uiCopySectionPages = {};
let uiCopyRowsPerPage = 25;

window.setUiCopySection = function(key) {
    uiCopyActiveSection = key;
    uiCopySectionPages[key] = 1;
    window.renderUiCopyEditor();
};
window.changeUiCopyPage = function(delta) {
    const current = uiCopySectionPages[uiCopyActiveSection] || 1;
    uiCopySectionPages[uiCopyActiveSection] = Math.max(1, current + delta);
    window.renderUiCopyEditor();
};
window.changeUiCopyRows = function(value) {
    uiCopyRowsPerPage = Math.max(5, parseInt(value, 10) || 25);
    uiCopySectionPages = {};
    window.renderUiCopyEditor();
};
// Pencarian dan pergantian bahasa selalu memulai section dari halaman satu.
window.resetUiCopyPaging = function() {
    uiCopySectionPages = {};
    window.renderUiCopyEditor();
};

function escapeUiCopyHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function ensureUiCopyEditorDraft() {
    if(!worksheetUiCopyEditorDraft) worksheetUiCopyEditorDraft = JSON.parse(JSON.stringify(worksheetUiCopyOverrides || {}));
    return worksheetUiCopyEditorDraft;
}

window.setUiCopyDraftValue = function(encodedSource, language, value) {
    if(!isAppAdmin()) return;
    const source = decodeURIComponent(encodedSource);
    const draft = ensureUiCopyEditorDraft();
    const base = getBaseWorksheetTranslation(source, language);
    if(!String(value).trim() || String(value) === String(base)) {
        if(draft[source]) {
            delete draft[source][language];
            if(!Object.keys(draft[source]).length) delete draft[source];
        }
    } else {
        if(!draft[source]) draft[source] = {};
        draft[source][language] = String(value);
    }
    const row = document.querySelector(`[data-ui-copy-row="${CSS.escape(encodedSource)}"]`);
    if(row) row.classList.toggle('is-overridden', !!(draft[source] && draft[source][language]));
};

window.resetUiCopySingle = function(encodedSource) {
    if(!isAppAdmin()) return;
    const source = decodeURIComponent(encodedSource);
    const language = document.getElementById('ui-copy-language')?.value || 'id';
    const draft = ensureUiCopyEditorDraft();
    if(draft[source]) {
        delete draft[source][language];
        if(!Object.keys(draft[source]).length) delete draft[source];
    }
    window.renderUiCopyEditor();
};

window.renderUiCopyEditor = function() {
    if(!isAppAdmin()) return;
    const list = document.getElementById('ui-copy-editor-list');
    if(!list) return;
    const query = String(document.getElementById('ui-copy-search')?.value || '').trim().toLowerCase();
    const language = document.getElementById('ui-copy-language')?.value || 'id';
    const draft = ensureUiCopyEditorDraft();

    let sources = getUiCopyCatalogSources();
    if(query) sources = sources.filter(source => {
        const base = getBaseWorksheetTranslation(source, language);
        const override = draft[source] && draft[source][language] || '';
        return `${source} ${base} ${override}`.toLowerCase().includes(query);
    });

    const groups = groupUiCopySources(sources);
    const totalMatches = sources.length;

    // Saat pencarian mengosongkan section aktif, pindah otomatis ke section
    // pertama yang masih punya hasil supaya layar tidak terlihat kosong.
    if(!(groups.get(uiCopyActiveSection) || []).length) {
        const firstFilled = [...groups.entries()].find(([, rows]) => rows.length);
        if(firstFilled) uiCopyActiveSection = firstFilled[0];
    }

    const tabsHost = document.getElementById('ui-copy-sections');
    if(tabsHost) {
        tabsHost.innerHTML = [...groups.entries()].map(([key, rows]) => {
            const meta = getUiCopySectionMeta(key);
            const active = key === uiCopyActiveSection;
            return `<button type="button" class="ui-copy-tab${active ? ' is-active' : ''}${rows.length ? '' : ' is-empty'}"
                aria-pressed="${active}" onclick="setUiCopySection('${key}')">
                <span aria-hidden="true">${meta.icon}</span>${escapeUiCopyHtml(translateUiText(meta.label, worksheetLanguage))}
                <em>${rows.length}</em></button>`;
        }).join('');
    }

    const sectionRows = groups.get(uiCopyActiveSection) || [];
    const maxPage = Math.max(1, Math.ceil(sectionRows.length / uiCopyRowsPerPage));
    let page = uiCopySectionPages[uiCopyActiveSection] || 1;
    if(page > maxPage) page = maxPage;
    if(page < 1) page = 1;
    uiCopySectionPages[uiCopyActiveSection] = page;
    const pageRows = sectionRows.slice((page - 1) * uiCopyRowsPerPage, page * uiCopyRowsPerPage);

    const meta = document.getElementById('ui-copy-meta');
    if(meta) meta.textContent = translateUiText(`${totalMatches} teks`, worksheetLanguage);

    const pager = document.getElementById('ui-copy-pagination');
    if(pager) {
        pager.hidden = sectionRows.length === 0;
        const info = document.getElementById('ui-copy-page-info');
        if(info) info.textContent = translateUiText(`Halaman ${page} dari ${maxPage} (${sectionRows.length} Data)`, worksheetLanguage);
        const prev = document.getElementById('ui-copy-prev');
        const next = document.getElementById('ui-copy-next');
        if(prev) prev.disabled = page <= 1;
        if(next) next.disabled = page >= maxPage;
    }

    if(!pageRows.length) {
        list.innerHTML = `<div class="ui-copy-empty">${escapeUiCopyHtml(translateUiText('Tidak ada teks yang cocok.', worksheetLanguage))}</div>`;
        return;
    }

    list.innerHTML = pageRows.map(source => {
        const encoded = encodeURIComponent(source);
        const base = getBaseWorksheetTranslation(source, language);
        const override = draft[source] && draft[source][language];
        const value = override !== undefined ? override : base;
        const overridden = override !== undefined;
        const stateLabel = translateUiText(overridden ? 'Override aktif' : 'Teks bawaan sistem', worksheetLanguage);
        const resetLabel = translateUiText('Atur Ulang', worksheetLanguage);
        return `<div class="ui-copy-row${overridden ? ' is-overridden' : ''}" data-ui-copy-row="${escapeUiCopyHtml(encoded)}">
            <div class="ui-copy-source"><strong>${escapeUiCopyHtml(source)}</strong><small>${escapeUiCopyHtml(stateLabel)} · Source ID</small></div>
            <textarea oninput="setUiCopyDraftValue('${escapeUiCopyHtml(encoded)}','${language}',this.value)">${escapeUiCopyHtml(value)}</textarea>
            <button type="button" class="btn btn-secondary ui-copy-reset" onclick="resetUiCopySingle('${escapeUiCopyHtml(encoded)}')">${escapeUiCopyHtml(resetLabel)}</button>
        </div>`;
    }).join('');
};

window.resetUiCopyEditorDraft = function() {
    if(!isAppAdmin()) return;
    worksheetUiCopyEditorDraft = JSON.parse(JSON.stringify(worksheetUiCopyOverrides || {}));
    window.renderUiCopyEditor();
    showToast('Draft editor teks dikembalikan ke versi tersimpan.', 'info');
};

window.saveUiCopyOverrides = async function() {
    if(!isAppAdmin()) return showToast('Editor teks hanya dapat disimpan Admin.', 'error');
    if(!window.firebaseDb || !window.fbDoc || !window.fbSetDoc) return showToast('Firebase belum siap.', 'error');
    const button = document.getElementById('btn-save-ui-copy');
    const original = button ? button.textContent : '';
    if(button) { button.disabled = true; button.textContent = 'Menyimpan...'; }
    try {
        const overrides = JSON.parse(JSON.stringify(ensureUiCopyEditorDraft()));
        await window.fbSetDoc(window.fbDoc(window.firebaseDb, 'appData', 'uiTextSettings'), {
            overrides,
            updatedAtMs: Date.now()
        });
        worksheetUiCopyOverrides = overrides;
        worksheetUiCopyEditorDraft = JSON.parse(JSON.stringify(overrides));
        setAppLanguage(worksheetLanguage, { persist:false });
        showToast('Perubahan teks berhasil disimpan dan berlaku lintas perangkat.', 'success');
        logActivity(sessionUser, 'Pembaruan Editor Teks Website').catch(() => {});
    } catch(error) {
        console.error('[UI Copy] Gagal menyimpan:', error);
        showToast('Perubahan teks gagal disimpan. Periksa izin Firebase Admin.', 'error');
    } finally {
        if(button) { button.disabled = false; button.textContent = original; }
    }
};

function subscribeUiCopySettings() {
    if(worksheetUiCopyUnsubscribe || !window.firebaseDb || !window.fbDoc || !window.fbOnSnapshot) return;
    const ref = window.fbDoc(window.firebaseDb, 'appData', 'uiTextSettings');
    worksheetUiCopyUnsubscribe = window.fbOnSnapshot(ref, snap => {
        const data = snap.exists() ? snap.data() : {};
        worksheetUiCopyOverrides = data && data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
        worksheetUiCopyEditorDraft = null;
        setAppLanguage(worksheetLanguage, { persist:false });
        if(window.currentOpenMenu === 'master-content') window.renderUiCopyEditor();
    }, error => console.warn('[UI Copy] Listener belum tersedia:', error));
}

function initializeWorksheetLanguage() {
    subscribeUiCopySettings();
    document.addEventListener('click', event => {
        const languageButton = event.target.closest('[data-language-switch] [data-language]');
        if(!languageButton) return;
        setAppLanguage(languageButton.dataset.language);
    });
    const observer = new MutationObserver(records => {
        // Tetap pindai Bahasa Indonesia karena Admin dapat membuat override copy ID.
        records.forEach(record => {
            if(record.type === 'characterData') scheduleWorksheetTranslation(record.target);
            if(record.type === 'attributes') scheduleWorksheetTranslation(record.target);
            record.addedNodes && record.addedNodes.forEach(node => scheduleWorksheetTranslation(node));
        });
    });
    observer.observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['placeholder','title','aria-label'] });
    setAppLanguage(worksheetLanguage, { persist:false });
}

/* Dropdown portal: select asli tetap menjadi sumber nilai formulir, tetapi tidak
   pernah ditampilkan sebagai kontrol bawaan browser. */
const enhancedSelectState = new WeakMap();
let activeEnhancedSelect = null;
let enhancedSelectPortal = null;
let enhancedSelectPositionFrame = 0;

function isCompactWorksheetSelect(select) {
    if(select.closest('.form-group')) return false;
    return select.classList.contains('compact-period-select') || /(?:rows|preset|currency|grouping|filter)/i.test(select.id || '');
}

function getWorksheetSelectLabel(select) {
    const selected = select.options && select.options[select.selectedIndex];
    if(!selected) return 'Pilih Opsi';
    const source = selected.__worksheetI18nSource !== undefined ? selected.__worksheetI18nSource : selected.textContent;
    return translateUiText(String(source || '').trim(), worksheetLanguage);
}

function ensureEnhancedSelectPortal() {
    if(enhancedSelectPortal) return enhancedSelectPortal;
    const portal = document.createElement('div');
    portal.id = 'ws-select-portal';
    portal.hidden = true;

    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'ws-select-scrim';
    scrim.setAttribute('aria-label', 'Tutup');
    scrim.addEventListener('click', () => closeEnhancedSelect());

    const panel = document.createElement('div');
    panel.className = 'ws-select-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Pilih Opsi');

    const head = document.createElement('div');
    head.className = 'ws-select-panel-head';
    const title = document.createElement('strong');
    title.textContent = 'Pilih Opsi';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ws-select-panel-close';
    close.setAttribute('aria-label', 'Tutup');
    close.textContent = '×';
    close.addEventListener('click', () => closeEnhancedSelect(true));
    head.append(title, close);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'ws-select-search-wrap';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'ws-select-search';
    search.placeholder = 'Cari pilihan...';
    search.autocomplete = 'off';
    search.addEventListener('input', () => renderEnhancedSelectOptions(search.value));
    searchWrap.appendChild(search);

    const options = document.createElement('div');
    options.className = 'ws-select-options';
    panel.append(head, searchWrap, options);
    portal.append(scrim, panel);
    document.body.appendChild(portal);
    enhancedSelectPortal = portal;
    applyWorksheetTranslations(portal);
    return portal;
}

function positionEnhancedSelectPanel() {
    if(!activeEnhancedSelect || !enhancedSelectPortal || enhancedSelectPortal.hidden || window.innerWidth <= 850) return;
    const state = enhancedSelectState.get(activeEnhancedSelect);
    if(!state) return;
    const panel = enhancedSelectPortal.querySelector('.ws-select-panel');
    const rect = state.trigger.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(rect.width, 220), Math.max(220, window.innerWidth - margin * 2));
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    const estimatedHeight = Math.min(360, panel.scrollHeight || 280);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    if(below >= Math.min(estimatedHeight, 220) || below >= above) {
        panel.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - margin - 100)}px`;
        panel.style.maxHeight = `${Math.max(120, below - 6)}px`;
    } else {
        panel.style.top = `${Math.max(margin, rect.top - estimatedHeight - 6)}px`;
        panel.style.maxHeight = `${Math.max(120, above - 6)}px`;
    }
}

function scheduleEnhancedSelectPosition() {
    if(enhancedSelectPositionFrame) return;
    const schedule = window.requestAnimationFrame || (callback => setTimeout(callback, 16));
    enhancedSelectPositionFrame = schedule(() => {
        enhancedSelectPositionFrame = 0;
        positionEnhancedSelectPanel();
    });
}

function renderEnhancedSelectOptions(filterValue = '') {
    if(!activeEnhancedSelect) return;
    const portal = ensureEnhancedSelectPortal();
    const list = portal.querySelector('.ws-select-options');
    const searchWrap = portal.querySelector('.ws-select-search-wrap');
    const queryText = String(filterValue || '').trim().toLocaleLowerCase(worksheetLanguage === 'ja' ? 'ja-JP' : worksheetLanguage === 'en' ? 'en-US' : 'id-ID');
    const optionItems = Array.from(activeEnhancedSelect.options || []).map((option, index) => ({ option, index, label: translateUiText(String(option.__worksheetI18nSource !== undefined ? option.__worksheetI18nSource : option.textContent || '').trim(), worksheetLanguage) }));
    searchWrap.style.display = optionItems.length > 8 ? 'block' : 'none';
    list.replaceChildren();
    const visibleItems = optionItems.filter(item => !item.option.hidden && (!queryText || item.label.toLocaleLowerCase().includes(queryText)));

    if(!visibleItems.length) {
        const empty = document.createElement('div');
        empty.className = 'ws-select-empty';
        empty.textContent = translateUiText('Tidak ada pilihan yang sesuai.', worksheetLanguage);
        list.appendChild(empty);
        return;
    }

    visibleItems.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ws-select-option';
        button.setAttribute('role', 'option');
        button.dataset.optionIndex = String(item.index);
        button.disabled = !!item.option.disabled;
        const isSelected = item.index === activeEnhancedSelect.selectedIndex;
        button.classList.toggle('is-selected', isSelected);
        button.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        const check = document.createElement('span');
        check.className = 'ws-select-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(check, label);
        button.addEventListener('click', () => {
            if(item.option.disabled) return;
            activeEnhancedSelect.selectedIndex = item.index;
            activeEnhancedSelect.dispatchEvent(new Event('input', { bubbles:true }));
            activeEnhancedSelect.dispatchEvent(new Event('change', { bubbles:true }));
            syncEnhancedSelect(activeEnhancedSelect);
            closeEnhancedSelect(true);
        });
        list.appendChild(button);
    });
    scheduleEnhancedSelectPosition();
}

function openEnhancedSelect(select) {
    const state = enhancedSelectState.get(select);
    if(!state || select.disabled) return;
    if(activeEnhancedSelect && activeEnhancedSelect !== select) closeEnhancedSelect(false);
    activeEnhancedSelect = select;
    const portal = ensureEnhancedSelectPortal();
    portal.hidden = false;
    document.body.classList.add('ws-select-open');
    state.shell.classList.add('is-open');
    state.trigger.setAttribute('aria-expanded', 'true');
    const search = portal.querySelector('.ws-select-search');
    search.value = '';
    renderEnhancedSelectOptions();
    positionEnhancedSelectPanel();
    const focusTarget = portal.querySelector('.ws-select-option.is-selected:not(:disabled)') || portal.querySelector('.ws-select-option:not(:disabled)');
    setTimeout(() => {
        if(search.parentElement.style.display !== 'none') search.focus();
        else if(focusTarget) focusTarget.focus();
    }, 30);
}

function closeEnhancedSelect(returnFocus = false) {
    const select = activeEnhancedSelect;
    const state = select && enhancedSelectState.get(select);
    if(state) {
        state.shell.classList.remove('is-open');
        state.trigger.setAttribute('aria-expanded', 'false');
    }
    if(enhancedSelectPortal) enhancedSelectPortal.hidden = true;
    document.body.classList.remove('ws-select-open');
    activeEnhancedSelect = null;
    if(returnFocus && state && state.trigger.isConnected) state.trigger.focus();
}
window.closeEnhancedSelect = closeEnhancedSelect;

function syncEnhancedSelect(select, rebuildOpenOptions = false) {
    const state = enhancedSelectState.get(select);
    if(!state) return;
    state.trigger.disabled = !!select.disabled;
    state.trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
    state.label.textContent = getWorksheetSelectLabel(select);
    if(activeEnhancedSelect === select && rebuildOpenOptions) renderEnhancedSelectOptions(enhancedSelectPortal.querySelector('.ws-select-search').value);
}

function enhanceWorksheetSelect(select) {
    if(!select || select.dataset.enhancedSelect === 'true' || select.multiple || Number(select.size || 0) > 1) return;
    if(select.dataset.nativeSelect === 'true' || select.dataset.enhanceSelect === 'false' || select.classList.contains('flatpickr-monthDropdown-months') || select.closest('.flatpickr-calendar, [data-i18n-skip]')) return;
    const shell = document.createElement('span');
    shell.className = `ws-select-shell ${isCompactWorksheetSelect(select) ? 'is-compact' : 'is-fluid'}`;
    if(select.style.flex) shell.style.flex = select.style.flex;
    if(select.style.maxWidth) shell.style.maxWidth = select.style.maxWidth;
    if(select.style.width && select.style.width !== '100%') shell.style.width = select.style.width;
    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    select.classList.add('ws-native-select');
    select.dataset.enhancedSelect = 'true';
    select.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ws-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const nativeLabel = select.labels && select.labels.length ? select.labels[0].textContent.trim() : '';
    const accessibleLabel = select.getAttribute('aria-label') || nativeLabel || 'Pilih Opsi';
    trigger.setAttribute('aria-label', accessibleLabel);
    const label = document.createElement('span');
    label.className = 'ws-select-label';
    const chevron = document.createElement('span');
    chevron.className = 'ws-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▼';
    trigger.append(label, chevron);
    // Kelas ikon menempel pada <select> aslinya, sedangkan yang terlihat di
    // layar adalah tombol pengganti ini. Kelasnya diteruskan supaya ikon di
    // dalam kotak tetap tampak setelah select diganti.
    select.classList.forEach(kelas => { if(kelas === 'ico' || kelas.indexOf('ico-') === 0) trigger.classList.add(kelas); });
    shell.appendChild(trigger);

    enhancedSelectState.set(select, { shell, trigger, label });
    trigger.addEventListener('click', () => activeEnhancedSelect === select ? closeEnhancedSelect(false) : openEnhancedSelect(select));
    trigger.addEventListener('keydown', event => {
        if(['Enter',' ','ArrowDown','ArrowUp'].includes(event.key)) {
            event.preventDefault();
            openEnhancedSelect(select);
        }
    });
    select.addEventListener('change', () => syncEnhancedSelect(select));
    select.addEventListener('input', () => syncEnhancedSelect(select));

    const selectObserver = new MutationObserver(() => syncEnhancedSelect(select, true));
    selectObserver.observe(select, { childList:true, subtree:true, attributes:true, attributeFilter:['disabled','selected','label','hidden'] });

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if(valueDescriptor && valueDescriptor.get && valueDescriptor.set) {
        try {
            Object.defineProperty(select, 'value', {
                configurable:true,
                get() { return valueDescriptor.get.call(this); },
                set(value) {
                    valueDescriptor.set.call(this, value);
                    queueMicrotask(() => syncEnhancedSelect(this, activeEnhancedSelect === this));
                }
            });
        } catch(_) {}
    }
    syncEnhancedSelect(select);
}

function enhanceWorksheetSelects(root = document) {
    if(root.nodeType === Node.ELEMENT_NODE && root.matches('select')) enhanceWorksheetSelect(root);
    root.querySelectorAll && root.querySelectorAll('select').forEach(enhanceWorksheetSelect);
}

window.syncAllEnhancedSelects = function(forceRebuild = false) {
    document.querySelectorAll('select[data-enhanced-select="true"]').forEach(select => syncEnhancedSelect(select, forceRebuild));
};

function initializeEnhancedSelects() {
    ensureEnhancedSelectPortal();
    enhanceWorksheetSelects(document);
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(enhanceWorksheetSelects)));
    observer.observe(document.body, { childList:true, subtree:true });
    document.addEventListener('click', event => {
        if(!activeEnhancedSelect) return;
        const state = enhancedSelectState.get(activeEnhancedSelect);
        if(state && !state.shell.contains(event.target) && !enhancedSelectPortal.contains(event.target)) closeEnhancedSelect(false);
    }, true);
    document.addEventListener('keydown', event => {
        if(!activeEnhancedSelect) return;
        if(event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeEnhancedSelect(true);
            return;
        }
        const options = Array.from(enhancedSelectPortal.querySelectorAll('.ws-select-option:not(:disabled)'));
        if(!options.length || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement);
        let nextIndex = currentIndex;
        if(event.key === 'Home') nextIndex = 0;
        else if(event.key === 'End') nextIndex = options.length - 1;
        else if(event.key === 'ArrowDown') nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + 1));
        else nextIndex = Math.max(0, currentIndex < 0 ? options.length - 1 : currentIndex - 1);
        options[nextIndex].focus();
    }, true);
    window.addEventListener('resize', scheduleEnhancedSelectPosition);
    window.addEventListener('scroll', scheduleEnhancedSelectPosition, true);
}

function setProfileMenuOpen(open, options = {}) {
    const menu = document.getElementById('profile-menu');
    const trigger = document.getElementById('profile-menu-trigger');
    if(!menu || !trigger) return false;
    const shouldOpen = !!open;
    menu.hidden = !shouldOpen;
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    trigger.classList.toggle('is-open', shouldOpen);
    if(shouldOpen) {
        applyWorksheetTranslations(menu);
        if(typeof window.syncAllEnhancedSelects === 'function') window.syncAllEnhancedSelects();
    } else if(options.returnFocus && trigger.isConnected) {
        trigger.focus();
    }
    return shouldOpen;
}

window.toggleProfileMenu = function() {
    const menu = document.getElementById('profile-menu');
    return setProfileMenuOpen(!menu || menu.hidden);
};
window.closeProfileMenu = function(returnFocus = false) { return setProfileMenuOpen(false, { returnFocus }); };

function initializeProfileMenu() {
    document.addEventListener('click', event => {
        const shell = document.querySelector('.profile-menu-shell');
        const menu = document.getElementById('profile-menu');
        if(!shell || !menu || menu.hidden || shell.contains(event.target)) return;
        setProfileMenuOpen(false);
    }, true);
    document.addEventListener('keydown', event => {
        const menu = document.getElementById('profile-menu');
        if(event.key !== 'Escape' || !menu || menu.hidden) return;
        event.preventDefault();
        setProfileMenuOpen(false, { returnFocus:true });
    }, true);
}

function initializeWorksheetInterface() {
    if(window.worksheetInterfaceInitialized) return;
    window.worksheetInterfaceInitialized = true;
    initializeWorksheetFont();
    initializeWorksheetLanguage();
    initializeEnhancedSelects();
    initializeProfileMenu();

    const syncMobileNavigation = () => {
        const compact = window.innerWidth <= 850;
        const sidebar = document.querySelector('.sidebar');
        const trigger = document.getElementById('mobile-menu-trigger');
        if(!compact) closeMobileSidebar();
        if(sidebar) sidebar.setAttribute('aria-hidden', compact && !sidebar.classList.contains('active-mobile') ? 'true' : 'false');
        if(trigger) trigger.setAttribute('aria-expanded', compact && sidebar && sidebar.classList.contains('active-mobile') ? 'true' : 'false');
    };
    window.addEventListener('resize', syncMobileNavigation);
    syncMobileNavigation();
}

// ==========================================
// KOTAK PENCARIAN TERPADU (.ws-search)
// Semua kolom pencarian memakai bungkus yang sama sehingga ikon dan tombol
// bersihkan tidak perlu ditulis ulang per layar. Tombol bersihkan hanya
// tampil ketika kolomnya berisi.
// ==========================================
function syncWsSearchState(input) {
    if(!input) return;
    const shell = input.closest('.ws-search');
    if(!shell) return;
    shell.classList.toggle('is-filled', String(input.value || '').length > 0);
}
window.syncWsSearchState = syncWsSearchState;

function refreshAllWsSearchState(root = document) {
    if(!root || !root.querySelectorAll) return;
    root.querySelectorAll('.ws-search > input').forEach(syncWsSearchState);
}
window.refreshAllWsSearchState = refreshAllWsSearchState;

// Handler kolom pencarian ditulis inline (onkeyup/oninput) pada masing-masing
// layar, jadi tombol bersihkan harus menembakkan kedua event tersebut supaya
// tabel ikut dimuat ulang seperti saat pengguna menghapus teksnya sendiri.
window.clearWsSearch = function(trigger) {
    const shell = trigger && trigger.closest ? trigger.closest('.ws-search') : null;
    const input = shell ? shell.querySelector('input') : null;
    if(!input) return;
    if(input.value === '') { input.focus(); return; }
    input.value = '';
    syncWsSearchState(input);
    input.dispatchEvent(new Event('input', { bubbles:true }));
    try {
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true, key:'Backspace' }));
    } catch(err) {
        const legacy = document.createEvent('Event');
        legacy.initEvent('keyup', true, true);
        input.dispatchEvent(legacy);
    }
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.focus();
};

document.addEventListener('input', event => {
    const target = event.target;
    if(target && target.matches && target.matches('.ws-search > input')) syncWsSearchState(target);
}, true);

document.addEventListener('keyup', event => {
    const target = event.target;
    if(target && target.matches && target.matches('.ws-search > input')) syncWsSearchState(target);
}, true);

function bootWorksheetInterface() {
    initializeWorksheetInterface();
    refreshAllWsSearchState();
}

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWorksheetInterface, { once:true });
} else {
    bootWorksheetInterface();
}


