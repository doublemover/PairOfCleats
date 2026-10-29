import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { normalizeRiskConfig, detectRiskSignals } from '../../../../src/index/risk.js';
import { getRiskRulesPolicyReceipt, serializeRiskRulesBundle } from '../../../../src/index/risk-rule-receipt.js';
import { projectFileAnalysisRisk, restoreFileAnalysisRisk } from '../../../../src/index/build/workers/file-analysis-risk.js';
import { buildDependencySignatures, buildIncrementalSignature, SIGNATURE_VERSION } from '../../../../src/index/build/indexer/signatures.js';
import { shouldReuseIncrementalIndex } from '../../../../src/index/build/incremental/planning.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { getContainedFileSession } from '../../../../src/shared/contained-file-resource.js';

const { dir: root } = await prepareIsolatedTestCacheDir('risk-external-policy-admission');
const file = path.join(root, 'rules.json');
const policy = letter => ({ sources: [{ id: 'source.' + letter, name: 'source', patterns: ['SOURCE_' + letter] }],
  sinks: [{ id: 'sink.' + letter, name: 'sink', patterns: ['SINK'] }], sanitizers: [] });
const text = 'const value = SOURCE_A;\nSINK(value);';
const raw = { rules: { includeDefaults: false, rulesPath: file }, caps: { maxMs: 1000 } };
const load = (extra = {}, options = {}) => normalizeRiskConfig({ ...raw, ...extra }, { rootDir: root, ...options });
const detect = config => detectRiskSignals({ text, config });
const runtime = config => ({ languageOptions: {}, indexingConfig: { riskRules: raw.rules }, riskConfig: config });
const deps = config => buildDependencySignatures(runtime(config), 'code', 'tokens');
const find = (error, predicate) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (predicate(value)) return value;
    pending.push(value.cause, ...(value.errors || []));
  }
  return null;
};
await fsp.writeFile(file, JSON.stringify(policy('A')));
const admitted = load(), identity = getRiskRulesPolicyReceipt(admitted.rules);
assert.equal(identity, getRiskRulesPolicyReceipt(admitted.rules), 'one admitted build reuses its private computed receipt');
const originalBytes = await fsp.readFile(file);
assert.equal(admitted.rules.inputReceipt.byteHash, createHash('sha256').update(originalBytes).digest('hex'));
assert.equal(admitted.rules.inputReceipt.byteLength, originalBytes.length);
assert.equal(admitted.rules.inputReceipt.outcome, 'complete');
assert.ok(detect(admitted).flows.some(flow => flow.ruleIds.includes('source.A')));
const projected = structuredClone(projectFileAnalysisRisk(admitted));
const worker = restoreFileAnalysisRisk(projected);
assert.deepEqual(getRiskRulesPolicyReceipt(worker.rules), identity);
assert.deepEqual(detect(worker), detect(admitted), 'worker and inline execution consume the exact same admitted policy');

const before = await fsp.stat(file); await fsp.writeFile(file, JSON.stringify(policy('B')));
await fsp.utimes(file, before.atime, before.mtime);
assert.equal((await fsp.stat(file)).size, originalBytes.length);
assert.ok(detect(admitted).flows.length, 'an edit cannot change the policy already admitted to this build');
const changed = load();
assert.equal(detect(changed)?.flows.length || 0, 0);
assert.notDeepEqual(getRiskRulesPolicyReceipt(changed.rules), identity);
assert.equal(deps(changed).parse, deps(admitted).parse); assert.equal(deps(changed).lexical, deps(admitted).lexical);
assert.notEqual(deps(changed).enrichment, deps(admitted).enrichment);
assert.notEqual(buildIncrementalSignature(runtime(changed), 'code', 'tokens'), buildIncrementalSignature(runtime(admitted), 'code', 'tokens'));
const logs = [];
assert.equal(await shouldReuseIncrementalIndex({ repoRoot: root, outDir: root, entries: [{ rel: 'unchanged.js' }],
  manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, signatureVersion: SIGNATURE_VERSION,
    dependencySignatures: deps(changed), files: { 'unchanged.js': { dependencySignatures: deps(admitted) } } },
  log: message => logs.push(message), explain: true }), false);
