import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { downloadOfficialGitHubRelease } from '../../../tools/tooling/official-release-download.js';
import { downloadToBuffer, settleInstallDownload, isInstallDownloadSession } from '../../../tools/tooling/install-shared.js';

// UNVALIDATED: inert response protocols/Node Readables; no network or children.
const url = 'https://github.com/clangd/clangd/releases/download/fixture/archive.zip';
const request = { url, maxBytes: 64, timeoutMs: 1000, settlementTimeoutMs: 5 };
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
let completeDestroy, announceDestroy, calls = 0;
const destroying = new Promise(resolve => { announceDestroy = resolve; });
const body = new Readable({ read() {}, destroy(_error, callback) { completeDestroy = callback; announceDestroy(); } });
const downloading = downloadOfficialGitHubRelease({ ...request, fetchImpl: async () => {
  calls++; return { status: 302, headers: new Map([['location', 'https://release-assets.githubusercontent.com/fixture']]), body };
} });
await destroying;
let failure;
try { await downloading; } catch (error) { failure = error; }
assert.equal(calls, 1, 'a redirect cannot admit another request before native response close');
assert.equal(failure.reason, 'official_release_http_error');
assert.equal(isInstallDownloadSession(failure.downloadSession), true);
assert.equal(failure.cacheOwnershipReleased(), false);
completeDestroy();
await settleInstallDownload(failure);
assert.equal(failure.cacheOwnershipReleased(), true);
assert.equal(calls, 1, 'settlement does not replay or silently continue a failed request');

let redirects = 0;
const successful = await downloadOfficialGitHubRelease({ ...request, fetchImpl: async (_url, options) => {
  assert.equal(options.redirect, 'manual');
  assert.deepEqual(Object.keys(options.headers), ['accept']);
  redirects++;
  return redirects === 1 ? { status: 302, headers: new Map([['location', 'https://release-assets.githubusercontent.com/fixture']]),
    body: { async cancel() { assert.equal(redirects, 1); } } }
    : { ok: true, status: 200, headers: new Map(), body: (async function* () { yield Buffer.from('inert'); })() };
} });
assert.equal(successful.body.toString(), 'inert');
assert.equal(successful.sourceUrl, url);
assert.equal(redirects, 2);

let deniedCalls = 0;
await assert.rejects(downloadOfficialGitHubRelease({ ...request, fetchImpl: async () => {
  deniedCalls++; return { status: 302, headers: new Map([['location', 'https://unapproved.invalid/archive']]), body: { async cancel() {} } };
} }), error => error.reason === 'official_release_origin_rejected');
assert.equal(deniedCalls, 1);

for (const reason of ['__proto__', 'constructor', 'toString']) {
  const original = Object.assign(new Error('independent provider failure'), { reason });
  await assert.rejects(downloadOfficialGitHubRelease({ ...request,
    fetchImpl: async () => { throw original; } }), error => error === original && error.reason === reason,
  'only declared own download reasons are remapped');
}

for (const marker of [true, false, undefined]) {
  let confirmed = false;
  const primary = Object.freeze(Object.assign(new Error('frozen independent fetch owner'), {
    ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
    cacheOwnershipReleased() { return this === primary && confirmed; } }));
  let pending;
  try { await downloadOfficialGitHubRelease({ ...request, fetchImpl: async () => { throw primary; } }); } catch (error) { pending = error; }
  assert.equal(contains(pending, primary), true);
  assert.equal(isInstallDownloadSession(pending.downloadSession), true,
    'an original pending owner survives even when response disposal itself succeeds');
  assert.equal(pending.downloadSession.isSettled(), false);
  await assert.rejects(settleInstallDownload(pending));
  confirmed = true;
  await settleInstallDownload(pending);
  assert.equal(pending.cacheOwnershipReleased(), true);
}
for (const observation of ['missing', 'throwing']) {
  const primary = Object.freeze(Object.assign(new Error('unknown fetch owner'), { cacheOwnershipPending: true,
    ...(observation === 'throwing' ? { cacheOwnershipReleased() { throw new Error('unknown native close'); } } : {}) }));
  let pending;
  try { await downloadToBuffer({ ...request, fetchImpl: async () => { throw primary; } }); } catch (error) { pending = error; }
  await assert.rejects(settleInstallDownload(pending));
  assert.equal(pending.cacheOwnershipReleased(), false);
}
for (const value of [0, null, false]) {
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => { throw value; } }), error => {
    assert.equal(error.reason, 'download_network_error');
    assert.equal(error.cause, value, 'falsey native values remain the exact cause');
    assert.equal(error.downloadSession, undefined, 'a falsey rejection is not a fabricated native close failure');
    return true;
  });
}
const controller = new AbortController();
let cancellations = 0, released = 0;
await assert.rejects(downloadToBuffer({ ...request, signal: controller.signal, fetchImpl: async () => ({ ok: true, status: 200,
  headers: new Map(), body: { getReader: () => ({ read: async () => { controller.abort(0); throw 0; },
    cancel: async reason => { assert.equal(reason, 0); cancellations++; }, releaseLock: () => { released++; } }) } }) }),
error => error.cause === 0 && error.downloadSession === undefined);
assert.equal(cancellations, 1); assert.equal(released, 1);
let inspectedClosed = false;
const inspection = Object.freeze(Object.assign(new Error('frozen pending classification owner'), { cacheOwnershipPending: true,
  cacheOwnershipReleased() { return this === inspection && inspectedClosed; } }));
const primary = new Error('original fetch failure');
Object.defineProperty(primary, 'message', { get() { throw inspection; } });
Object.freeze(primary);
let unreadable;
try { await downloadToBuffer({ ...request, fetchImpl: async () => { throw primary; } }); } catch (error) { unreadable = error; }
assert.equal(contains(unreadable, primary), true);
assert.equal(contains(unreadable, inspection), true);
assert.equal(unreadable.downloadInspectionErrors[0], inspection);
await assert.rejects(settleInstallDownload(unreadable));
inspectedClosed = true;
await settleInstallDownload(unreadable);
assert.equal(unreadable.cacheOwnershipReleased(), true);

let forgedCalls = 0;
await assert.rejects(settleInstallDownload({ cacheOwnershipReleased: () => true, downloadSession: {
  resourceId: 'copied-fields', isSettled: () => true, releaseAfterClosure: async () => {
    forgedCalls++; return { resourceId: 'copied-fields', settled: true, pending: false };
  } } }), /actual response resource owner/);
assert.equal(forgedCalls, 0);
console.log('Official release requests retain shared exact response/native ownership across redirects.');
