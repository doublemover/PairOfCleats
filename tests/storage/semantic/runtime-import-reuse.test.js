import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { openRuntimeQueryFamily } from '../../../src/index/semantic/runtime/query-store.js';
import { runtimeByteHash } from '../../../src/index/semantic/runtime/raw-store.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { createVerifiedRuntimeImportFixture } from '../../helpers/verified-runtime-import-fixture.js';
import { admitRuntimeHeadroom, retainedRuntimeBytes, runtimeFamilySnapshot,
  observeRuntimePublicationWork, assertNoRuntimeFamilyWrites, runRuntimeReuseChild } from '../../helpers/runtime-publication-work.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/runtime-import-reuse/')[1];
const modes = ['repeat', 'fresh-process', 'pointer-missing', 'pointer-older', 'interrupted', 'receipt-missing', 'receipt-stale', 'missing-family',
  'corrupt-raw', 'corrupt-evidence', 'corrupt-offsets', 'corrupt-query-index', 'corrupt-manifest', 'corrupt-receipt',
  'repointed-receipt', 'repointed-qualification', 'source-qualification', 'raw-change', 'adapter-change', 'parser-change', 'invalid-authority', 'foreign-generation'];
assert.ok(modes.includes(mode));
const fixture = await (['source-qualification', 'foreign-generation', 'repointed-qualification'].includes(mode)
  ? createVerifiedRuntimeImportFixture() : createRuntimeImportFixture());
