#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'chunk-meta-hot-cold-split');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const hotRows = [
  { id: 0, start: 0, end: 10, file: 'src/a.js', lang: 'javascript', name: 'alpha' },
  { id: 1, start: 11, end: 30, file: 'src/b.js', lang: 'javascript', name: 'beta' }
];
const coldRows = [
  { id: 0, metaV2: { chunkId: 'a#0' }, lint: [{ ruleId: 'semi' }] },
  { id: 1, metaV2: { chunkId: 'b#1' }, codeRelations: { imports: ['./x.js'] } }
];

await fs.writeFile(
  path.join(tempRoot, 'chunk_meta.jsonl'),
  `${hotRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'chunk_meta_cold.jsonl'),
  `${coldRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  'utf8'
);

const hotOnly = await loadChunkMeta(tempRoot, { strict: false, includeCold: false });
assert.equal(Array.isArray(hotOnly), true);
assert.equal(hotOnly.length, 2);
assert.equal(hotOnly[0].metaV2, undefined, 'hot-only load should not hydrate cold metadata');
assert.equal(hotOnly[0].lint, undefined, 'hot-only load should not hydrate cold lint');

const merged = await loadChunkMeta(tempRoot, { strict: false, includeCold: true });
assert.equal(Array.isArray(merged), true);
assert.equal(merged.length, 2);
assert.equal(merged[0].metaV2?.chunkId, 'a#0');
assert.equal(Array.isArray(merged[0].lint), true);
assert.equal(merged[1].codeRelations?.imports?.[0], './x.js');

console.log('chunk_meta hot/cold split loader test passed');
