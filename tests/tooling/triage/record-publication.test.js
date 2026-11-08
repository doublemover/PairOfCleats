import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { writeTriageRecordArtifacts } from '../../../tools/triage/record-writer.js';
import { loadTriageRecordSnapshot } from '../../../tools/triage/record-snapshot.js';
import { readTriagePublication, TRIAGE_PUBLICATION_FIELD, TRIAGE_GENERATION_DIRECTORY } from '../../../src/integrations/triage/record-publication.js';
import { createRecordsMarkdownInventory } from '../../../src/integrations/triage/records-inventory.js';
import { createRecordSourceReference, readRecordEmbeddingSource } from '../../../src/integrations/triage/record-source.js';
import { renderRecordMarkdown } from '../../../src/integrations/triage/render.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { prepareIsolatedTestCacheDir, resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const { dir: fixtureRoot } = await prepareIsolatedTestCacheDir('triage-record-publication-' + selected);
const root = path.join(fixtureRoot, 'records');
const sha = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const record = (label, id = 'same') => ({ recordId: id, recordType: 'finding', source: 'generic',
  createdAt: '2026-10-27T12:00:00.000Z', updatedAt: '2026-10-27T12:00:00.000Z',
  vuln: { vulnId: label, title: label, description: 'Observed ' + label, severity: 'high' },
  idProvenance: { method: 'stable-key', stability: 'stable', source: 'recordId' } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const contains = (value, wanted, seen = new Set()) => {
  if (value === wanted) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, wanted, seen) || contains(value.workerError, wanted, seen)
    || (value.errors || []).some(error => contains(error, wanted, seen));
};
const failed = async promise => {
  try { await promise; } catch (error) { return error; }
  assert.fail('operation must fail');
};
const operations = [], gates = [], recoveries = [];
const start = work => { const promise = work(); promise.catch(() => {}); operations.push(promise); return promise; };
const gate = () => { const value = deferred(); gates.push(value); return value; };
const snapshot = id => readTriagePublication(root, path.join(root, id + '.json'));
const inventory = async () => {
  const owner = createRecordsMarkdownInventory(root), rows = [];
  for await (const file of owner.files) rows.push({ file, publication: owner.publicationForCurrent(file) });
  assert.equal(owner.receipt().complete, true); return rows;
};
const originalOpen = fs.open;
let workError;
const children = [];
const createChild = () => {
  const child = fork(fileURLToPath(new URL('../../fixtures/triage/record-publication-child.js', import.meta.url)), [root], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env }
  });
  const messages = new Map(), waiting = new Map(); let stderr = '', outputBytes = 0, terminalError = null;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  closed.catch(() => {});
  const failWaiting = error => { terminalError = error; for (const waiter of waiting.values()) waiter.reject(error); waiting.clear(); };
  child.on('message', message => {
    if (message?.type === 'failure') { failWaiting(new Error(message.message)); return; }
    const waiter = waiting.get(message?.type);
    if (waiter) { waiting.delete(message.type); waiter.resolve(message); }
    else if (messages.size < 16) messages.set(message.type, message);
  });
  closed.then(value => failWaiting(new Error(`Publication child closed before its expected event (${value.code}/${value.signal}).`)), failWaiting);
  child.stdout.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 16384) child.kill(); });
  child.stderr.on('data', chunk => { outputBytes += chunk.length; stderr += chunk.toString(); if (outputBytes > 16384) child.kill(); });
  const timer = setTimeout(() => { failWaiting(new Error('Publication child exceeded its bounded fixture lifetime.')); child.kill(); }, 10000);
  closed.then(() => clearTimeout(timer), () => clearTimeout(timer));
  const owner = {
    child, closed,
    event(type) {
      if (messages.has(type)) { const message = messages.get(type); messages.delete(type); return Promise.resolve(message); }
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) => waiting.set(type, { resolve, reject }));
    },
    async finish() {
      const result = await closed; clearTimeout(timer);
      assert.deepEqual(result, { code: 0, signal: null }); assert.equal(stderr, ''); assert.ok(outputBytes <= 16384);
    },
    async dispose() {
      clearTimeout(timer);
      if (child.connected) child.send({ type: 'continue' });
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
  };
  children.push(owner); return owner;
};
try {
  if (selected === 'atomic-generation') {
    const input = record('alpha'), output = await writeTriageRecordArtifacts(root, input);
    const current = await snapshot('same');
    assert.equal(current.record.vuln.title, 'alpha');
    assert.equal(current.text, renderRecordMarkdown(input));
    assert.equal(output.mdPath, current.mdPath);
    assert.equal(await fs.readFile(output.jsonPath, 'utf8'), await fs.readFile(output.generationJsonPath, 'utf8'));
    assert.equal(input[TRIAGE_PUBLICATION_FIELD], undefined, 'caller input is not mutated');
    assert.deepEqual((await loadTriageRecordSnapshot(root, 'same')).record, input,
      'JSON-only finding/history consumers do not expose internal publication bookkeeping');
    assert.ok(output.mdPath.startsWith(path.join(root, TRIAGE_GENERATION_DIRECTORY) + path.sep));
    const entries = await inventory(); assert.equal(entries.length, 1); assert.equal(entries[0].file, output.mdPath);
    assert.equal(entries[0].publication.jsonHash, sha(await fs.readFile(output.jsonPath)));
    assert.equal(Object.keys(entries[0].publication).length, 8, 'inventory retains only compact source witnesses');
    if (process.platform === 'win32') {
      await assert.rejects(writeTriageRecordArtifacts(root, record('other', 'SAME')), { code: 'ERR_TRIAGE_RECORD_IDENTITY_CONFLICT' });
      assert.equal((await snapshot('same')).publication.generation, output.generation);
    }
  } else if (selected === 'exact-reimport') {
    const input = record('alpha'), first = await writeTriageRecordArtifacts(root, input);
    const second = await writeTriageRecordArtifacts(root, structuredClone(input));
    assert.equal(second.generation, first.generation); assert.equal(second.mdPath, first.mdPath);
    const generations = (await fs.readdir(path.dirname(path.dirname(first.mdPath)), { withFileTypes: true })).filter(entry => entry.isDirectory());
    assert.equal(generations.length, 1, 'identical input does not accumulate redundant immutable generations');
  } else if (selected === 'same-id-interleave') {
    const old = await writeTriageRecordArtifacts(root, record('old'));
    const aReady = gate(), releaseA = gate(), bReady = gate(), releaseB = gate(), bClaim = gate();
    const first = start(() => writeTriageRecordArtifacts(root, record('alpha'), {
      beforePublish: async location => { aReady.resolve(location); await releaseA.promise; }
    }));
    await Promise.race([aReady.promise, first.then(() => assert.fail('publication returned without its observer'))]);
    const lockPath = path.join(root, TRIAGE_GENERATION_DIRECTORY, 'locks', sha('same') + '.lock');
    fs.open = async function (file, ...args) {
      if (file === lockPath && args[0] === 'wx') bClaim.resolve();
      return originalOpen.call(this, file, ...args);
    };
    const second = start(() => writeTriageRecordArtifacts(root, record('beta'), {
      beforePublish: async location => { bReady.resolve(location); await releaseB.promise; }
    }));
    await Promise.race([bClaim.promise, second.then(() => assert.fail('second writer bypassed the held record lock'))]);
    fs.open = originalOpen;
    assert.equal((await snapshot('same')).publication.generation, old.generation);
    assert.deepEqual((await inventory()).map(row => row.file), [old.mdPath], 'unpublished stages are not index inputs');
    releaseA.resolve(); const a = await first;
    await Promise.race([bReady.promise, second.then(() => assert.fail('second publication omitted its observer'))]);
    assert.equal((await snapshot('same')).record.vuln.title, 'alpha');
    assert.equal((await inventory())[0].file, a.mdPath);
    releaseB.resolve(); const b = await second;
    assert.equal((await snapshot('same')).record.vuln.title, 'beta');
    assert.equal((await inventory())[0].file, b.mdPath);
    assert.equal(await fs.readFile(a.mdPath, 'utf8'), renderRecordMarkdown(record('alpha')), 'prior source remains readable');
  } else if (selected === 'cross-process') {
    const old = await writeTriageRecordArtifacts(root, record('old'));
    const ready = gate(), release = gate();
    const first = start(() => writeTriageRecordArtifacts(root, record('alpha'), {
      beforePublish: async () => { ready.resolve(); await release.promise; }
    }));
    await Promise.race([ready.promise, first.then(() => assert.fail('observer omitted'))]);
    const owner = createChild(); await owner.event('ready');
    owner.child.send({ type: 'start', record: record('beta') });
    await owner.event('attempt');
    assert.equal((await snapshot('same')).publication.generation, old.generation);
    assert.equal((await inventory())[0].file, old.mdPath);
    release.resolve(); const a = await first; await owner.event('staged');
    assert.equal((await snapshot('same')).publication.generation, a.generation);
    owner.child.send({ type: 'continue' }); const done = await owner.event('done');
    await owner.finish();
    assert.equal((await snapshot('same')).publication.generation, done.result.generation);
    assert.equal((await snapshot('same')).text, renderRecordMarkdown(record('beta')));
  } else if (selected === 'independent-ids') {
    const ready = gate(), release = gate();
    const first = start(() => writeTriageRecordArtifacts(root, record('alpha', 'one'), {
      beforePublish: async () => { ready.resolve(); await release.promise; }
    }));
    await Promise.race([ready.promise, first.then(() => assert.fail('observer omitted'))]);
    const second = await writeTriageRecordArtifacts(root, record('beta', 'two'));
    assert.equal((await snapshot('two')).publication.generation, second.generation, 'independent publication completes while one remains held');
    release.resolve(); await first;
  } else if (['failed-after-json', 'failed-before-commit', 'tampered-stage'].includes(selected)) {
    const old = await writeTriageRecordArtifacts(root, record('old'));
    const prior = await fs.readFile(old.jsonPath);
    const primary = Object.freeze(new Error('original triage stage failure'));
    const options = selected === 'failed-after-json' ? { afterRecordStaged: () => { throw primary; } }
      : selected === 'tampered-stage' ? { beforePublish: async location => { await fs.writeFile(location.mdPath, 'foreign stage bytes'); } }
        : { beforePublish: () => { throw primary; } };
    const failure = await failed(writeTriageRecordArtifacts(root, record('new'), options));
    if (selected !== 'tampered-stage') assert.ok(contains(failure, primary));
    assert.deepEqual(await fs.readFile(old.jsonPath), prior);
    assert.equal((await snapshot('same')).publication.generation, old.generation);
    assert.deepEqual((await inventory()).map(row => row.file), [old.mdPath]);
    assert.equal(await fs.readFile(old.mdPath, 'utf8'), renderRecordMarkdown(record('old')));
  } else if (selected === 'input-capture') {
    const input = record('captured');
    await writeTriageRecordArtifacts(root, input, { afterRecordStaged: () => { input.vuln.title = 'later mutation'; } });
    assert.equal((await snapshot('same')).record.vuln.title, 'captured');
    assert.ok((await snapshot('same')).text.includes('captured'));
    assert.ok(!(await snapshot('same')).text.includes('later mutation'));
  } else if (selected === 'cancellation') {
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(writeTriageRecordArtifacts(root, record('unused'), { signal: aborted.signal }), { name: 'AbortError' });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' }, 'pre-abort precedes namespace or payload creation');
    const prior = await writeTriageRecordArtifacts(root, record('prior'));
    const controller = new AbortController();
    await assert.rejects(writeTriageRecordArtifacts(root, record('cancelled'), { signal: controller.signal,
      beforePublish: () => controller.abort() }), { name: 'AbortError' });
    assert.equal((await snapshot('same')).publication.generation, prior.generation);
    assert.equal((await inventory())[0].file, prior.mdPath);
  } else if (selected === 'receipt-negatives') {
    const output = await writeTriageRecordArtifacts(root, record('alpha')), original = await fs.readFile(output.jsonPath);
    for (const mutate of [value => value.schemaVersion++, value => value.rendererVersion++, value => value.generation = '../foreign',
      value => value.recordId = 'other', value => value.recordHash = '0'.repeat(64), value => value.markdownBytes = 0,
      value => value.markdownHash = '0'.repeat(64), value => value.recordHash = [value.recordHash],
      value => value.markdownHash = [value.markdownHash], value => value.extraPath = '../foreign.md']) {
      const candidate = JSON.parse(original); mutate(candidate[TRIAGE_PUBLICATION_FIELD]);
      await fs.writeFile(output.jsonPath, JSON.stringify(candidate));
      await assert.rejects(snapshot('same'));
    }
    await fs.writeFile(output.jsonPath, original); assert.equal((await snapshot('same')).publication.generation, output.generation);
    const markdown = await fs.readFile(output.mdPath); await fs.writeFile(output.mdPath, 'changed original source');
    await assert.rejects(snapshot('same')); await fs.writeFile(output.mdPath, markdown);
    assert.equal((await snapshot('same')).text, markdown.toString());
  } else if (selected === 'inventory-and-retained-source') {
    const first = await writeTriageRecordArtifacts(root, record('alpha'));
    await fs.writeFile(path.join(root, 'legacy.md'), '# Legacy Markdown\n');
    await fs.writeFile(path.join(root, 'irrelevant.json'), '{ malformed but not a Markdown input }');
    const rows = await inventory(); assert.equal(rows.length, 2);
    const captured = rows.find(row => row.publication);
    const content = await fs.readFile(captured.file), contentHash = sha(content, 'sha1');
    const reference = createRecordSourceReference({ repoRoot: fixtureRoot, recordsDir: root, kind: 'triage',
      relativePath: path.relative(root, captured.file).replaceAll('\\', '/'), contentHash });
    const second = await writeTriageRecordArtifacts(root, record('beta'));
    assert.notEqual(second.generation, first.generation);
    const source = await readRecordEmbeddingSource({ repoRoot: fixtureRoot, recordsDir: root, file: reference.storagePath,
      items: [{ fileHash: contentHash, recordSource: reference }] });
    assert.equal(source.text, renderRecordMarkdown(record('alpha')), 'deferred original-generation reads survive later publication');
    assert.deepEqual(await fs.readFile(captured.publication.jsonPath), await fs.readFile(first.generationJsonPath));
    assert.ok(!Object.values(captured.publication).some(value => Buffer.isBuffer(value)), 'inventory retains no source buffers');
  } else if (selected === 'index-generation') {
    const original = await writeTriageRecordArtifacts(root, record('old'));
    const ready = gate(), release = gate();
    const writing = start(() => writeTriageRecordArtifacts(root, record('alpha'), {
      beforePublish: async () => { ready.resolve(); await release.promise; }
    }));
    await Promise.race([ready.promise, writing.then(() => assert.fail('observer omitted'))]);
    const key = Symbol.for('test.triage.record-publication.index');
    const state = { captures: [], mutate: null }; globalThis[key] = state;
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        const resolved = next(specifier, context);
        if (resolved.url.endsWith('/index/build/artifacts.js')) return { ...resolved, url: resolved.url + '?triage-publication-capture' };
        if (resolved.url.endsWith('/triage/records-inventory.js')) return { ...resolved, url: resolved.url + '?triage-publication-barrier' };
        return resolved;
      },
      load(url, context, next) {
        if (url.endsWith('/artifacts.js?triage-publication-capture')) return { format: 'module', shortCircuit: true,
          source: `export * from ${JSON.stringify(url.split('?')[0] + '?actual-triage-publication')};
            export const writeIndexArtifacts = input => globalThis[Symbol.for('test.triage.record-publication.index')].captures.push(structuredClone(input.state.chunks));` };
        if (url.endsWith('/records-inventory.js?triage-publication-barrier')) return { format: 'module', shortCircuit: true,
          source: `export * from ${JSON.stringify(url.split('?')[0] + '?actual-triage-inventory')};
            import { createRecordsMarkdownInventory as actual } from ${JSON.stringify(url.split('?')[0] + '?actual-triage-inventory')};
            export const createRecordsMarkdownInventory = (...args) => {
              const owner = actual(...args);
              const files = async function* () { for await (const file of owner.files) {
                yield file; await globalThis[Symbol.for('test.triage.record-publication.index')].mutate?.(file);
              } };
              return { ...owner, files: files() };
            };` };
        return next(url, context);
      }
    });
    try {
      const { buildRecordsIndexForRepo } = await import('../../../src/integrations/triage/index-records.js');
      const runtime = { root: fixtureRoot, buildRoot: path.join(fixtureRoot, 'build'), repoCacheRoot: path.join(fixtureRoot, 'repo-cache'),
        userConfig: { cache: { root: path.join(fixtureRoot, 'cache') }, triage: { recordsDir: root, promoteFields: ['vulnId'] } },
        postingsConfig: { enablePhraseNgrams: true, enableChargrams: true, fielded: true }, dictWords: new Set(), dictConfig: {},
        modelId: 'stub-model', useStubEmbeddings: true, workerPool: null, getChunkEmbedding: async () => [],
        profile: { id: 'default' }, indexingConfig: { profile: 'default' }, embeddingEnabled: false, embeddingService: false,
        incrementalEnabled: false, incrementalBundleFormat: 'json', shards: { enabled: false }, twoStage: { enabled: false } };
      const run = () => buildRecordsIndexForRepo({ runtime });
      await run();
      const old = state.captures.at(-1); assert.equal(old.length, 1);
      assert.equal(old[0].name, 'old'); assert.equal(old[0].docmeta.record.vulnId, 'old');
      assert.equal(old[0].fileHash, sha(renderRecordMarkdown(record('old')), 'sha1'));
      assert.ok(old[0].file.includes(original.generation), 'actual builder consumes the prior complete generation while a new one is staged');
      release.resolve(); const current = await writing; await run();
      assert.equal(state.captures.at(-1)[0].docmeta.record.vulnId, 'alpha');
      assert.equal(state.captures.at(-1)[0].fileHash, sha(renderRecordMarkdown(record('alpha')), 'sha1'));
      state.mutate = async file => { if (file === current.mdPath) await fs.writeFile(file, 'changed after inventory qualification'); };
      const publications = state.captures.length;
      await assert.rejects(run()); assert.equal(state.captures.length, publications,
        'changed source after inventory cannot publish a mixed metadata/text index');
      await fs.writeFile(current.mdPath, renderRecordMarkdown(record('alpha')));
    } finally { hooks.deregister(); delete globalThis[key]; }
  } else if (selected === 'unknown-namespace') {
    const privateRoot = path.join(root, TRIAGE_GENERATION_DIRECTORY);
    await fs.mkdir(privateRoot, { recursive: true });
    const sentinel = path.join(privateRoot, 'foreign.md'); await fs.writeFile(sentinel, 'unrelated evidence');
    await assert.rejects(writeTriageRecordArtifacts(root, record('alpha')));
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated evidence');
    await assert.rejects(inventory(), 'unknown producer roots cannot become hidden accepted publication namespaces');
  } else if (['pending-resource', 'pending-resource-value'].includes(selected)) {
    const old = await writeTriageRecordArtifacts(root, record('old')); let ready = false, calls = 0;
    const primary = Object.freeze(Object.assign(new Error('original stage resource still active'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, primary); return ready; }
    }));
    const failure = await failed(writeTriageRecordArtifacts(root, record('new'), { afterRecordStaged: () => {
      calls++; if (selected === 'pending-resource-value') return primary; throw primary;
    } }));
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED'); assert.ok(contains(failure, primary));
    assert.equal((await snapshot('same')).publication.generation, old.generation);
    const session = failure.fileLockPublicationSession; assert.ok(session);
    recoveries.push(async () => { ready = true; await session.releaseAfterClose(); });
    await assert.rejects(session.releaseAfterClose());
    ready = true; await session.releaseAfterClose();
    assert.equal(calls, 1, 'metadata-only release never replays failed source work');
    assert.equal(failure.cacheOwnershipReleased(), true);
  } else assert.fail(`Unknown triage publication case ${selected}`);
} catch (error) { workError = error; throw error; }
finally {
  try {
    fs.open = originalOpen;
    gates.forEach(value => value.resolve());
    const outcomes = await Promise.allSettled(operations);
    const stopped = await Promise.allSettled(children.map(owner => owner.dispose()));
    for (const outcome of stopped) if (outcome.status === 'rejected') throw outcome.reason;
    const recovered = await Promise.allSettled(recoveries.map(recover => recover()));
    for (const outcome of recovered) if (outcome.status === 'rejected') throw outcome.reason;
    for (const outcome of outcomes) if (outcome.status === 'rejected') observeStorageResource(outcome.reason).requireSettled();
    const absolute = path.resolve(fixtureRoot), parent = path.resolve(resolveTestCachePath());
    assert.equal(path.dirname(absolute), parent); assert.ok(path.basename(absolute).startsWith('triage-record-publication-'));
    await fs.rm(absolute, { recursive: true, force: true });
  } catch (cleanup) {
    if (workError) throw addStorageFailureContext(workError, {}, cleanup, { secondaryPresent: true });
    throw cleanup;
  }
}
console.log(`triage record publication ${selected} passed`);
