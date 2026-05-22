#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { MAX_JSON_BYTES, loadChunkMeta, loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { validateMetaV2Equivalence } from '../../../src/index/validate/checks.js';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir } from '../../helpers/temp.js';

const buildReport = () => ({
  issues: [],
  warnings: [],
  hints: []
});

{
  const chunk = {
    id: 0,
    file: 'src/app.ts',
    ext: '.ts',
    start: 0,
    end: 12,
    startLine: 1,
    endLine: 1,
    lang: 'typescript',
    docmeta: {
      signature: 'greet(name: string): string',
      doc: 'greet docs'
    }
  };
  const toolInfo = { tool: 'pairofcleats', version: '0.0.0-test' };
  const metaV2 = buildMetaV2({
    chunk,
    docmeta: chunk.docmeta,
    toolInfo,
    analysisPolicy: { metadata: { enabled: true } }
  });

  const entry = { ...chunk, metaV2 };
  const report = buildReport();
  validateMetaV2Equivalence(report, 'code', [entry], { maxSamples: 5, maxErrors: 2 });
  assert.equal(report.issues.length, 0);

  const mutated = { ...entry, metaV2: { ...metaV2, ext: '.js' } };
  const reportMismatch = buildReport();
  validateMetaV2Equivalence(reportMismatch, 'code', [mutated], { maxSamples: 5, maxErrors: 2 });
  assert.ok(reportMismatch.issues.length > 0);
}

{
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

  const result = runNode([
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage2',
    '--repo',
    repoRoot
  ], 'metav2 finalization build', repoRoot, env, {
    timeoutMs: buildTimeoutMs,
    stdio: 'pipe',
    allowFailure: true
  });
  assert.equal(result.status, 0, `build_index failed: ${result.stderr || result.stdout || '<empty>'}`);

  const userConfig = loadUserConfig(repoRoot);
  const buildOutput = `${result.stderr || ''}\n${result.stdout || ''}`;
  const buildRootMatch = buildOutput.match(/^\[init\] build root:\s*(.+)$/m);
  const buildRootFromOutput = buildRootMatch?.[1]?.trim() || null;
  const currentBuild = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
  const indexRoot = buildRootFromOutput || currentBuild?.activeRoot || currentBuild?.buildRoot || null;
  const codeDir = getIndexDir(repoRoot, 'code', userConfig, indexRoot ? { indexRoot } : {});
  const chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const fileMeta = await loadJsonArrayArtifact(codeDir, 'file_meta', { maxBytes: MAX_JSON_BYTES, strict: true });
  const fileById = new Map((Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file]));
  const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;

  const buildWidget = chunkMeta.find((chunk) =>
    resolveChunkFile(chunk) === 'src/consumer.js' && chunk.name === 'buildWidget'
  );
  assert.ok(buildWidget, 'Missing buildWidget chunk in consumer.js.');

  const inferredReturns = buildWidget.metaV2?.types?.inferred?.returns || [];
  assert.ok(inferredReturns.some((entry) => entry.type === 'Widget' && entry.source === 'flow'));

  const callLinks = buildWidget.metaV2?.relations?.callLinks || [];
  assert.ok(callLinks.some((link) =>
    link.to?.status === 'resolved'
    && link.legacy?.target === 'createWidget'
    && link.legacy?.file === 'src/creator.js'
  ));
}

console.log('metaV2 contract matrix test passed');
