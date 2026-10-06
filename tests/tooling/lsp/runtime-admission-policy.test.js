#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assessZlsZigCompatibility, parseObservedToolVersion,
  selectExistingRuntimeCandidate, buildRuntimeSelectionFingerprint } from '../../../src/index/tooling/runtime-admission.js';
import { resolveZlsRuntimeCompatibilityPreflight, resolveEnvironmentPreflight } from '../../../src/index/tooling/lsp-provider/preflight-language.js';

assert.equal(parseObservedToolVersion('unknown'), null);
assert.deepEqual([parseObservedToolVersion('ZLS 0.16.1').major, parseObservedToolVersion('ZLS 0.16.1').minor], [0, 16]);
assert.equal(assessZlsZigCompatibility({ zlsVersionText: '0.16.0', zigVersionText: '0.16.1' }).state, 'admissible');
assert.equal(assessZlsZigCompatibility({ zlsVersionText: '0.16.0', zigVersionText: '0.17.0' }).state, 'incompatible');
assert.equal(assessZlsZigCompatibility({ zlsVersionText: '0.16.0-dev.1', zigVersionText: '0.16.0' }).state, 'incompatible');
assert.equal(assessZlsZigCompatibility({ zlsVersionText: '0.17.0-dev.1', zigVersionText: '0.17.0-dev.2' }).state, 'unverified');
assert.equal(assessZlsZigCompatibility({ zlsVersionText: 'unknown', zigVersionText: '0.16.0' }).semanticVerified, false);

const preferred = { source: 'project', authority: 'allowed', probeOk: false };
const fallback = { source: 'managed', authority: 'allowed', probeOk: true,
  compatibility: { state: 'admissible' } };
assert.equal(selectExistingRuntimeCandidate({ candidates: [preferred, fallback] }).selected, fallback);
assert.equal(selectExistingRuntimeCandidate({ candidates: [preferred, fallback] }).fallbackUsed, true);
assert.equal(selectExistingRuntimeCandidate({ candidates: [preferred, fallback], explicitCommand: true }).selected, null);
assert.equal(selectExistingRuntimeCandidate({ candidates: [preferred, fallback], strictReproducibility: true }).selected, null);
assert.equal(selectExistingRuntimeCandidate({ candidates: [{ ...fallback, authority: 'denied' }, fallback] }).state, 'blocked');
assert.equal(selectExistingRuntimeCandidate({ candidates: [{ ...fallback, source: 'path' }], allowGlobalFallback: false }).selected, null);
assert.equal(selectExistingRuntimeCandidate({ candidates: [], operationRequired: true }).state, 'required-unavailable');
assert.equal(selectExistingRuntimeCandidate({ candidates: [] }).state, 'optional-unavailable');
assert.equal(selectExistingRuntimeCandidate({ candidates: [{ ...fallback, compatibility: null }] }).semanticVerified, false);
assert.equal(selectExistingRuntimeCandidate({ candidates: [{ ...fallback, compatibility: { state: 'incompatible', reasonCode: 'version_mismatch' } }] }).selected, null);

const identity = { canonicalPath: '/owned/tool', size: 10, mtimeMs: 1, contentOrPackageDigest: 'a'.repeat(64) };
const selected = { ...fallback, observedVersion: '0.16.0', identity };
const fingerprint = buildRuntimeSelectionFingerprint({ selected, identityComplete: true });
assert.equal(typeof fingerprint, 'string');
assert.equal(buildRuntimeSelectionFingerprint({ selected, identityComplete: false }), null);
assert.notEqual(buildRuntimeSelectionFingerprint({ selected: { ...selected, observedVersion: '0.16.1' }, identityComplete: true }), fingerprint);
assert.notEqual(buildRuntimeSelectionFingerprint({ selected: { ...selected, source: 'project' }, identityComplete: true }), fingerprint);
assert.notEqual(buildRuntimeSelectionFingerprint({ selected, identityComplete: true, sdkPins: [{ id: 'zig', digest: 'b'.repeat(64) }] }), fingerprint);
const pairPreflight = (zls, zig) => resolveZlsRuntimeCompatibilityPreflight({
  server: { id: 'zls', cmd: 'zls' }, commandProfile: { probe: { ok: true, versionText: zls } },
  runtimeProfiles: [{ id: 'zig', commandProfile: { probe: { ok: true, versionText: zig } } }] });
const mismatch = pairPreflight('0.16.0', '0.17.0');
assert.equal(mismatch.state, 'blocked');
assert.equal(mismatch.blockProvider, true);
assert.equal(resolveEnvironmentPreflight({ state: 'degraded', reasonCode: 'runtime_missing' }, mismatch).blockProvider, true);
assert.equal(pairPreflight('0.16.0', '0.16.1').state, 'ready');
assert.equal(pairPreflight('unknown', '0.16.1').state, 'degraded');
assert.equal(resolveZlsRuntimeCompatibilityPreflight({ server: { id: 'different-zig-server', cmd: 'different-server', languages: ['zig'] } }).state, 'ready');
console.log('runtime admission policy metadata cases passed');
