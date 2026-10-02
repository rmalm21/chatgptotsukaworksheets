import { createFirestoreRepository } from './firestore-repository.js';

export function withTimeout(promise, milliseconds, message = 'Koneksi terlalu lama.') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { const error = new Error(message); error.code = 'app/timeout'; reject(error); }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createAuthSession({ appSDK, authSDK, firestoreSDK }, config, authChanged) {
  const app = appSDK.getApps().find(item => item.name === '[DEFAULT]') || appSDK.initializeApp(config.firebaseConfig);
  let auth, db;
  try {
    // LocalStorage lebih ringan untuk halaman yang ditanam di tab Website Teams.
    auth = authSDK.initializeAuth(app, { persistence: [authSDK.browserLocalPersistence, authSDK.inMemoryPersistence] });
  } catch (error) {
    if (error.code !== 'auth/already-initialized') throw error;
    auth = authSDK.getAuth(app);
  }
  try { db = firestoreSDK.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); }
  catch (error) { if (error.code !== 'failed-precondition') throw error; db = firestoreSDK.getFirestore(app); }
  let generation = 0, alive = true, signingIn = false;
  const initialTimer = setTimeout(() => {
    if (alive) { const error = new Error('Sesi belum bisa dibaca. Coba sambungkan lagi.'); error.code = 'app/timeout'; authChanged({ connectionError: true, error }); }
  }, 15000);
  const emit = session => { if (alive) authChanged(session); };
  const stopAuth = authSDK.onAuthStateChanged(auth, async user => {
    clearTimeout(initialTimer);
    const current = ++generation;
    if (!user) { emit(null); return; }
    try {
      const snapshot = await withTimeout(firestoreSDK.getDocFromServer(firestoreSDK.doc(db, 'workspaces', config.workspaceId, 'members', user.uid)), 15000, 'Profil tim belum terbaca. Coba sambungkan lagi.');
      if (!alive || current !== generation) return;
      const member = snapshot.exists() ? snapshot.data() : null;
      if (!member || member.active !== true || !['requester', 'poster'].includes(member.role) || typeof member.displayName !== 'string' || !member.displayName.trim() || member.displayName.length > 80) {
        emit({ denied: true, uid: user.uid, email: user.email }); return;
      }
      const actor = { uid: user.uid, email: user.email, displayName: member.displayName, role: member.role };
      emit({ actor, repository: createFirestoreRepository(firestoreSDK, db, config.workspaceId, actor) });
    } catch (error) {
      if (alive && current === generation) emit({ connectionError: true, uid: user.uid, error });
    }
  }, error => { generation++; clearTimeout(initialTimer); emit({ connectionError: true, error }); });
  return {
    async login(email, password, remember = true) {
      if (signingIn) return;
      signingIn = true;
      try {
        await authSDK.setPersistence(auth, remember ? authSDK.browserLocalPersistence : authSDK.inMemoryPersistence);
        return await authSDK.signInWithEmailAndPassword(auth, email, password);
      } finally { signingIn = false; }
    },
    logout: () => authSDK.signOut(auth),
    resetPassword: email => authSDK.sendPasswordResetEmail(auth, email),
    destroy: () => { alive = false; generation++; clearTimeout(initialTimer); stopAuth(); }
  };
}
