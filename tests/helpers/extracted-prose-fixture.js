import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';
import { prepareTestCacheDir } from './test-cache.js';
import { runNode } from './run-node.js';

export const normalizeFixturePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

export const findFixtureEntryBySuffix = (entries, suffix) => {
  const normalizedSuffix = normalizeFixturePath(suffix);
  if (!Array.isArray(entries) || !normalizedSuffix) return null;
  return entries.find((entry) => normalizeFixturePath(entry?.file).endsWith(normalizedSuffix)) || null;
};

export const hasFixtureWarning = (entry, warning) => (
  Array.isArray(entry?.warnings) && entry.warnings.includes(warning)
);

export const findFileByName = async (root, targetName) => {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const entries = await fsPromises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (entry.isFile() && entry.name === targetName) {
        return abs;
      }
    }
  }
  return null;
};

export const createStubPdfExtractionEnv = ({
  cacheRoot,
  maxPages,
  extraEnv = {}
}) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false },
      documentExtraction: {
        enabled: true,
        ...(maxPages == null ? {} : { maxPages })
      }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_STUB_PDF_EXTRACT: '1',
    ...extraEnv
  }
});

export const setupExtractedProseFixture = async (name, { root = process.cwd() } = {}) => {
  const { dir: tempRoot } = await prepareTestCacheDir(name, { root });
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const docsDir = path.join(repoRoot, 'docs');

  await fsPromises.mkdir(docsDir, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  return {
    root,
    tempRoot,
    repoRoot,
    cacheRoot,
    docsDir
  };
};

export const inspectExtractedProseState = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
  const indexRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
  const indexDir = indexRoot
    ? getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot })
    : null;

  return {
    userConfig,
    buildInfo,
    indexRoot,
    indexDir,
    buildStatePath: indexRoot ? path.join(indexRoot, 'build_state.json') : null,
    fileListsPath: indexDir ? path.join(indexDir, '.filelists.json') : null
  };
};

/**
 * Run build_index in extracted-prose mode for a fixture repo.
 *
 * @param {{root:string,repoRoot:string,env:NodeJS.ProcessEnv,noSqlite?:boolean,stage?:string|null}} input
 * @returns {void}
 */
export const runExtractedProseBuild = ({ root, repoRoot, env, noSqlite = true, stage = null }) => {
  const args = [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings'];
  if (stage) args.push('--stage', stage);
  if (noSqlite) args.push('--no-sqlite');
  const buildResult = runNode(
    args,
    'extracted-prose build_index',
    repoRoot,
    env,
    {
      stdio: 'inherit',
      allowFailure: true
    }
  );
  if (buildResult.status !== 0) {
    throw new Error(`build_index failed (status=${buildResult.status ?? 'null'})`);
  }
};

/**
 * Load extracted-prose state files for assertions.
 *
 * @param {string} repoRoot
 * @returns {Promise<{
 *   state: ReturnType<typeof inspectExtractedProseState>,
 *   buildState: object,
 *   extraction: object|null,
 *   fileLists: object|null,
 *   extractionReport: object|null
 * }>}
 */
export const readExtractedProseArtifacts = async (repoRoot) => {
  const state = inspectExtractedProseState(repoRoot);
  if (!state.indexRoot) {
    throw new Error('missing extracted-prose build root');
  }
  if (!state.buildStatePath || !fs.existsSync(state.buildStatePath)) {
    throw new Error('missing build_state.json');
  }
  const buildState = JSON.parse(await fsPromises.readFile(state.buildStatePath, 'utf8'));
  const extraction = buildState?.documentExtraction?.['extracted-prose'] || null;

  let fileLists = null;
  if (state.fileListsPath && fs.existsSync(state.fileListsPath)) {
    fileLists = JSON.parse(await fsPromises.readFile(state.fileListsPath, 'utf8'));
  }

  let extractionReport = null;
  if (state.indexDir) {
    const reportPath = path.join(state.indexDir, 'extraction_report.json');
    if (fs.existsSync(reportPath)) {
      extractionReport = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
    }
  }

  return { state, buildState, extraction, fileLists, extractionReport };
};
