import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCrashLogger } from '../../src/index/build/crash-log.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { errorGraphIncludes } from '../helpers/error-graph.js';

// UNVALIDATED: actual small atomic file publications with deterministic IO gates.
// No child, debugger or native database is launched.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['same-key-pending', 'different-keys-serial', 'different-kinds', 'snapshot',
  'optional-first-required', 'required-first-optional', 'failed-index-dedup', 'flush-barrier', 'close-barrier',
  'close-after-failure', 'pending-error', 'replaced-observer', 'revoked-success', 'warning-failure',
  'warning-pending', 'pending-budget', 'payload-budget', 'late-intake'];
assert.ok(cases.includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`forensic-ordering-${selected}`);
const repoCacheRoot = path.join(root, 'cache'); await fs.mkdir(repoCacheRoot);
const open = fs.open, mkdir = fs.mkdir, warn = console.warn;
let logger = null, passed = false, ready = false, inject = true, payloadWrites = 0, indexWrites = 0, warnings = 0;
const primary = Object.freeze(Object.assign(new Error('exact forensic IO failure'), { code: 'EACCES' }));
const secondary = Object.freeze(new Error('exact forensic warning failure'));
const pendingFailure = Object.assign(new Error('original pending forensic write owner'), { cacheOwnershipReleased: () => ready });
const pendingSuccess = Object.freeze({ cacheOwnershipReleased: () => ready });
let release, entered;
const gate = new Promise(resolve => { release = resolve; });
const blocked = new Promise(resolve => { entered = resolve; });
const closes = new Map();
try {
  fs.open = async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args);
    if (flags === 'a' && typeof file === 'string') {
      const close = handle.close.bind(handle); closes.set(file, 0);
      handle.close = async () => { closes.set(file, closes.get(file) + 1); return close(); };
    }
    return handle;
  };
  logger = await createCrashLogger({ repoCacheRoot, enabled: true });
  logger.traceFileStage({ phase: 'fixture' }); await logger.flush();
  const originalOpen = fs.open;
  fs.open = async (file, flags, ...args) => {
    if (typeof file === 'string' && typeof flags === 'string' && /[wx]/u.test(flags)) {
      const index = file.includes('index-crash-forensics-index.json');
      const payload = file.includes(`${path.sep}forensics${path.sep}`);
      if (payload) payloadWrites++; if (index) indexWrites++;
      if (inject && (index || payload) && ['pending-error', 'replaced-observer'].includes(selected)) throw pendingFailure;
      if (inject && (index || payload) && ['warning-failure', 'warning-pending', 'close-after-failure'].includes(selected)) throw primary;
      if (inject && index && ['same-key-pending', 'different-keys-serial', 'optional-first-required', 'required-first-optional',
        'failed-index-dedup', 'flush-barrier', 'close-barrier', 'pending-budget'].includes(selected)) {
        entered(); await gate;
        if (['optional-first-required', 'required-first-optional', 'failed-index-dedup'].includes(selected)) throw primary;
      }
    }
    return originalOpen(file, flags, ...args);
  };
  if (selected === 'revoked-success') fs.mkdir = async (directory, ...args) => {
    const result = await mkdir(directory, ...args);
    return String(directory).endsWith(`${path.sep}forensics`) ? pendingSuccess : result;
  };
  console.warn = () => {
    warnings++;
    if (selected === 'warning-failure') throw secondary;
    if (selected === 'warning-pending') return pendingSuccess;
  };
  const request = (signature = 'same', required = true, kind = 'fixture', bundle = { value: 'original' }) =>
    logger.persistForensicBundle({ signature, required, kind, bundle });
  const readIndex = async () => JSON.parse(await fs.readFile(path.join(logger.paths.directory, 'index-crash-forensics-index.json'), 'utf8'));
  if (['same-key-pending', 'different-keys-serial', 'flush-barrier', 'close-barrier'].includes(selected)) {
    const first = request(); await blocked;
    let secondSettled = false, barrierSettled = false;
    const second = selected === 'same-key-pending' ? request().finally(() => { secondSettled = true; })
      : selected === 'different-keys-serial' ? request('other').finally(() => { secondSettled = true; }) : null;
    const barrier = (selected === 'close-barrier' ? logger.close() : logger.flush()).finally(() => { barrierSettled = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(secondSettled, false); assert.equal(barrierSettled, false);
    assert.equal(payloadWrites, 1, 'a blocked index must not expose dedup success or dispatch a second payload');
    if (selected === 'close-barrier') await assert.rejects(request('late'), { reason: 'logger-closed' });
    inject = false; release();
    const firstPath = await first; if (second) {
      const secondPath = await second;
      assert.equal(firstPath === secondPath, selected === 'same-key-pending');
    }
    await barrier;
    assert.equal((await readIndex()).entries.length, selected === 'different-keys-serial' ? 2 : 1);
    assert.equal(payloadWrites, selected === 'different-keys-serial' ? 2 : 1);
  } else if (['optional-first-required', 'required-first-optional', 'failed-index-dedup'].includes(selected)) {
    const firstRequired = selected !== 'optional-first-required';
    const first = request('same', firstRequired); first.catch(() => {}); await blocked;
    const second = request('same', selected !== 'required-first-optional'); second.catch(() => {});
    release();
    const outcomes = await Promise.allSettled([first, second]);
    for (let index = 0; index < outcomes.length; index++) {
      const required = index ? selected !== 'required-first-optional' : firstRequired;
      assert.equal(outcomes[index].status, required ? 'rejected' : 'fulfilled');
      if (required) assert.ok(errorGraphIncludes(outcomes[index].reason, primary));
      else assert.equal(outcomes[index].value, null);
    }
    assert.equal(payloadWrites, 1); await assert.rejects(logger.flush(), error => errorGraphIncludes(error, primary));
    inject = false; const recovered = await request(); assert.equal(typeof recovered, 'string');
    assert.equal(payloadWrites, 2, 'failed index publication cannot leave a successful dedup receipt');
    await logger.flush(); const before = payloadWrites; assert.equal(await request(), recovered); assert.equal(payloadWrites, before);
    assert.equal((await readIndex()).entries.length, 1);
  } else if (selected === 'different-kinds') {
    inject = false;
    const paths = await Promise.all([request('same', true, 'first-kind'), request('same', true, 'second-kind')]);
    assert.notEqual(paths[0], paths[1]); assert.equal((await readIndex()).entries.length, 2); assert.equal(payloadWrites, 2);
  } else if (selected === 'snapshot') {
    inject = false; const bundle = { value: 'accepted', nested: { count: 1 } };
    const publication = request('same', true, 'fixture', bundle); bundle.value = 'mutated'; bundle.nested.count = 2;
    const payload = JSON.parse(await fs.readFile(await publication, 'utf8'));
    assert.equal(payload.bundle.value, 'accepted'); assert.equal(payload.bundle.nested.count, 1);
  } else if (selected === 'pending-error' || selected === 'replaced-observer') {
    let failure;
    await assert.rejects(request(), error => { failure = error; return errorGraphIncludes(error, pendingFailure); });
    if (selected === 'replaced-observer') pendingFailure.cacheOwnershipReleased = () => true;
    const before = payloadWrites;
    await assert.rejects(request()); assert.equal(payloadWrites, before); await assert.rejects(logger.flush());
    assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; inject = false; await request(); await logger.flush();
    assert.equal(failure.cacheOwnershipReleased(), true);
  } else if (selected === 'revoked-success') {
    ready = true; const published = await request(); ready = false;
    await assert.rejects(request()); await assert.rejects(logger.flush());
    assert.equal(payloadWrites, 1, 'late ownership revocation must block cached success without repeating publication');
    ready = true; assert.equal(await request(), published); await logger.flush();
  } else if (selected === 'warning-failure' || selected === 'warning-pending') {
    let failure;
    await assert.rejects(request('same', false), error => { failure = error; return errorGraphIncludes(error, primary); });
    assert.equal(warnings, 1);
    if (selected === 'warning-failure') assert.ok(errorGraphIncludes(failure, secondary));
    else { assert.equal(failure.cacheOwnershipReleased(), false); await assert.rejects(logger.flush()); ready = true; }
    inject = false; console.warn = warn; await request(); await logger.flush();
  } else if (selected === 'pending-budget') {
    const publications = [request('key-0')]; await blocked;
    for (let index = 1; index < 32; index++) publications.push(request(`key-${index}`));
    await assert.rejects(request('overflow'), { reason: 'accepted-work-budget' });
    inject = false; release(); await Promise.all(publications); await logger.flush();
    assert.equal(payloadWrites, 32); assert.equal((await readIndex()).entries.length, 32);
  } else if (selected === 'payload-budget') {
    await assert.rejects(request('large', true, 'fixture', { value: 'x'.repeat(2 * 1024 * 1024) }), { reason: 'payload-byte-budget' });
    assert.equal(payloadWrites, 0); inject = false; await request(); await logger.flush();
  } else if (selected === 'close-after-failure') {
    const publication = request(); publication.catch(() => {});
    const close = logger.close(); assert.equal(logger.close(), close);
    await assert.rejects(publication, error => errorGraphIncludes(error, primary));
    await assert.rejects(close, error => errorGraphIncludes(error, primary));
    assert.equal(closes.size, 4); assert.ok([...closes.values()].every(count => count === 1), 'all independent append handles close after forensic failure');
    await assert.rejects(request('late'), { reason: 'logger-closed' });
  } else if (selected === 'late-intake') {
    await logger.close(); await assert.rejects(request(), { reason: 'logger-closed' }); assert.equal(payloadWrites, 0);
  }
  if (selected !== 'close-after-failure') await logger.close();
  passed = true;
} finally {
  release(); ready = true; inject = false; fs.open = open; fs.mkdir = mkdir; console.warn = warn;
  if (!passed) { try { await logger?.close(); } catch { /* Retain failed fixture evidence. */ } }
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`Forensic publication ordering and accepted-work drain: ${selected}`);
