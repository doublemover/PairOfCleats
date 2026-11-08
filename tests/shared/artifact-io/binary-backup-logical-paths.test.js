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
// Explicit metadata sidecars are authoritative even when convention-derived
// defaults are absent, and each physical backup is resolved independently.
const metadataPath = path.join(root, parts[1].find(file => file.endsWith('.meta.json')) + '.bak');
const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
for (const [field, suffix] of [['offsets', '.offsets.bin'], ['lengths', '.lengths.varint']]) {
  const original = metadata.fields[field], replacement = `explicit-second${suffix}`;
  await fs.rename(path.join(root, original + '.bak'), path.join(root, replacement + '.bak'));
  metadata.fields[field] = replacement;
  entries.find(piece => piece.path === original).path = replacement;
}
const metadataBytes = JSON.stringify(metadata); await fs.writeFile(metadataPath, metadataBytes);
entries.find(piece => piece.path + '.bak' === path.basename(metadataPath)).checksum =
  'sha256:' + createHash('sha256').update(metadataBytes).digest('hex');
await writePiecesManifest(root, [...entries, { name: 'sample_meta', path: 'sample.meta.json', format: 'json' }]);
await check();
const beforeEscape = metadata.fields.offsets;
metadata.fields.offsets = '../outside.offsets.bin'; await fs.writeFile(metadataPath, JSON.stringify(metadata));
await assert.rejects(check, error => /path|outside|Invalid/u.test(error.message));
metadata.fields.offsets = beforeEscape; await fs.writeFile(metadataPath, metadataBytes);
await fs.writeFile(path.join(root, parts[1][0] + '.bak'), Buffer.from(JSON.stringify({ id: 2, file: 'src/second.js' })));
await assert.rejects(check, { code: 'ERR_ARTIFACT_CORRUPT' }, 'backup bytes retain the canonical manifest checksum');
console.log('binary backup logical artifact paths passed');
