#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'scheduler-output-regression');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'export const beta = 2;\n');

const baseConfig = {
  indexing: {
    scheduler: {
      enabled: true,
      lowResourceMode: false,
      cpuTokens: 1,
      ioTokens: 1,
      memoryTokens: 1
    },
    scm: { provider: 'none' },
    embeddings: {
      enabled: false,
      hnsw: { enabled: false },
      lancedb: { enabled: false }
    },
    treeSitter: { enabled: false },
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false
  }
};

const runBuild = async (label, schedulerEnabled) => {
  const cacheRoot = path.join(tempRoot, label);
  const testEnv = applyTestEnv({
    cacheRoot,
    embeddings: 'off',
    testConfig: {
      ...baseConfig,
      indexing: {
        ...baseConfig.indexing,
        scheduler: {
          ...baseConfig.indexing.scheduler,
          enabled: schedulerEnabled
        }
      }
    },
    extraEnv: {
      PAIROFCLEATS_SCHEDULER: schedulerEnabled ? '1' : '0'
    }
  });

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--repo', repoRoot, '--stub-embeddings', '--scm-provider', 'none'],
    { cwd: repoRoot, env: testEnv, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`scheduler output regression test failed: build_index ${label} failed`);
    process.exit(result.status ?? 1);
  }
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const chunkMeta = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES });
  if (!Array.isArray(chunkMeta)) {
    console.error('scheduler output regression test failed: missing chunk_meta');
    process.exit(1);
  }
  const stripConfigHash = (entry) => {
    if (entry?.metaV2?.tooling && 'configHash' in entry.metaV2.tooling) {
      const copy = { ...entry, metaV2: { ...entry.metaV2, tooling: { ...entry.metaV2.tooling } } };
      delete copy.metaV2.tooling.configHash;
      return copy;
    }
    return entry;
  };
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        out[key] = normalize(value[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(normalize(chunkMeta.map(stripConfigHash)));
};

const baseline = await runBuild('baseline', false);
const current = await runBuild('current', true);

if (baseline !== current) {
  console.error('scheduler output regression test failed: chunk_meta mismatch between scheduler on/off');
  process.exit(1);
}

console.log('scheduler output regression test passed');
