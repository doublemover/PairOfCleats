#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createFileScanner } from '../../../src/index/build/file-scan.js';
import { resolvePreReadSkip } from '../../../src/index/build/file-processor/skip.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { getIndexDir, getMetricsDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'file-caps-contract-matrix');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

{
  const caseRoot = path.join(tempRoot, 'skip-policy');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const abs = path.join(caseRoot, 'sample.js');
  await fsPromises.writeFile(abs, '0123456789', 'utf8');
  const fileStat = await fsPromises.lstat(abs);

  const languageSkip = await resolvePreReadSkip({
    abs,
    fileEntry: { abs, rel: 'sample.js' },
    fileStat,
    ext: '.js',
    fileCaps: {
      default: { maxBytes: 1024, maxLines: null },
      byLanguage: { javascript: { maxBytes: 1, maxLines: null } }
    },
    fileScanner: createFileScanner(null),
    runIo: (fn) => fn(),
    languageId: 'javascript',
    mode: 'code',
    maxFileBytes: null
  });
  assert.ok(languageSkip);
  assert.equal(languageSkip.reason, 'oversize');
  assert.equal(languageSkip.stage, 'pre-read');
  assert.equal(languageSkip.maxBytes, 1);

  const proseAllowed = await resolvePreReadSkip({
    abs: path.join(caseRoot, 'doc.md'),
    fileEntry: { abs: path.join(caseRoot, 'doc.md'), rel: 'doc.md' },
    fileStat: { size: 16 },
    ext: '.md',
    fileCaps: {
      default: { maxBytes: 1, maxLines: null },
      byMode: { prose: { maxBytes: 1024 } }
    },
    fileScanner: createFileScanner(null),
    runIo: (fn) => fn(),
    languageId: null,
    mode: 'prose',
    maxFileBytes: null
  });
  assert.equal(proseAllowed, null);
}

{
  const caseRoot = path.join(tempRoot, 'cached-bundle');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const abs = path.join(caseRoot, 'cached.ts');
  await fsPromises.writeFile(abs, 'line1\nline2\nline3\n', 'utf8');
  const fileStat = await fsPromises.lstat(abs);
  const outcome = reuseCachedBundle({
    abs,
    relKey: 'cached.ts',
    fileIndex: 0,
    fileStat,
    fileHash: null,
    fileHashAlgo: null,
    ext: '.ts',
    fileCaps: {
      default: { maxLines: 10, maxBytes: null },
      byLanguage: { typescript: { maxLines: 10 } }
    },
    maxFileBytes: null,
    cachedBundle: {
      chunks: [{
        start: 0,
        end: 10,
        endLine: 42,
        chunkUid: 'ck:cached-ts',
        virtualPath: 'cached.ts',
        metaV2: { chunkId: 'c1', chunkUid: 'ck:cached-ts', virtualPath: 'cached.ts' }
      }],
      fileRelations: {},
      vfsManifestRows: []
    },
    incrementalState: { manifest: { files: {} } },
    fileStructural: null,
    toolInfo: null,
    analysisPolicy: null,
    fileStart: Date.now(),
    knownLines: null,
    fileLanguageId: 'typescript',
    mode: 'code'
  });
  assert.ok(outcome?.skip);
  assert.equal(outcome.skip.reason, 'oversize');
  assert.equal(outcome.skip.stage, 'cached-reuse');
  assert.equal(outcome.skip.maxLines, 10);
}

for (const scenario of [
  {
    name: 'file-line-guard',
    fileName: 'too_many_lines.js',
    otherFile: 'ok.js',
    contentFactory: () => `${Array.from({ length: 6000 }, () => 'x'.repeat(1024)).join('\n')}\n`,
    otherContent: 'function ok() { return 1; }\n',
    expectedFile: 'too_many_lines.js',
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        treeSitter: { enabled: false }
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      }
    }
  },
  {
    name: 'file-size-guard',
    fileName: 'big.js',
    otherFile: 'small.js',
    contentFactory: () => `// big file\n${Array.from({ length: 6000 }, () => 'x'.repeat(1024)).join('\n')}\n`,
    otherContent: 'function ok() { return 1; }\n',
    expectedFile: 'big.js',
    testConfig: {
      indexing: {
        scm: { provider: 'none' }
      }
    }
  }
]) {
  const caseRoot = path.join(tempRoot, scenario.name);
  const repoRootRaw = path.join(caseRoot, 'repo');
  const cacheRoot = path.join(caseRoot, 'cache');
  await fsPromises.mkdir(repoRootRaw, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const repoRoot = scenario.name === 'file-line-guard' ? toRealPathSync(repoRootRaw) : repoRootRaw;
  await fsPromises.writeFile(path.join(repoRoot, scenario.fileName), scenario.contentFactory());
  await fsPromises.writeFile(path.join(repoRoot, scenario.otherFile), scenario.otherContent);

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: scenario.testConfig
  });
  const buildArgs = scenario.name === 'file-line-guard'
    ? [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage1', '--mode', 'code', '--repo', repoRoot]
    : [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot];
  const buildResult = spawnSync(process.execPath, buildArgs, { cwd: repoRoot, env, stdio: 'inherit' });
  assert.equal(buildResult.status, 0, `Failed: ${scenario.name} build_index`);

  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const fileLists = JSON.parse(await fsPromises.readFile(path.join(codeDir, '.filelists.json'), 'utf8'));
  const skippedSample = fileLists?.skipped?.sample;
  assert.ok(Array.isArray(skippedSample));
  const oversize = skippedSample.find((entry) => entry?.file && entry.file.endsWith(scenario.expectedFile));
  assert.ok(oversize);
  assert.equal(oversize.reason, 'oversize');

  const metrics = JSON.parse(await fsPromises.readFile(path.join(getMetricsDir(repoRoot, userConfig), 'index-code.json'), 'utf8'));
  assert.ok((metrics?.files?.skippedByReason?.oversize || 0) >= 1);
}

console.log('file-caps contract matrix test passed');
