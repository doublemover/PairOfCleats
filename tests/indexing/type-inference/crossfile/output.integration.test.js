#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { toRealPathSync } from '../../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode } from '../../../helpers/run-node.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { loadCodeChunkArtifacts } from './artifact-fixture.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'type-inference-crossfile-integration');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRootRaw, 'src'), { recursive: true });
const repoRoot = toRealPathSync(repoRootRaw);

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
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});
const buildTimeoutMs = Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
  ? Math.max(180000, Number(process.env.PAIROFCLEATS_TEST_TIMEOUT_MS))
  : 180000;

const result = runNode([
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--stage',
  'stage2',
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'cross-file inference integration build index', repoRoot, env, {
  timeoutMs: buildTimeoutMs,
  stdio: 'inherit',
  allowFailure: true
});
if (result.status !== 0) {
  console.error('Cross-file inference integration test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const { chunkMeta, resolveChunkFile } = await loadCodeChunkArtifacts(repoRoot, 'inference');

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

