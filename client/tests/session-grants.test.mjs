import test from 'node:test';
import assert from 'node:assert/strict';
import { guestKey } from '../src/auth/guest-key.ts';
import { makeSessionGrant, implicitPublicKey } from '../src/auth/session-grants.ts';
import { sessionGrantBytes } from '../../shared/src/sessionGrant.ts';

test('the device restores its own guest key and signs contract-bound session hashes', async () => {
  const previous=globalThis.localStorage;
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  try {
    const guest=await guestKey();
    const restored=await guestKey();
    assert.match(guest.accountId,/^[a-f0-9]{64}$/);
    assert.equal(restored.accountId,guest.accountId);
    const signed=await makeSessionGrant(guest.accountId,implicitPublicKey(guest.accountId),'chroma.testnet',{CHROMA:'40'},restored.signHash);
    const bytes=Uint8Array.from(guest.accountId.match(/../g),hex=>parseInt(hex,16));
    const key=await crypto.subtle.importKey('raw',bytes,'Ed25519',false,['verify']);
    const hash=await crypto.subtle.digest('SHA-256',sessionGrantBytes(signed.payload));
    assert.ok(await crypto.subtle.verify('Ed25519',key,Buffer.from(signed.signature,'base64'),hash));
    assert.equal(signed.payload.recipient,'chroma.testnet');
    assert.equal(JSON.parse(signed.payload.message).caps.CHROMA,'40');
    assert.equal(Object.hasOwn(signed,'private_key'),false);
  } finally { if(previous===undefined) delete globalThis.localStorage;else globalThis.localStorage=previous; }
});

test('a new session gets a new nonce and extends expiry', async () => {
  const originalNow=Date.now;
  try {
    const sign=async()=>new Uint8Array(64);
    const holder='a'.repeat(64);
    Date.now=()=>1000;
    const first=await makeSessionGrant(holder,implicitPublicKey(holder),'items.testnet',{potion:'4'},sign);
    Date.now=()=>100000;
    const next=await makeSessionGrant(holder,implicitPublicKey(holder),'items.testnet',{potion:'4'},sign);
    assert.notDeepEqual(first.payload.nonce,next.payload.nonce);
    assert.ok(BigInt(JSON.parse(next.payload.message).expires_at)>BigInt(JSON.parse(first.payload.message).expires_at));
  } finally { Date.now=originalNow; }
});
