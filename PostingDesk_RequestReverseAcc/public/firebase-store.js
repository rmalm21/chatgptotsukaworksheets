import { createAuthSession, withTimeout } from './auth-session.js';

const SDK_VERSION = '12.19.0';

export async function connectFirebase(config, authChanged) {
  const [appSDK, authSDK, firestoreSDK] = await withTimeout(Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
  ]), 25000, 'Firebase terlalu lama dimuat. Coba sambungkan lagi.');
  return createAuthSession({ appSDK, authSDK, firestoreSDK }, config, authChanged);
}
