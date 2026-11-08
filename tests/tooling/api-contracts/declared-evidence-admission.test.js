import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import fsSync from 'node:fs';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { withFixtureCallArguments } from '../../helpers/call-arguments.js';

const { dir } = await prepareIsolatedTestCacheDir('api-declared-evidence-admission');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const index = getIndexDir(repo, 'code', loadUserConfig(repo)); await fs.mkdir(index, { recursive: true });
await fs.writeFile(path.join(index, 'chunk_meta.json'), '[]');
await fs.writeFile(path.join(index, 'symbols.json'), '[]');
let denied = false;
const open = fsSync.openSync;
fsSync.openSync = function(file, ...args) {
  if (denied && String(file).endsWith('call_sites.json')) throw Object.assign(new Error('controlled permission failure'), { code: 'EACCES' });
  return open.call(this, file, ...args);
};
const output = [], originalLog = console.log;
try {
  const { runApiContractsCli } = await import('../../../src/integrations/tooling/api-contracts.js');
  console.log = value => output.push(value);
  const symbols = [{ symbolId: 'moduleA.foo', chunkUid: 'chunk-A', file: 'a.ts', name: 'foo', signature: 'foo(a)' },
    { symbolId: 'moduleB.foo', chunkUid: 'chunk-B', file: 'b.ts', name: 'foo', signature: 'foo(a,b)' }];
  const call = withFixtureCallArguments({ callSiteId: 'sha1:' + 'a'.repeat(40), callerChunkUid: 'caller-A', callerDocId: null,
    file: 'use-a.ts', languageId: 'typescript', segmentId: null, start: 0, end: 6, startLine: 1, startCol: 1, endLine: 1, endCol: 7,
    calleeRaw: 'foo', calleeNormalized: 'foo', receiver: null, args: ['1'], kwargs: null, confidence: 1, evidence: [],
    targetChunkUid: 'chunk-A', targetDocId: null, targetCandidates: [], snippetHash: null });
  await fs.writeFile(path.join(index, 'symbols.json'), JSON.stringify(symbols));
  for (const format of ['json', 'jsonl']) {
    await writePiecesManifest(index, [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
      { name: 'symbols', path: 'symbols.json', format: 'json' }, { name: 'call_sites', path: 'call_sites.' + format, format }]);
    const writeCall = value => fs.writeFile(path.join(index, 'call_sites.' + format),
      format === 'json' ? JSON.stringify([value]) : JSON.stringify(value) + '\n');
    await writeCall(call);
    const clean = await runApiContractsCli(['--repo', repo, '--failOnWarn', '--maxWarnings', '0']);
    assert.deepEqual(clean.symbols.map(row => row.observedCalls.length), [1, 0]);
    assert.equal(validateApiContracts(clean).ok, true);
    await writeCall({ ...call, targetChunkUid: 'chunk-B' });
    const detected = await runApiContractsCli(['--repo', repo]);
    assert.deepEqual(detected.symbols.map(row => row.observedCalls.length), [0, 1]);
    await assert.rejects(runApiContractsCli(['--repo', repo, '--failOnWarn', '--maxWarnings', '0']), { code: 'ERR_API_CONTRACT_WARN' });
  }
  await fs.writeFile(path.join(index, 'symbols.json'), '[]');
  for (const format of ['json', 'jsonl']) {
    const filename = `call_sites.${format}`;
    const pieces = [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
      { name: 'symbols', path: 'symbols.json', format: 'json' }, { name: 'call_sites', path: filename, format }];
    for (const failOnWarn of [false, true]) {
      const args = ['--repo', repo, '--json', ...(failOnWarn ? ['--failOnWarn'] : [])];
      await fs.writeFile(path.join(index, filename), format === 'json' ? '[]' : '');
      await writePiecesManifest(index, pieces);
      const report = await runApiContractsCli(args);
      assert.equal(validateApiContracts(report).ok, true);
      assert.deepEqual(report.symbols, []);
      for (const bytes of ['{invalid\n', format === 'json' ? '{}' : '{}\n']) {
        await fs.writeFile(path.join(index, filename), bytes);
        const before = output.length;
        await assert.rejects(runApiContractsCli(args));
        assert.equal(output.length, before, 'unavailable evidence never emits a successful report');
      }
      await fs.rm(path.join(index, filename));
      await assert.rejects(runApiContractsCli(args), error => /missing|not found|ENOENT/i.test(error.message));
    }
  }
  await fs.writeFile(path.join(index, 'call_sites.json'), '[]');
  await writePiecesManifest(index, [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
    { name: 'symbols', path: 'symbols.json', format: 'json' }, { name: 'call_sites', path: 'call_sites.json', format: 'json' }]);
  denied = true;
  await assert.rejects(runApiContractsCli(['--repo', repo]), { code: 'EACCES' });
  denied = false;
  const base = [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }, { name: 'symbols', path: 'symbols.json', format: 'json' }];
  await fs.writeFile(path.join(index, 'call_sites.part-00000.jsonl'), '');
  await writePiecesManifest(index, [...base, { name: 'call_sites', path: 'call_sites.part-00000.jsonl', format: 'jsonl' },
    { name: 'call_sites', path: 'call_sites.part-00001.jsonl', format: 'jsonl' }]);
  for (const flag of [[], ['--failOnWarn']]) await assert.rejects(runApiContractsCli(['--repo', repo, ...flag]));
  const binaryPieces = [{ name: 'call_sites', path: 'call_sites.binary-columnar.bin', format: 'binary-columnar' },
    { name: 'call_sites_binary_columnar_offsets', path: 'call_sites.binary-columnar.offsets.bin', format: 'binary' },
    { name: 'call_sites_binary_columnar_lengths', path: 'call_sites.binary-columnar.lengths.varint', format: 'varint' },
    { name: 'call_sites_binary_columnar_meta', path: 'call_sites.binary-columnar.meta.json', format: 'json' }];
  for (const payload of [[], ['{invalid'], ['{}']]) {
    const encoded = encodeBinaryRowFrames(payload.map(row => Buffer.from(row)));
    for (const [name, bytes] of [['bin', encoded.dataBuffer], ['offsets.bin', encoded.offsetsBuffer], ['lengths.varint', encoded.lengthsBuffer]]) {
      await fs.writeFile(path.join(index, 'call_sites.binary-columnar.' + name), bytes);
    }
    await fs.writeFile(path.join(index, 'call_sites.binary-columnar.meta.json'), JSON.stringify({ fields: {
      format: 'binary-columnar-v1', count: payload.length, data: binaryPieces[0].path,
      offsets: binaryPieces[1].path, lengths: binaryPieces[2].path } }));
    await writePiecesManifest(index, [...base, ...binaryPieces]);
    for (const flag of [[], ['--failOnWarn']]) {
      if (!payload.length) assert.equal(validateApiContracts(await runApiContractsCli(['--repo', repo, ...flag])).ok, true);
      else await assert.rejects(runApiContractsCli(['--repo', repo, ...flag]));
    }
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runApiContractsCli(['--repo', repo], { signal: controller.signal }), { name: 'AbortError' });
} finally { console.log = originalLog; fsSync.openSync = open; }
console.log('Actual API report CLI rejects declared malformed/missing/schema/permission evidence and cancellation.');
