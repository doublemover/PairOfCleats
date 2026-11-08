import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { writeCasObject } from '../../../src/shared/cache-cas/objects.js';
import { getCasMetaPath } from '../../../src/shared/cache-cas/paths.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';

const { dir } = await prepareIsolatedTestCacheDir('gc-incomplete-mark');
const shim = path.join(dir, 'controlled-mark-errors.mjs');
await fs.writeFile(shim, [
  "import fs from 'node:fs/promises'; import path from 'node:path';",
  "const selected = process.env.POC_MARK_FAILURE_METHOD, target = path.resolve(process.env.POC_MARK_FAILURE_PATH || '.');",
  'const original = fs[selected];',
  'if (original) fs[selected] = async function(file, ...args) {',
  '  if (path.resolve(String(file)) === target) throw Object.assign(new Error("controlled inventory failure"), { code: process.env.POC_MARK_FAILURE_CODE });',
  '  return original.call(this, file, ...args); };'
].join('\n'));
const cases = [
  { name: 'manifest-eacces', method: 'readFile', code: 'EACCES' },
  { name: 'manifest-eio', method: 'readFile', code: 'EIO' },
  { name: 'manifest-disappeared', method: 'readFile', code: 'ENOENT' },
  { name: 'malformed-json', malformed: '{"casObjects":' },
  { name: 'invalid-manifest-shape', malformed: 'null' },
  { name: 'root-enumeration', method: 'readdir', code: 'EACCES', target: 'root' },
  { name: 'nested-enumeration', method: 'readdir', code: 'EIO', target: 'nested' },
  { name: 'root-inspection', method: 'lstat', code: 'EACCES', target: 'root' }
];
try {
  for (const entry of cases) {
    const cacheRoot = path.join(dir, entry.name);
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
    const live = await writeCasObject({ cacheRoot, content: Buffer.from(`referenced-${entry.name}`), now: '2020-01-01' });
    const stale = await writeCasObject({ cacheRoot, content: Buffer.from(`unreferenced-${entry.name}`), now: '2020-01-01' });
    const manifest = path.join(cacheRoot, 'federation', 'workspace', 'workspace_manifest.json');
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    await fs.writeFile(manifest, entry.malformed || JSON.stringify({ casObjects: [live.hash] }));
    const before = await fs.readFile(live.objectPath);
    const metadataBefore = await fs.readFile(getCasMetaPath(cacheRoot, live.hash));
    const target = entry.target === 'root' ? path.join(cacheRoot, 'federation') : entry.target === 'nested' ? path.dirname(manifest) : manifest;
    const env = applyTestEnv({ syncProcess: false, cacheRoot,
      extraEnv: { POC_MARK_FAILURE_METHOD: entry.method || '', POC_MARK_FAILURE_PATH: target, POC_MARK_FAILURE_CODE: entry.code || '' } });
    const result = runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/index/cache-gc.js'),
      '--cache-root', cacheRoot, '--apply', '--grace-days', '0', '--json'],
    entry.name, process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    const receipt = JSON.parse(result.stdout);
    if (result.status !== 1) console.error(JSON.stringify({ case: entry.name, status: result.status,
      ok: receipt.ok, liveHash: live.hash, deleted: receipt.deleted,
      livePresent: await fs.stat(live.objectPath).then(() => true, () => false) }));
    assert.equal(result.status, 1, `${entry.name}: incomplete inventory must fail before any deletion`);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.deferred, true);
    assert.equal(receipt.code, 'ERR_CAS_GC_INCOMPLETE_MARK');
    assert.equal(receipt.mark.complete, false);
    assert.equal(receipt.mark.failures.length, 1);
    assert.equal(receipt.mark.failures[0].path, path.resolve(target));
    if (entry.code) assert.equal(receipt.mark.failures[0].code, entry.code);
    assert.equal(receipt.counts.deleted, 0);
    assert.equal(receipt.bytes.planned, 0);
    assert.equal(receipt.bytes.deleted, 0);
    assert.deepEqual(await fs.readFile(live.objectPath), before);
    assert.deepEqual(await fs.readFile(getCasMetaPath(cacheRoot, live.hash)), metadataBefore);
    await fs.access(stale.objectPath);
    await fs.access(getCasMetaPath(cacheRoot, stale.hash));
    if (entry.name === 'root-inspection') {
      const text = runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/index/cache-gc.js'),
        '--cache-root', cacheRoot, '--apply', '--grace-days', '0'],
      'ordinary CLI incomplete mark diagnostic', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
      assert.equal(text.status, 1);
      assert.equal(text.stdout, '');
      assert.match(text.stderr, /CAS GC deferred: incomplete reachability inventory.*EACCES/);
      assert.deepEqual(await fs.readFile(live.objectPath), before);
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Incomplete CAS reachability inventories defer all deletion and retain actionable failure provenance');