assert.ok(logs.some(message => message.includes('per-file dependencies changed')));
assert.deepEqual(deps(load()), deps(changed), 'unchanged effective input preserves dependency-qualified reuse');
const lower = load({ regex: { flags: 'i' } }), sensitive = load({ regex: { flags: '' } });
assert.notEqual(deps(lower).enrichment, deps(sensitive).enrichment);
assert.equal(deps(lower).parse, deps(sensitive).parse); assert.equal(deps(lower).lexical, deps(sensitive).lexical);
const lowerText = 'const value = source_b;\nSINK(value);';
assert.ok(detectRiskSignals({ text: lowerText, config: lower }).flows.length);
assert.equal(detectRiskSignals({ text: lowerText, config: sensitive })?.flows.length || 0, 0);
assert.deepEqual(serializeRiskRulesBundle(changed.rules).inputReceipt, changed.rules.inputReceipt);
const defaults = normalizeRiskConfig({});
assert.equal(defaults.rules.inputReceipt.outcome, 'not-configured'); assert.ok(defaults.rules.sources.length);
await fsp.writeFile(file, JSON.stringify({ sources: [], sinks: [], sanitizers: [] }));
const empty = load(); assert.equal(empty.rules.inputReceipt.outcome, 'complete'); assert.equal(empty.rules.sources.length, 0);
assert.equal(detect(empty)?.flows.length || 0, 0, 'intentional empty input remains distinct from missing/invalid input');
for (const [contents, reason] of [['{', 'invalid-json'], ['[]', 'invalid-schema'], ['{}', 'invalid-schema'],
  [JSON.stringify({ sources: {} }), 'invalid-schema'], [JSON.stringify({ sources: [{ name: 'bad', patterns: [1] }] }), 'invalid-schema'],
  [JSON.stringify({ sources: Array.from({ length: 4097 }, () => ({ name: 'x', patterns: ['x'] })) }), 'rule-budget']]) {
  await fsp.writeFile(file, contents);
  assert.throws(load, error => error.riskRuleInput?.reason === reason && error.riskRuleInput.requested === true);
}
await fsp.rm(file);
for (const includeDefaults of [true, false]) assert.throws(() => load({ rules: { ...raw.rules, includeDefaults } }),
  error => error.riskRuleInput?.reason === 'missing', 'a requested file cannot silently fall back');
await fsp.writeFile(file, JSON.stringify(policy('A')));

const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync, originalStat = fs.fstatSync;
const descriptors = new Set(); let behavior = {}, reads = 0;
const same = target => path.relative(path.resolve(String(target)), file) === '';
try {
  fs.openSync = (target, ...args) => {
    if (same(target) && behavior.openError) throw behavior.openError;
    const fd = originalOpen.call(fs, target, ...args); if (same(target)) descriptors.add(fd); return fd;
  };
  fs.fstatSync = (fd, options) => {
    const stat = originalStat.call(fs, fd, options);
    if (descriptors.has(fd) && behavior.oversized && options?.bigint !== true) stat.size = 4 * 1024 * 1024 + 1;
    return stat;
  };
  fs.readSync = (fd, ...args) => {
    if (descriptors.has(fd)) { reads++; if (behavior.readError) throw behavior.readError; }
    return originalRead.call(fs, fd, ...args);
  };
  fs.closeSync = fd => {
    if (descriptors.has(fd) && behavior.closeError) throw behavior.closeError;
    const result = originalClose.call(fs, fd); descriptors.delete(fd); return result;
  };
  for (const [phase, code, reason] of [['open', 'EACCES', 'denied'], ['read', 'EIO', 'read-failed']]) {
    const original = Object.freeze(Object.assign(new Error('controlled requested policy ' + phase), { code }));
    behavior = { [phase + 'Error']: original };
    assert.throws(load, error => error.riskRuleInput?.reason === reason && Boolean(find(error, value => value === original)));
    assert.equal(descriptors.size, 0);
  }
  reads = 0; behavior = { oversized: true };
  assert.throws(load, error => error.riskRuleInput?.reason === 'oversized'); assert.equal(reads, 0);
  const original = Object.freeze(Object.assign(new Error('controlled policy close'), { code: 'EIO' }));
  behavior = { closeError: original };
  let failure; try { load(); } catch (error) { failure = error; }
  assert.ok(failure?.cacheOwnershipPending); assert.ok(find(failure, value => value === original));
  const ownerError = find(failure, value => Boolean(getContainedFileSession(value))); assert.ok(ownerError);
  const readCount = reads; behavior = {};
  const session = getContainedFileSession(ownerError);
  assert.throws(() => session.releaseAfterCloseSync(), error => Boolean(find(error, value => value === original)));
  assert.equal(session.isSettled(), false, 'an unconfirmed numeric descriptor close cannot establish its original generation');
  assert.equal(reads, readCount); assert.equal(descriptors.size, 1, 'recovery does not repeat the original close by fd number');
} finally {
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.closeSync = originalClose; fs.fstatSync = originalStat;
  for (const fd of descriptors) originalClose.call(fs, fd);
}
const controller = new AbortController(); controller.abort();
assert.throws(() => load({}, { signal: controller.signal }), { name: 'AbortError' });
assert.ok(detect(load()).flows.length, 'failed acquisition is retryable after the underlying input recovers');
console.log('external risk policy completion, exact input receipt and scoped incremental identity passed');
