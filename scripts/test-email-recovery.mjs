import assert from 'node:assert/strict';

const values = new Map();
globalThis.sessionStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
const state = await import('../lib/email-code-state.ts');
const login = JSON.stringify(['user-id', 'password', 100]);
const id = state.challengeId(login);
assert.equal(state.challengeId(login), id);
const restored = await import('../lib/email-code-state.ts?refresh');
assert.equal(restored.challengeId(login), id);
const different = restored.challengeId(JSON.stringify(['user-id','password',101]));
assert.notEqual(different, id);
assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])).sort(), ['id','login']);
restored.clearChallenge();
assert.equal(values.size, 0);
values.set('overview:email-challenge', JSON.stringify({login,id:'-'.repeat(36)}));
assert.notEqual(restored.challengeId(login), '-'.repeat(36));
restored.clearChallenge();
values.set('overview:email-challenge', 'invalid JSON');
assert.doesNotThrow(() => restored.challengeId(login));
globalThis.sessionStorage = {
  getItem() { throw Error('Storage unavailable'); },
  setItem() { throw Error('Storage unavailable'); },
  removeItem() { throw Error('Storage unavailable'); },
};
restored.clearChallenge();
assert.equal(restored.challengeId(login), restored.challengeId(login));
console.log('PASS refresh recovery, per-login isolation, cleanup, malformed and unavailable storage');
