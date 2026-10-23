import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig, readShippedConfigSchema } from '../../../tools/dict-utils/config.js';
import { explainEffectiveConfiguration, formatEffectiveConfiguration } from '../../../tools/config/effective.js';
import { buildConfigurationDump } from '../../../tools/config/dump-payload.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual config/schema/preview borrowers; no installer/probe/child.
const root = await makeTempDir('poc-config-source-resource-'), repo = path.join(root, 'repo');
await fsp.mkdir(repo); const config = path.join(repo, '.pairofcleats.json'); await fsp.writeFile(config, '{}');
const open = fs.openSync, read = fs.readSync, close = fs.closeSync, disposal = new Set();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause'), errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};
const restore = () => { fs.openSync = open; fs.readSync = read; fs.closeSync = close; };
const dispose = () => { for (const fd of disposal) { try { close(fd); } catch {} disposal.delete(fd); } };
const intercept = (target, { readFailure = null, closeFailure = null, nonvoid = false } = {}) => {
  const state = { opens: 0, reads: 0, closes: 0, allowRead: readFailure === null, allowClose: closeFailure === null && !nonvoid };
  fs.openSync = (name, ...args) => { const fd = open(name, ...args); if (name === target) { state.opens += 1; disposal.add(fd); } return fd; };
  fs.readSync = (fd, ...args) => {
    if (disposal.has(fd)) { state.reads += 1; if (!state.allowRead) throw readFailure; } return read(fd, ...args);
  };
  fs.closeSync = fd => {
    if (disposal.has(fd)) {
      state.closes += 1; if (!state.allowClose) { if (nonvoid) return false; throw closeFailure; }
      const result = close(fd); disposal.delete(fd); return result;
    }
    return close(fd);
  };
  return state;
};
try {
  {
    let sources, reports = 0;
    const closeError = Object.freeze(Object.assign(new Error('close is not optional-source ENOENT'), { code: 'ENOENT' }));
    const state = intercept(config, { closeFailure: closeError });
    const failure = await rejected(() => loadUserConfig(repo, { env: {}, onSources: value => { sources = value; reports += 1; } }));
    assert.ok(getContainedFileSession(failure)); assert.equal(contains(failure, closeError), true);
    assert.equal(reports, 1); assert.equal(state.closes, 1); assert.equal(sources.files[0].readState, 'pending');
    assert.equal(sources.files[0].contentHash, null);
    assert.match(formatEffectiveConfiguration({ ok: false, repoRoot: repo, configSources: sources }), /\(pending\)/);
    dispose(); restore();
  }
  for (const marker of [undefined, false, true]) {
    let ready = false, reports = 0;
    const primary = new Error('config source read native work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    const state = intercept(config, { readFailure: primary });
    const failure = await rejected(() => loadUserConfig(repo, { env: {}, onSources: () => {
      reports += 1; primary.cacheOwnershipReleased = () => true;
    } }));
    const child = getContainedFileSession(failure); assert.ok(child); assert.equal(state.closes, 0); assert.equal(state.reads, 1);
    await rejected(() => child.releaseAfterCloseSync()); assert.equal(state.closes, 0);
    ready = true; state.allowRead = true; child.releaseAfterCloseSync();
    assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(reports, 1); restore();
  }
  await fsp.writeFile(config, '{broken');
  for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen onSources failure'))]) {
    let calls = 0;
    const failure = await rejected(() => loadUserConfig(repo, { env: {}, onSources: () => { calls += 1; throw secondary; } }));
    assert.match(failure.cause.message, /Failed to parse/); assert.equal(contains(failure, secondary), true); assert.equal(calls, 1);
  }
  {
    let ready = false;
    const secondary = Object.assign(new Error('onSources native owner'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    });
    const failure = await rejected(() => loadUserConfig(repo, { env: {}, onSources: () => { throw secondary; } }));
    secondary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  await fsp.writeFile(config, '{}');
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary successful-source report error'))]) {
    const failure = await rejected(() => loadUserConfig(repo, { env: {}, onSources: () => { throw value; } }));
    assert.equal(failure, value);
  }
  for (const dump of [false, true]) {
    let probes = 0;
    intercept(config, { nonvoid: true });
    const failure = await rejected(() => dump ? buildConfigurationDump({ repoRoot: repo, env: {}, includeCapabilities: true }, {
      capabilities() { probes += 1; assert.fail('unsettled config cannot authorize capability probe'); }
    }) : explainEffectiveConfiguration({ repoRoot: repo, env: {} }));
    assert.ok(getContainedFileSession(failure)); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(probes, 0);
    dispose(); restore();
  }
  {
    const schemaPath = path.join(root, 'schema.json'); await fsp.writeFile(schemaPath, '{"type":"object"}');
    const state = intercept(schemaPath, { nonvoid: true });
    const failure = await rejected(() => readShippedConfigSchema(schemaPath)); assert.ok(getContainedFileSession(failure));
    assert.equal(state.opens, 1); dispose(); state.allowClose = true;
    const schema = readShippedConfigSchema(schemaPath); assert.equal(state.opens, 2, 'failed close cannot publish schema cache');
    assert.equal(Object.isFrozen(schema), true); assert.equal(schema.type, 'object');
    fs.openSync = name => { assert.notEqual(name, schemaPath, 'confirmed same-identity schema cache needs no new FD'); return open(name, 'r'); };
    assert.equal(readShippedConfigSchema(schemaPath), schema); restore();
  }
  {
    const missingRepo = path.join(root, 'missing-config'); await fsp.mkdir(missingRepo);
    let sources; assert.deepEqual(loadUserConfig(missingRepo, { env: {}, onSources: value => { sources = value; } }), {});
    assert.equal(sources.files[0].readState, 'missing'); assert.equal(sources.files[0].errorCode, 'ENOENT');
    const report = await explainEffectiveConfiguration({ repoRoot: missingRepo, env: {}, configPath: path.join(missingRepo, 'explicit.json') });
    assert.equal(report.ok, false); assert.equal(report.errorCode, 'ENOENT');
  }
} finally { restore(); dispose(); await rmDirRecursive(root); }
