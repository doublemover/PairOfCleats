import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await prepareArtifactIoTestDir('binary-backup-logical-paths');
const rows = [{ id: 0, file: 'src/first.js' }, { id: 1, file: 'src/second.js' }];
const entries = [], parts = [];
for (const [i, row] of rows.entries()) {
  const name = `sample.part-${String(i).padStart(6, '0')}`;
  const framed = encodeBinaryRowFrames([Buffer.from(JSON.stringify(row))]);
  const files = { [`${name}.bin`]: framed.dataBuffer, [`${name}.offsets.bin`]: framed.offsetsBuffer,
    [`${name}.lengths.varint`]: framed.lengthsBuffer,
    [`${name}.meta.json`]: JSON.stringify({ fields: { format: 'binary-columnar-v1', count: 1,
      data: `${name}.bin`, offsets: `${name}.offsets.bin`, lengths: `${name}.lengths.varint` } }) };
  for (const [file, bytes] of Object.entries(files)) await fs.writeFile(path.join(root, file), bytes);
  entries.push({ name: 'sample', path: `${name}.bin`, format: 'binary-columnar' });
  for (const [file, bytes] of Object.entries(files)) {
    const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (file.endsWith('.bin') && file === `${name}.bin`) entries.at(-1).checksum = checksum;
    else entries.push({ name: `${name}_${file.endsWith('.meta.json') ? 'metadata' : 'sidecar'}`, path: file, checksum });
  }
  parts.push(Object.keys(files));
}
await fs.writeFile(path.join(root, 'sample.meta.json'), JSON.stringify({ format: 'binary-columnar',
  parts: parts.map(files => files[0]) }));
await writePiecesManifest(root, [...entries, { name: 'sample_meta', path: 'sample.meta.json', format: 'json' }]);
const check = async () => {
  assert.deepEqual(await loadJsonArrayArtifact(root, 'sample', { strict: true }), rows);
  const streamed = []; for await (const row of loadJsonArrayArtifactRows(root, 'sample', { strict: true })) streamed.push(row);
  assert.deepEqual(streamed, rows);
};
await check();
await fs.rename(path.join(root, parts[1][0]), path.join(root, parts[1][0] + '.bak'));
await check();
for (const file of parts[1].slice(1)) await fs.rename(path.join(root, file), path.join(root, file + '.bak'));
await check();
await fs.writeFile(path.join(root, parts[1][0] + '.bak'), Buffer.from(JSON.stringify({ id: 2, file: 'src/second.js' })));
await assert.rejects(check, { code: 'ERR_ARTIFACT_CORRUPT' }, 'backup bytes retain the canonical manifest checksum');
console.log('binary backup logical artifact paths passed');
