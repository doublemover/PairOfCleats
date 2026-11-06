import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { loadValidationArm, observeValidationReads } from '../../helpers/validation-read-observation.js';
import { seedValidationWorkFixture } from '../../helpers/validation-work-fixture.js';

ensureTestingEnv(process.env);
const cases = JSON.parse(await fs.readFile(new URL('./manifest-fusion-parity.test.js.cases.json', import.meta.url))).cases;
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/validate/manifest-fusion-parity/')[1];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('manifest-fusion-' + selected);
let observation;
const originalRead = sync.readSync, originalAsyncRead = sync.read;
try {
  const [layout, algorithm] = selected.split('-');
  const fixture = await seedValidationWorkFixture(dir, { layout: ['json', 'jsonl', 'gzip', 'sharded'].includes(layout) ? layout : 'jsonl',
    algorithm: ['sha1', 'sha256', 'xxh64'].includes(algorithm) ? algorithm : 'sha256', rows: selected === 'empty' ? 0 : 8, paddingBytes: 32768 });
  const manifestFile = path.join(fixture.indexDir, 'pieces/manifest.json');
  if (selected === 'checksum-mismatch') fixture.manifest.pieces.find(piece => piece.name === 'chunk_meta').checksum = 'sha256:' + '0'.repeat(64);
  if (['unsupported-checksum', 'nonstrict-checksum'].includes(selected)) fixture.manifest.pieces[0].checksum = 'md5:' + '0'.repeat(32);
  if (selected === 'nonstrict-checksum') fixture.input.strict = false;
  if (selected === 'truncated-jsonl') await fs.appendFile(path.join(fixture.indexDir, fixture.chunkPaths[0]), '{broken');
  if (selected === 'missing-piece') await fs.rm(path.join(fixture.indexDir, 'audit-opaque.bin'));
  if (selected === 'opaque-corruption') await fs.writeFile(path.join(fixture.indexDir, 'audit-opaque.bin'), Buffer.alloc(5, 77));
  await fs.writeFile(manifestFile, JSON.stringify(fixture.manifest));
  if (selected === 'backup') await fs.rename(path.join(fixture.indexDir, 'chunk_meta.jsonl'), path.join(fixture.indexDir, 'chunk_meta.jsonl.bak'));
  if (selected === 'short-reads') sync.read = function (fd, buffer, offset, length, position, callback) {
    return originalAsyncRead.call(this, fd, buffer, offset, Math.min(length, 127), position, callback);
  };
  if (selected === 'short-reads') sync.readSync = function (fd, buffer, offset, length, position) {
    return originalRead.call(this, fd, buffer, offset, Math.min(length, 127), position);
  };
  const fused = await loadValidationArm('fused'), eager = await loadValidationArm('eager');
  observation = observeValidationReads(fixture.indexDir);
  const fusedReport = await fused(fixture.input);
  observation.stop(); const actualReads = observation.metrics;
  const eagerReport = await eager(fixture.input);
  assert.deepEqual(fusedReport, eagerReport, 'complete original verdict, ordered findings, schema/count/identity diagnostics and source selection remain equal');
  const negative = ['checksum-mismatch', 'truncated-jsonl', 'unsupported-checksum', 'missing-piece', 'opaque-corruption', 'backup'].includes(selected);
  if (negative) assert.equal(fusedReport.ok, false, JSON.stringify(fusedReport));
  else assert.equal(fusedReport.ok, true, JSON.stringify(fusedReport));
  if (selected === 'checksum-mismatch') assert.ok(fusedReport.issues.some(issue => issue.includes('checksum mismatch')));
  if (selected === 'nonstrict-checksum') assert.ok(fusedReport.warnings.some(issue => issue.includes('checksum invalid or unsupported')));
  if (!negative && fixture.input.strict) {
    for (const relative of fixture.chunkPaths) {
      const row = actualReads.files[relative], bytes = (await fs.stat(path.join(fixture.indexDir, relative))).size;
      assert.equal(row.opens, 1, relative + ' checksum and decode share the original descriptor');
      assert.equal(row.bytesRead, bytes, relative + ' stored bytes consumed exactly once');
      if (selected === 'short-reads') assert.ok(row.readCalls >= Math.ceil(bytes / 127), 'original reads actually split UTF8 bytes across short extents');
    }
    assert.equal(actualReads.files['audit-opaque.bin'].bytesRead, 5, 'unconsumed declared binary still receives integrity verification');
  }
  console.log(JSON.stringify({ case: selected, ok: fusedReport.ok, completeReportParity: true, actualReads }));
} finally { observation?.stop(); sync.readSync = originalRead; sync.read = originalAsyncRead; await fs.rm(dir, { recursive: true, force: true }); }
