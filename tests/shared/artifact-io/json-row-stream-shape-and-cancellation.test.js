import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';

const { dir } = await prepareIsolatedTestCacheDir('json-row-stream-shape-cancellation');
await writePiecesManifest(dir, [{ name: 'sample', path: 'sample.json', format: 'json' }]);
const collect = async signal => { const rows = []; for await (const row of loadJsonArrayArtifactRows(dir, 'sample', { strict: true, signal })) rows.push(row); return rows; };
for (const value of [null, {}, false, 'invalid root']) {
  await fs.writeFile(path.join(dir, 'sample.json'), JSON.stringify(value));
  await assert.rejects(collect(), { code: 'ERR_ARTIFACT_INVALID' });
}
await fs.writeFile(path.join(dir, 'sample.json'), '[]'); assert.deepEqual(await collect(), []);
const before = new AbortController(); before.abort(); await assert.rejects(collect(before.signal), { name: 'AbortError' });
await fs.writeFile(path.join(dir, 'sample.json'), '[{"id":1},{"id":2}]');
const during = new AbortController(), rows = loadJsonArrayArtifactRows(dir, 'sample', { strict: true, signal: during.signal });
assert.deepEqual((await rows.next()).value, { id: 1 }); during.abort();
await assert.rejects(rows.next(), { name: 'AbortError' });
console.log('Manifest JSON row streams preserve array shape and observe cancellation before empty success and between rows.');
