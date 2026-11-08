import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inventoryStageOutput } from '../../../src/index/build/stage-output.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { publishStageDirectoryFixture } from '../../helpers/stage-directory-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: buildRoot } = await prepareIsolatedTestCacheDir('stage-directory-bounded-ownership');
const outDir = path.join(buildRoot, 'index-code'), open = fs.open;
await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(outDir, 'pieces/manifest.json'), JSON.stringify({ version: 2, mode: 'code', buildId: 'fixture',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] }));
try {
  const fixture = await publishStageDirectoryFixture({ outDir });
  const options = { buildRoot, buildId: 'fixture', mode: 'code' };
  const controller = new AbortController(); let reads = 0, closes = 0, descriptors = 0;
  const fragment = path.join(fixture.dir, 'vectors.lance/data/1.lance');
  fs.open = async function (filename, ...args) {
    const handle = await open.call(this, filename, ...args);
    if (filename === fragment) {
      descriptors++;
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...values) => { const result = await read(...values); reads++; controller.abort(); return result; };
      handle.close = async () => { closes++; return close(); };
    }
    return handle;
  };
  await assert.rejects(inventoryStageOutput({ ...options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 1); assert.equal(descriptors, 1); assert.equal(closes, 1, 'canceled inventory owns actual opened-reader closure');
  fs.open = open;
  assert.ok((await inventoryStageOutput(options)).output.pieces > 0, 'canceled observation leaves the original generation intact');
  const extra = path.join(fixture.dir, 'bounded-members'); await fs.mkdir(extra);
  // Each batch is joined. This actual finite physical inventory exercises the
  // production entry/metadata bound rather than fabricating verified emptiness.
  for (let index = 0; index < 4100; index += 4) await Promise.all(Array.from({ length: 4 }, (_value, offset) =>
    fs.writeFile(path.join(extra, `member-${String(index + offset).padStart(6, '0')}.bin`), '')));
  await assert.rejects(inventoryStageOutput(options), { code: 'ERR_STAGE_DIRECTORY_INVENTORY_UNAVAILABLE' });
  await assert.rejects(fs.stat(path.join(buildRoot, 'current.json')), { code: 'ENOENT' });
} finally { fs.open = open; await fs.rm(buildRoot, { recursive: true, force: true }); }
console.log('Final directory inventory enforces real entry/metadata bounds and settles canceled native readers without publishing a pointer.');
