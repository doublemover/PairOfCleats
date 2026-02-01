#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'type-inference-crossfile-integration');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

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
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
    indexing: {
      typeInference: true,
      typeInferenceCrossFile: true
    },
    tooling: {
      autoEnableOnDetect: false
    }
  }),
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

const result = spawnSync(process.execPath, [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], {
  cwd: repoRoot,
  env,
  timeout: Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
    ? Math.max(1000, Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
    : 20000,
  killSignal: 'SIGTERM',
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Cross-file inference integration test failed: build_index failed.');
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
const fileMetaPath = path.join(codeDir, 'file_meta.json');
const fileMeta = fs.existsSync(fileMetaPath)
  ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
  : [];
const fileById = new Map(
  (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
);
const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;

const buildWidget = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/consumer.js'
  && chunk.name === 'buildWidget'
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
if (!callLinks.some((link) =>
  link.to?.status === 'resolved'
  && link.legacy?.target === 'createWidget'
  && link.legacy?.file === 'src/creator.js'
)) {
  console.error('Cross-file inference missing call link to createWidget.');
  process.exit(1);
}

const usageLinks = buildWidget.codeRelations?.usageLinks || [];
if (!usageLinks.some((link) =>
  link.to?.status === 'resolved'
  && link.legacy?.target === 'Widget'
  && link.legacy?.file === 'src/creator.js'
)) {
  console.error('Cross-file inference missing usage link to Widget.');
  process.exit(1);
}

console.log('Cross-file inference integration output ok.');

