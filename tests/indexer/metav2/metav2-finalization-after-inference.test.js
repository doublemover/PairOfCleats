#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAX_JSON_BYTES, loadChunkMeta, loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir } from '../../helpers/temp.js';

const root = process.cwd();
const tempRoot = await makeTempDir('pairofcleats-metav2-finalization-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
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

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: true,
      typeInferenceCrossFile: true
    },
    tooling: {
      autoEnableOnDetect: false
    }
  }
});
const buildTimeoutMs = Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
  ? Math.max(60000, Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
  : 60000;

const result = spawnSync(process.execPath, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--stage',
  'stage2',
  '--repo',
  repoRoot
], {
  cwd: repoRoot,
  env,
  timeout: buildTimeoutMs,
  killSignal: 'SIGTERM',
  encoding: 'utf8'
});
if (result.status !== 0) {
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  console.error('metaV2 finalization test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const buildOutput = `${result.stderr || ''}\n${result.stdout || ''}`;
const buildRootMatch = buildOutput.match(/^\[init\] build root:\s*(.+)$/m);
const buildRootFromOutput = buildRootMatch?.[1]?.trim() || null;
const currentBuild = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
const indexRoot = buildRootFromOutput || currentBuild?.activeRoot || currentBuild?.buildRoot || null;
const codeDir = getIndexDir(repoRoot, 'code', userConfig, indexRoot ? { indexRoot } : {});
let chunkMeta = [];
let fileMeta = [];
try {
  chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  fileMeta = await loadJsonArrayArtifact(codeDir, 'file_meta', { maxBytes: MAX_JSON_BYTES, strict: true });
} catch (err) {
  console.error(`Failed to load metaV2 artifacts at ${codeDir}: ${err?.message || err}`);
  process.exit(1);
}
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

const inferredReturns = buildWidget.metaV2?.types?.inferred?.returns || [];
if (!inferredReturns.some((entry) => entry.type === 'Widget' && entry.source === 'flow')) {
  console.error('metaV2 missing inferred return Widget for buildWidget.');
  process.exit(1);
}

const callLinks = buildWidget.metaV2?.relations?.callLinks || [];
if (!callLinks.some((link) =>
  link.to?.status === 'resolved'
  && link.legacy?.target === 'createWidget'
  && link.legacy?.file === 'src/creator.js'
)) {
  console.error('metaV2 missing call link to createWidget.');
  process.exit(1);
}

console.log('metaV2 finalization after inference test passed');
