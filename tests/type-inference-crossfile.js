#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'type-inference-crossfile');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const config = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  },
  sqlite: { use: false }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2)
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'creator.js'),
  `/**
 * @returns {Widget}
 */
export function createWidget() {
  return new Widget();
}

export class Widget {
  constructor() {
    this.id = 1;
  }
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'consumer.js'),
  `import { createWidget, Widget } from './creator.js';

export function buildWidget() {
  const widget = new Widget();
  return createWidget();
}
`
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const result = spawnSync(process.execPath, [path.join(root, 'build_index.js'), '--stub-embeddings'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Cross-file inference test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
if (!fs.existsSync(chunkMetaPath)) {
  console.error(`Missing chunk meta at ${chunkMetaPath}`);
  process.exit(1);
}

const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
const buildWidget = chunkMeta.find((chunk) =>
  chunk.file === 'src/consumer.js' &&
  chunk.name === 'buildWidget'
);
if (!buildWidget) {
  console.error('Missing buildWidget chunk in consumer.js.');
  process.exit(1);
}

const inferredReturns = buildWidget.docmeta?.inferredTypes?.returns || [];
if (!inferredReturns.some((entry) => entry.type === 'Widget' && entry.source === 'flow')) {
  console.error('Cross-file inference missing return type Widget for buildWidget.');
  process.exit(1);
}

const callLinks = buildWidget.codeRelations?.callLinks || [];
if (!callLinks.some((link) => link.target === 'createWidget' && link.file === 'src/creator.js')) {
  console.error('Cross-file inference missing call link to createWidget.');
  process.exit(1);
}

const usageLinks = buildWidget.codeRelations?.usageLinks || [];
if (!usageLinks.some((link) => link.target === 'Widget' && link.file === 'src/creator.js')) {
  console.error('Cross-file inference missing usage link to Widget.');
  process.exit(1);
}

console.log('Cross-file inference test passed');
