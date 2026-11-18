import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as clientApp, deleteApp as closeClient } from 'firebase/app';
import { getAuth as clientAuth, connectAuthEmulator, signInWithCustomToken, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, getDocFromServer as getDoc, updateDoc } from 'firebase/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { emailCodeService, CODE_LIFETIME, SESSION_LIFETIME } from '../lib/email-otp.ts';

const projectId='demo-overview';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST) || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw Error('Run only with local Firebase emulators.');
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const app=initializeApp({projectId,credential:cert({projectId,clientEmail:'test@demo-overview.iam.gserviceaccount.com',privateKey:privateKey.export({type:'pkcs8',format:'pem'})})});
const db=getFirestore(app), auth=getAuth(app);
const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
const rules=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync('firestore.rules','utf8'),host,port:Number(port)}});
const firebase=clientApp({projectId,apiKey:'test'}), client=clientAuth(firebase);
connectAuthEmulator(client,'http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST,{disableWarnings:true});
let now=Date.now(), code, sends=0, fail=false;
const svc=emailCodeService(db,auth,'emulator-secret-for-auth-integration-tests',async (_email,value)=>{
  if(fail) throw Error('provider refused'); code=value; sends++;
},()=>now);
const login={uid:'otp-owner', email:'otp-owner@example.test',provider:'password',authTime:Math.floor(now/1000)};
const id=randomUUID();
try {
  await auth.createUser({uid:login.uid,email:login.email,password:'Fixture-123456!'});
  const timing=await svc.request(login,id);
  assert.equal(timing.expiresAt-now,300000); assert.equal(timing.resendAt-now,60000);
  assert.match(code,/^\d{6}$/);
  assert.deepEqual(await svc.request(login,id),timing); assert.equal(sends,1);
  await assert.rejects(svc.request(login,id,true),e=>e.status===429);
  const wrong=()=>String((Number(code)+1)%1000000).padStart(6,'0');
  await assert.rejects(svc.verify({...login,authTime:login.authTime+1},id,code));
  await assert.rejects(svc.verify({...login,provider:'google.com'},id,code));
  await assert.rejects(svc.verify(login,randomUUID(),code));
  for(let n=0;n<5;n++)await assert.rejects(svc.verify(login,id,wrong()));
  await assert.rejects(svc.verify(login,id,code));
  now+=60000; await svc.request(login,id,true);
  now+=CODE_LIFETIME; await assert.rejects(svc.verify(login,id,code));
  await svc.request(login,id,true);
  const [first,second]=await Promise.allSettled([svc.verify(login,id,code),svc.verify(login,id,code)]);
  assert.equal([first,second].filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await auth.getUser(login.uid)).emailVerified,true);
  const credential=await signInWithCustomToken(client,[first,second].find(r=>r.status==='fulfilled').value.token);
  const elevated=await credential.user.getIdTokenResult(true);
  assert.equal(elevated.signInProvider,'custom');
  const grant=elevated.claims.overviewOtpSession;
  assert.ok(grant);
  const session=await svc.session(login.uid,login.email,grant,false);
  assert.equal(session.expiresAt-now,SESSION_LIFETIME);
  console.log('PASS signup email verification, exact expiry, cooldown, refresh, attempt limit, challenge binding, single-use redemption and Firebase token refresh');
  const base={email:login.email,email_verified:true,firebase:{sign_in_provider:'custom'},overviewOtpSession:grant};
  const context=(uid,claims)=>rules.authenticatedContext(uid,claims).firestore();
  const owner=context(login.uid,base);
  const project=db.collection('trackerProjects').doc('secured');
  const content={owner:login.uid,members:{[login.uid]:'admin'},invites:{},items:[{id:'p',kind:'Project',name:'Test',parent:null}],revision:0};
  const ref=clientDb=>doc(clientDb,'trackerProjects',project.id);
  await assertSucceeds(setDoc(ref(owner),content));
  await assertSucceeds(updateDoc(ref(owner),{'members.viewer':'viewer'}));
  await assertSucceeds(getDoc(ref(owner)));
  for (const [uid,claims] of [
    [login.uid,{email_verified:true,email:login.email,firebase:{sign_in_provider:'password'},admin:true}],
    [login.uid,{...base,firebase:{sign_in_provider:'google.com'}}],
    [login.uid,{...base,firebase:{sign_in_provider:'phone'}}],
    [login.uid,{...base,overviewOtpSession:randomUUID()}],
    [login.uid,{...base,email_verified:false}],
    [login.uid,{...base,email:'other@example.test'}],
    ['viewer',base],
  ]) {const clientDb=context(uid,claims);await assertFails(getDoc(ref(clientDb)));await assertFails(updateDoc(ref(clientDb),{revision:1}));}
  await assertFails(getDoc(ref(rules.unauthenticatedContext().firestore())));
  await assertFails(setDoc(doc(owner,'_otpSessions',grant),{uid:login.uid}));
  await assertFails(getDoc(doc(owner,'_emailCodes','private')));
  const viewerGrant=randomUUID();
  await db.collection('_otpSessions').doc(viewerGrant).set({uid:'viewer',email:login.email,expiresAt:Date.now()+60000});
  const viewer=context('viewer',{...base,overviewOtpSession:viewerGrant});
  await assertSucceeds(getDoc(ref(viewer)));await assertFails(updateDoc(ref(viewer),{'members.viewer':'admin'}));
  await db.collection('_otpSessions').doc(viewerGrant).update({expiresAt:Date.now()-60000});
  await assertFails(getDoc(ref(context('viewer',{...base,overviewOtpSession:viewerGrant}))));
  await svc.session(login.uid,login.email,grant,true);await signOut(client);
  await assertFails(getDoc(ref(context(login.uid,base))));await assert.rejects(svc.session(login.uid,login.email,grant,false));
  const primary=await signInWithEmailAndPassword(client,login.email,'Fixture-123456!');
  assert.equal((await primary.user.getIdTokenResult(true)).claims.overviewOtpSession,undefined);
  await sendPasswordResetEmail(client,login.email);
  console.log('PASS verified access, membership, primary sign-ins denied, expired/revoked grants denied, private collections, logout, fresh login and password reset');
  const id2=randomUUID();await svc.request(login,id2);
  await svc.cancel(login,id2);await assert.rejects(svc.verify(login,id2,code));
  await assert.rejects(svc.request(login,randomUUID()), e=>e.status===429);
  now+=60000;
  const deliveryId=randomUUID();fail=true;await assert.rejects(svc.request(login,deliveryId),e=>e.status===503);
  fail=false;await assert.rejects(svc.verify(login,deliveryId,code));now+=60000;
  await assert.rejects(svc.request(login,deliveryId,true),e=>e.status===429&&e.retryAt>now);
  console.log('PASS cancelled challenges, failed delivery, account-wide send limit');
}finally{await rules.cleanup();await closeClient(firebase);await db.terminate();await deleteApp(app);}

