import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { copySnapshotModeArtifacts } from '../../src/index/snapshots/copy-pieces.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('snapshot-piece-integrity');
const sourceIndexDir = path.join(dir, 'source');
await fs.mkdir(path.join(sourceIndexDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(sourceIndexDir, 'index_state.json'), '{}');
await fs.writeFile(path.join(sourceIndexDir, 'payload.json'), '{"value":"aa"}');
const copyFile = fs.copyFile;
let counter = 0;
try {
  for (const checksum of [undefined, null, 'malformed', 'sha256:abcd', 'sha1:short']) {
    const piece = { type: 'embeddings', name: 'dense_vectors_meta', format: 'json', path: 'payload.json', bytes: 14,
      ...(checksum === undefined ? {} : { checksum }) };
    await fs.writeFile(path.join(sourceIndexDir, 'pieces/manifest.json'), JSON.stringify({ version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [piece] }));
    const run = () => copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir: path.join(dir, `target-${counter++}`), verify: true });
    if (checksum == null) {
      const valid = await run();
      assert.equal(valid.filesChecked, 1);
      fs.copyFile = async (from, to, ...args) => {
        await copyFile(from, to, ...args);
        if (to.endsWith('payload.json')) await fs.writeFile(to, '{"value":"bb"}');
      };
      await assert.rejects(run(), /Checksum mismatch/, 'checksum-free pieces still require equal captured source/destination bytes');
      fs.copyFile = copyFile;
    } else {
      await assert.rejects(run(), /checksum|manifest/i, 'a declared unsupported or malformed checksum cannot silently attest success');
    }
  }
} finally { fs.copyFile = copyFile; }
console.log('Verified regular pieces compare bytes without a checksum and reject unsupported declared identities.');
