import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { prepareTestCacheDir } from './test-cache.js';

export const normalizeFixturePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

export const findFixtureEntryBySuffix = (entries, suffix) => {
  const normalizedSuffix = normalizeFixturePath(suffix);
  if (!Array.isArray(entries) || !normalizedSuffix) return null;
  return entries.find((entry) => normalizeFixturePath(entry?.file).endsWith(normalizedSuffix)) || null;
};

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
 * @param {{root:string,repoRoot:string,env:NodeJS.ProcessEnv}} input
 * @returns {void}
 */
export const runExtractedProseBuild = ({ root, repoRoot, env }) => {
  const buildResult = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings'],
    { cwd: repoRoot, env, stdio: 'inherit' }
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
