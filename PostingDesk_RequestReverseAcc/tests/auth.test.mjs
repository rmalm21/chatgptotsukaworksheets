import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSession, withTimeout } from '../public/auth-session.js';

function fixture(profile = {active:true,role:'requester',displayName:'Bing'}) {
  let observer, failure;
  const events=[], persistence=[], signIns=[], auth={};
  const modules={
    appSDK:{getApps:()=>[{name:'[DEFAULT]'}], initializeApp:()=>{throw new Error('duplicate app')}},
    authSDK:{
      browserLocalPersistence:'LOCAL',inMemoryPersistence:'NONE',
      initializeAuth:()=>auth,getAuth:()=>auth,
      onAuthStateChanged:(_, next, fail)=>{observer=next;failure=fail;return()=>{};},
      setPersistence:async(_,value)=>persistence.push(value),
      signInWithEmailAndPassword:async(_,email,password)=>{signIns.push({email,password});return {user:{uid:'bing'}};},
      signOut:async()=>observer(null), sendPasswordResetEmail:async()=>{}
    },
    firestoreSDK:{
      initializeFirestore:()=>({}),getFirestore:()=>({}),doc:()=>({}),collection:()=>({}),
      getDocFromServer:async()=>({exists:()=>Boolean(profile),data:()=>profile})
    }
  };
  const config={firebaseConfig:{},workspaceId:'posting-team'};
  const session=createAuthSession(modules,config,value=>events.push(value));
  return {modules,config,session,events,persistence,signIns,observe:value=>observer(value),fail:error=>failure(error)};
}

test('remember me chooses persistent login; unchecked login uses memory only', async () => {
  const f=fixture();
  try {
    await f.observe(null);
    await f.session.login('bing@example.com','test-password',true);
    await f.session.login('bing@example.com','test-password',false);
    assert.deepEqual(f.persistence,['LOCAL','NONE']); assert.equal(f.signIns.length,2);
  } finally { f.session.destroy(); }
});

test('restored session signs in automatically after validating active membership', async () => {
  const f=fixture();
  try {
    await f.observe({uid:'bing',email:'bing@example.com'});
    assert.equal(f.events[0].actor.uid,'bing'); assert.equal(f.events[0].actor.displayName,'Bing');
    assert.equal(f.signIns.length,0); assert.equal(typeof f.events[0].repository.editRequest,'function');
    await f.session.logout(); assert.equal(f.events.at(-1),null);
  } finally { f.session.destroy(); }
});

test('membership errors are recoverable connection errors, and old results cannot reactivate a signed-out session', async () => {
  const f=fixture();
  try {
    let finish;
    f.modules.firestoreSDK.getDocFromServer=()=>new Promise(resolve=>{finish=resolve;});
    const pending=f.observe({uid:'bing'}); await f.observe(null);
    finish({exists:()=>true,data:()=>({active:true,role:'requester',displayName:'Bing'})}); await pending;
    assert.deepEqual(f.events,[null]);
    f.modules.firestoreSDK.getDocFromServer=async()=>{throw new Error('network unavailable');};
    await f.observe({uid:'bing'}); assert.equal(f.events.at(-1).connectionError,true); assert.equal(f.events.at(-1).denied,undefined);
  } finally { f.session.destroy(); }
});

test('missing member cannot auto-login; duplicate initialization safely reuses Firebase instances', async () => {
  const f=fixture(null);
  try {
    await f.observe({uid:'bing'}); assert.equal(f.events[0].denied,true);
    f.session.destroy();
    f.modules.authSDK.initializeAuth=()=>{throw Object.assign(new Error('already initialized'),{code:'auth/already-initialized'});};
    f.modules.firestoreSDK.initializeFirestore=()=>{throw Object.assign(new Error('already initialized'),{code:'failed-precondition'});};
    const again=createAuthSession(f.modules,f.config,()=>{}); again.destroy();
  } finally { f.session.destroy(); }
});

test('slow loading ends with a timeout instead of leaving the login in an endless spinner', async () => {
  await assert.rejects(withTimeout(new Promise(()=>{}),5,'SDK timeout'),error=>error.code==='app/timeout');
  assert.equal(await withTimeout(Promise.resolve(7),20),7);
});