let pinned;
try {
  const options = fixture.options(), destination = options.destination, coldMetrics = {};
  let first;
  if (mode === 'interrupted') {
    const rename = fs.rename, controller = new AbortController(); let promoted;
    fs.rename = async (from, to) => {
      const result = await rename(from, to);
      if (path.dirname(to) === path.join(destination, 'generations') && /^[a-f0-9]{64}$/.test(path.basename(to))) {
        promoted = path.basename(to); controller.abort();
      }
      return result;
    };
    try { await assert.rejects(importRuntimeEvidence({ ...options, signal: controller.signal }), { code: 'ABORT_ERR' }); }
    finally { fs.rename = rename; }
    assert.ok(promoted); first = { pointer: { generationId: promoted } };
    await assert.rejects(fs.stat(path.join(destination, 'current.json')), { code: 'ENOENT' });
  } else {
    const cold = await observeRuntimePublicationWork(destination, () => importRuntimeEvidence({ ...options, publicationMetrics: coldMetrics }));
    first = cold.value;
    assert.equal(cold.witness.sqliteFinalizations, 1, 'cold control builds the actual native SQLite image');
    assert.ok(cold.witness.staging.length >= 3, 'cold control retains actual raw and family staging');
  }
  const generation = first.pointer.generationId, family = path.join(destination, 'generations', generation);
  const before = await runtimeFamilySnapshot(family), familyBytes = before.reduce((sum, row) => sum + Number(row.size), 0);
  assert.ok(familyBytes > 1024, 'the repeat cap cannot accommodate another immutable family');
  const rawInputs = fixture.capture.rawArtifacts.map(row => ({ artifactId: row.artifactId,
    path: path.join(destination, 'raw', row.hash + '.bin') }));
  const receiptFiles = async () => (await fs.readdir(path.join(destination, '.recipes'))).filter(name => name.endsWith('.json'));
  let pointerRepair = ['pointer-missing', 'pointer-older', 'interrupted'].includes(mode);
  if (mode === 'pointer-missing') await fs.unlink(path.join(destination, 'current.json'));
  if (['pointer-older', 'repointed-receipt', 'repointed-qualification'].includes(mode)) {
    const other = await importRuntimeEvidence(mode === 'repointed-qualification' ? { ...options, semanticContext: null }
      : { ...options, capture: { ...options.capture, question: 'A separate saved interpretation?' } });
    assert.notEqual(other.pointer.generationId, generation);
    if (mode === 'repointed-qualification') {
      assert.deepEqual(other.capture, first.capture, 'capture equality alone cannot qualify operation targets');
      assert.ok((await fixture.readRows(first)).some(row => row.join.targets.length > 0));
      assert.ok((await fixture.readRows(other)).every(row => row.join.targets.length === 0));
    }
    if (mode.startsWith('repointed-')) {
      for (const name of await receiptFiles()) {
        const filename = path.join(destination, '.recipes', name), receipt = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (receipt.pointer.generationId === generation) await fs.writeFile(filename, JSON.stringify({ ...receipt, pointer: other.pointer }));
      }
    }
  }
  const repeatOptions = { ...options, inputs: rawInputs }, metrics = {};
  if (['receipt-missing', 'receipt-stale', 'corrupt-receipt'].includes(mode)) {
    for (const name of await receiptFiles()) {
      const filename = path.join(destination, '.recipes', name);
      if (mode === 'receipt-missing') await fs.unlink(filename);
      else {
        const receipt = JSON.parse(await fs.readFile(filename, 'utf8'));
        await fs.writeFile(filename, JSON.stringify(mode === 'receipt-stale'
          ? { ...receipt, schemaVersion: 0 } : { ...receipt, recipe: '0'.repeat(64) }));
      }
    }
  }
  if (mode === 'missing-family') {
    assert.ok(path.relative(fixture.root, family).startsWith(`import${path.sep}generations${path.sep}`));
    await fs.rm(family, { recursive: true });
  }
  const damagedMember = { 'corrupt-raw': path.join(destination, 'raw', fixture.capture.rawArtifacts[0].hash + '.bin'),
    'corrupt-evidence': path.join(family, 'evidence.jsonl'), 'corrupt-offsets': path.join(family, 'evidence.offsets'),
    'corrupt-query-index': path.join(family, 'query.sqlite'), 'corrupt-manifest': path.join(family, 'manifest.json') }[mode];
  if (damagedMember) {
    const bytes = await fs.readFile(damagedMember); bytes[0] ^= 1; await fs.writeFile(damagedMember, bytes);
    if (mode === 'corrupt-raw') repeatOptions.inputs = fixture.inputs; // Check the retained CAS independently of the unchanged source input.
  }
  if (mode === 'invalid-authority') repeatOptions.authority = { ...options.authority, action: 'execute' };
  if (mode === 'foreign-generation') repeatOptions.capture = { ...options.capture,
    generation: { ...options.capture.generation, baseBuildId: 'foreign-pinned-build' } };
  if (mode === 'raw-change') {
    const profile = JSON.parse(await fs.readFile(fixture.inputs[0].path, 'utf8'));
    profile.samples = [2, 2, 2, 2]; profile.timeDeltas = [10, 10, 10, 10];
    const bytes = Buffer.from(JSON.stringify(profile)); await fs.writeFile(fixture.inputs[0].path, bytes);
    repeatOptions.inputs = fixture.inputs;
    repeatOptions.capture = structuredClone(options.capture);
    Object.assign(repeatOptions.capture.rawArtifacts[0], { hash: runtimeByteHash(bytes), byteLength: bytes.length });
    repeatOptions.authority = { ...options.authority, artifactHashes: repeatOptions.capture.rawArtifacts.map(row => row.hash) };
  }
  if (mode === 'adapter-change' || mode === 'parser-change') {
    repeatOptions.capture = structuredClone(options.capture);
    if (mode === 'adapter-change') repeatOptions.capture.rawArtifacts[0].formatVersion = '99';
    else repeatOptions.capture.rawArtifacts[0].parser.version = 'new-author-parser';
  }
  const corrupt = mode.startsWith('corrupt-') || mode.startsWith('repointed-');
  if (corrupt || ['invalid-authority', 'foreign-generation'].includes(mode)) {
    const expected = mode === 'invalid-authority' ? 'ERR_RUNTIME_IMPORT_AUTHORITY'
      : mode === 'foreign-generation' ? 'ERR_RUNTIME_QUERY_SCOPE' : 'ERR_RUNTIME_IMPORT_INTEGRITY';
    const observed = await observeRuntimePublicationWork(destination, async () => {
      await assert.rejects(importRuntimeEvidence({ ...repeatOptions, publicationMetrics: metrics }), error => {
        assert.equal(error.code, expected);
        if (mode === 'repointed-qualification') assert.match(error.message, /different current source qualification/);
        return true;
      });
    });
    assertNoRuntimeFamilyWrites(observed.witness); assert.equal(metrics.reusedFamilies || 0, 0);
    console.log(JSON.stringify({ mode, metrics, witness: observed.witness }));
  } else if (['receipt-missing', 'receipt-stale', 'missing-family', 'source-qualification', 'raw-change', 'adapter-change', 'parser-change'].includes(mode)) {
    if (mode === 'source-qualification') {
      const rows = await fixture.readRows(first);
      assert.ok(rows.some(row => row.join.targets.length), 'original pinned semantic operation really qualified');
      repeatOptions.semanticContext = null;
      const bounded = await admitRuntimeHeadroom(destination);
      await assert.rejects(importRuntimeEvidence({ ...repeatOptions,
        importOptions: { maxDiskWorkingSetBytes: bounded.limit }, publicationMetrics: metrics }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
      assert.equal(metrics.reusedFamilies, 0, 'changed current qualification cannot reuse the old targets under a small cap');
    }
    const rebuilt = await observeRuntimePublicationWork(destination, () => importRuntimeEvidence({ ...repeatOptions, publicationMetrics: metrics }));
    assert.equal(metrics.reusedFamilies, 0); assert.equal(metrics.rebuiltFamilies, 1);
    assert.equal(metrics.sqliteBuilds, 1); assert.equal(rebuilt.witness.sqliteFinalizations, 1);
    assert.ok(rebuilt.witness.staging.length > 0);
    if (mode === 'source-qualification') {
      assert.notEqual(rebuilt.value.pointer.generationId, generation);
      assert.ok((await fixture.readRows(rebuilt.value)).every(row => row.join.targets.length === 0));
    } else if (['raw-change', 'adapter-change', 'parser-change'].includes(mode)) assert.notEqual(rebuilt.value.pointer.generationId, generation);
    else assert.equal(rebuilt.value.pointer.generationId, generation);
    console.log(JSON.stringify({ mode, familyBytes, metrics, witness: rebuilt.witness }));
  } else {
    pinned = await openRuntimeQueryFamily({ destination, generationId: generation });
    if (mode === 'repeat') {
      const comfortableMetrics = {};
      const comfortable = await observeRuntimePublicationWork(destination,
        () => importRuntimeEvidence({ ...repeatOptions, publicationMetrics: comfortableMetrics }));
      console.log(JSON.stringify({ mode, control: 'comfortable-cap', metrics: comfortableMetrics, witness: comfortable.witness }));
      assert.equal(comfortable.value.pointer.generationId, generation);
      assertNoRuntimeFamilyWrites(comfortable.witness);
      assert.equal(comfortable.witness.evidenceReadOpens, 1);
    }
    const admitted = await admitRuntimeHeadroom(destination);
    let result;
    if (mode === 'fresh-process') {
      const child = await runRuntimeReuseChild({ kind: 'import', options: { ...repeatOptions,
        importOptions: { maxDiskWorkingSetBytes: admitted.limit } }, requestFile: path.join(fixture.root, 'reuse-request.json') });
      result = child; Object.assign(metrics, child.metrics);
    } else result = await observeRuntimePublicationWork(destination, () => importRuntimeEvidence({ ...repeatOptions,
      importOptions: { maxDiskWorkingSetBytes: admitted.limit }, publicationMetrics: metrics }));
    assert.equal(result.value.pointer.generationId, generation);
    assertNoRuntimeFamilyWrites(result.witness);
    assert.equal(metrics.reusedFamilies, 1); assert.equal(metrics.rebuiltFamilies, 0);
    assert.equal(metrics.projectionRows, 0); assert.equal(metrics.sqliteBuilds, 0); assert.equal(metrics.sqliteImageBytes, 0);
    assert.equal(metrics.pointerOnlyRepairs, Number(pointerRepair));
    assert.ok(metrics.peakAdditionalReservation <= admitted.headroom);
    assert.equal(result.witness.evidenceReadOpens, 1, 'one full immutable family verification per publication attempt');
    const evidenceBytes = Number(before.find(row => row.name === 'evidence.jsonl').size);
    assert.equal(result.witness.evidenceReadBytes, 2 * evidenceBytes, 'one checksum pass plus one streaming row/index comparison, without a repeated full verifier');
    assert.deepEqual(await runtimeFamilySnapshot(family), before, 'immutable bytes, native file identities and mtimes remain unchanged');
    const entry = pinned.db.prepare('SELECT * FROM evidence ORDER BY ordinal LIMIT 1').get();
    assert.ok(await pinned.hydrate(entry, 65536), 'pinned readers survive pointer-only recovery');
    assert.ok(await retainedRuntimeBytes(destination) <= admitted.limit);
    const currentWrites = result.witness.writes.filter(row => /^\.current-/.test(row.path));
    assert.equal(currentWrites.length, Number(pointerRepair), 'an unchanged convenience pointer is never rewritten');
    console.log(JSON.stringify({ mode, familyBytes, admitted, coldMetrics, metrics, witness: result.witness }));
  }
} finally { await pinned?.close(); await fixture.cleanup(); }
