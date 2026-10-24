import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Tests follow the committed logical artifact, including immutable generations. */
export const embeddingArtifactPath = (indexDir, name) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(indexDir, 'pieces', 'manifest.json'), 'utf8'));
  const piece = manifest.pieces.find(entry => entry.name === name);
  assert.ok(piece, `Expected committed embedding artifact ${name}`);
  return path.join(indexDir, piece.path);
};
