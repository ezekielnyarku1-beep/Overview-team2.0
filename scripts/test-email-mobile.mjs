import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { chromium } from 'playwright';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-overview';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
const live = process.argv.includes('--live-resend');
const liveRecipient = process.env.OVERVIEW_TEST_RECIPIENT;
const mail = live ? parseEnv(await readFile('.env.local','utf8')) : {};
if (live) {
  assert.ok(liveRecipient && /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(liveRecipient),'Specify one authorized test recipient.');
  assert.ok(mail.RESEND_API_KEY?.startsWith('re_') && mail.EMAIL_FROM,'Set the server sending key and sender.');
}
const folder = await mkdtemp(path.join(tmpdir(), 'overview-otp-'));
const outbox = [];
const nativeFetch = globalThis.fetch;
const admin = initializeApp({projectId}, 'mobile-test');
const db = getFirestore(admin);
let app, server, browser;
try {
  // Run the actual application in an isolated directory with disposable keys.
  for (const name of ['app','components','lib','tsconfig.json','package.json','next.config.ts']) {
    await cp(name, path.join(folder,name), {recursive:true});
  }
  await symlink(await realpath('node_modules'), path.join(folder,'node_modules'), 'junction');
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
  Object.assign(process.env, {
    GCLOUD_PROJECT: projectId, NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com',
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true', NEXT_PUBLIC_FIREBASE_APP_ID: 'mobile-fixture',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key', RESEND_API_KEY: live ? mail.RESEND_API_KEY : 're_local_fixture',
    EMAIL_OTP_SECRET: randomUUID(), EMAIL_FROM: live ? mail.EMAIL_FROM : 'Overview <mail@example.test>',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({project_id:projectId,
      client_email:'test@demo-overview.iam.gserviceaccount.com',
      private_key:privateKey.export({type:'pkcs8',format:'pem'})}),
  });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? input.toString();
    if (new URL(url).hostname !== 'api.resend.com') return nativeFetch(input, init);
    const request = new Request(input, init);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.ok(request.headers.get('authorization') === 'Bearer ' + process.env.RESEND_API_KEY);
    const message = await request.clone().json();
    if (live) {
      assert.ok(message.to === liveRecipient && outbox.length === 0,'Live smoke test permits exactly one authorized recipient and one send.');
    } else assert.match(message.to, /@example\.test$/);
    const code = message.text.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    outbox.push({email:message.to, code});
    if (live) {
      const result = await nativeFetch(request);
      assert.ok(result.ok, 'Resend delivery request returned HTTP ' + result.status);
      const accepted = await result.clone().json();
      assert.ok(accepted.id);
      console.log('Live Resend message ID ' + accepted.id);
      return result;
    }
    return Response.json({id:randomUUID()});
  };
  const next = (await import('next')).default;
  app = next({dir:folder, dev:true, webpack:true, hostname:'localhost'});
  await app.prepare();
  server = createServer(app.getRequestHandler());
  server.listen(0,'localhost');
  await once(server,'listening');
  const origin = 'http://localhost:' + server.address().port;
  const chrome = process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch(existsSync(chrome) ? {executablePath:chrome} : {});
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const actions = action => page.waitForResponse(response => response.url().endsWith('/api/auth/email-code')
    && response.request().postDataJSON()?.action === action);
  const signIn = page.getByRole('heading',{name:'Sign in',exact:true});
  const projects = page.getByRole('heading',{name:'Projects',exact:true});
  const digits = page.getByLabel('Verification code');
  async function submit(code) {
    await digits.fill(code);
    const verified = actions('verify');
    await page.getByRole('button',{name:'Verify and continue'}).click();
    return (await verified).status();
  }
  const email = live ? liveRecipient : 'mobile-' + randomUUID() + '@example.test';
  const password = 'Mobile-Fixture-123';
  await page.goto(origin + '/sign-up', {waitUntil:'domcontentloaded'});
  await page.getByLabel('Email address').fill(email);
  await page.locator('#account-password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  let sent = actions('start');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  let response = await sent;
  assert.equal(response.status(),200,await response.text());
  const start = await response.json();
  assert.equal(start.expiresAt-start.resendAt,240000);
  assert.equal(outbox.length,1);
  assert.equal(await projects.count(),0);
  if (live) {
    assert.equal(await submit(outbox[0].code),200);
    await projects.waitFor();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await signIn.waitFor();
    console.log('PASS actual Resend transport accepted the signup OTP; the emulator session redeemed that code, opened the workspace and signed out');
  } else {
    assert.equal(await page.getByRole('button',{name:/Resend in/}).isDisabled(),true);
    const token = (await response.request().allHeaders()).authorization;
    const id = response.request().postDataJSON().id;
    const api = (action, props, authorization, requestOrigin=origin) => context.request.post(origin+'/api/auth/email-code',{
      headers:{origin:requestOrigin,...(authorization?{authorization}:{})},data:{action,...props}});
    assert.equal((await api('session',{},token)).status(),403);
    assert.equal((await api('verify',{id,code:'000000'})).status(),401);
    assert.equal((await api('resend',{id},token)).status(),429);
    assert.equal((await api('start',{id},token,'https://other.example')).status(),403);
    assert.equal((await api('resend',{id,extra:'x'.repeat(2048)},token)).status(),413);
    assert.equal((await api('verify',{id,code:'123'},token)).status(),400);
    const wrong = String((Number(outbox[0].code)+1)%1000000).padStart(6,'0');
    assert.equal(await submit(wrong),400);
    await page.getByRole('alert').filter({hasText:'incorrect'}).waitFor();
    sent = actions('start');
    await page.reload({waitUntil:'domcontentloaded'});
    assert.deepEqual(await (await sent).json(),start);
    assert.equal(outbox.length,1);
    assert.equal(await digits.inputValue(),'');
    // Age the disposable server record to test expiry without a five-minute sleep.
    const records = await db.collection('_emailCodes').where('email','==',email).get();
    assert.equal(records.size,1);
    await records.docs[0].ref.update({expiresAt:Date.now()-1,resendAt:Date.now()-1});
    assert.equal(await submit(outbox[0].code),400);
    sent = actions('start');
    await page.reload({waitUntil:'domcontentloaded'});
    await sent;
    await page.getByText('This code has expired.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Verify and continue'}).isDisabled(),true);
    sent = actions('resend');
    await page.getByRole('button',{name:'Resend code',exact:true}).click();
    assert.equal((await sent).status(),200);
    assert.equal(outbox.length,2);
    assert.notEqual(outbox[0].code,outbox[1].code);
    assert.equal(await submit(outbox[0].code),400);
    await mkdir('qa-artifacts',{recursive:true});
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:width===390?844:568});
      await page.emulateMedia({reducedMotion:width===320?'reduce':'no-preference'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box = await digits.boundingBox();
      assert.ok(box.width>=180 && box.height>=44);
      assert.equal(await digits.getAttribute('autocomplete'),'one-time-code');
      assert.equal(await digits.getAttribute('inputmode'),'numeric');
      await page.screenshot({path:'qa-artifacts/email-otp-'+width+'.png',fullPage:true});
    }
    assert.equal(await submit(outbox[1].code),200);
    await projects.waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await projects.waitFor();
    assert.equal(outbox.length,2);
    const closed = actions('logout');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    const logout = await closed;
    assert.equal(logout.status(),200);
    assert.equal((await api('session',{},(await logout.request().allHeaders()).authorization)).status(),401);
    await signIn.waitFor();
    await page.getByLabel('Email address').fill(email);
    await page.locator('#account-password').fill(password);
    sent = actions('start');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    assert.equal((await sent).status(),200);
    assert.equal(outbox.length,3);
    await page.getByRole('heading',{name:'Check your inbox'}).waitFor();
    assert.equal(await projects.count(),0);
    assert.equal(await submit(outbox[2].code),200);
    await projects.waitFor();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await signIn.waitFor();
    console.log('PASS mobile password signup/sign-in, wrong/expired/replaced codes, cooldown, pending and verified refresh, fresh login, server logout, access denials, 320px/390px layouts');
    const googleEmail = 'google-' + randomUUID() + '@example.test';
    const popupCreated = page.waitForEvent('popup');
    await page.getByRole('button',{name:'Continue with Google'}).click();
    const popup = await popupCreated;
    await popup.waitForURL('http://127.0.0.1:9199/**');
    await popup.locator('#add-account-button').click();
    await popup.locator('#email-input').fill(googleEmail);
    sent = actions('start');
    await popup.locator('#sign-in').click();
    response = await sent;
    assert.equal(response.status(),200,await response.text());
    assert.equal(outbox.at(-1).email,googleEmail);
    assert.equal(await projects.count(),0);
    assert.equal(await submit(outbox.at(-1).code),200);
    await projects.waitFor();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await signIn.waitFor();
    const secondPopup = page.waitForEvent('popup');
    await page.getByRole('button',{name:'Continue with Google'}).click();
    const choose = await secondPopup;
    await choose.waitForURL('http://127.0.0.1:9199/**');
    sent = actions('start');
    await choose.getByText(googleEmail,{exact:true}).click();
    assert.equal((await sent).status(),200);
    assert.equal(outbox.filter(message=>message.email===googleEmail).length,2);
    assert.equal(await projects.count(),0);
    const cancelled = actions('cancel');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    const cancellation = await cancelled;
    assert.equal(cancellation.status(),200);
    await signIn.waitFor();
    assert.equal((await api('verify',{id:cancellation.request().postDataJSON().id,code:outbox.at(-1).code},
      (await cancellation.request().allHeaders()).authorization)).status(),400);
    console.log('PASS mobile Google sign-in via Auth Emulator, mandatory OTP on repeat login, workspace access, pending cancellation and logout');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  server?.closeAllConnections();
  if(server?.listening) await new Promise(resolve=>server.close(resolve));
  globalThis.fetch = nativeFetch;
  await db.terminate();
  await deleteApp(admin);
  await rm(folder,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
process.exit(process.exitCode ?? 0);

