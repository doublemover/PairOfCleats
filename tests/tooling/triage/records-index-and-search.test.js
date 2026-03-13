#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getTriageContext, run, runJson } from '../../helpers/triage.js';
import { getCurrentBuildInfo, getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const { root, repoRoot, triageFixtureRoot, env, writeTestLog } = await getTriageContext({
  name: 'triage-records-index'
});
const testEnv = { ...env };
const userConfig = loadUserConfig(repoRoot);
const cacheAwareConfig = {
  ...userConfig,
  cache: {
    ...(userConfig.cache || {}),
    root: testEnv.PAIROFCLEATS_CACHE_ROOT
  }
};
const resolveBuildRoot = (mode) => {
  const buildInfo = getCurrentBuildInfo(repoRoot, cacheAwareConfig, { mode });
  const activeRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
  if (activeRoot && fs.existsSync(activeRoot)) {
    return {
      buildId: buildInfo?.buildId || path.basename(activeRoot),
      buildRoot: activeRoot
    };
  }
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cacheAwareConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (fs.existsSync(currentPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
      const buildRoots = data.buildRootsByMode || data.buildRoots || {};
      const fromMode = typeof buildRoots?.[mode] === 'string' ? buildRoots[mode] : null;
      const fromBuildRoot = typeof data.buildRoot === 'string' ? data.buildRoot : null;
      const raw = fromMode || fromBuildRoot || null;
      if (raw) {
        const resolved = path.isAbsolute(raw) ? raw : path.join(repoCacheRoot, raw);
        if (fs.existsSync(resolved)) {
          return {
            buildId: typeof data.buildId === 'string' ? data.buildId : null,
            buildRoot: resolved
          };
        }
      }
    } catch {}
  }
  if (!fs.existsSync(buildsRoot)) return null;
  const latest = fs.readdirSync(buildsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latest) return null;
  const buildRoot = path.join(buildsRoot, latest);
  if (!fs.existsSync(buildRoot)) return null;
  return { buildId: latest, buildRoot };
};
const hasArtifactFile = (filePath) => (
  fs.existsSync(filePath)
  || fs.existsSync(`${filePath}.gz`)
  || fs.existsSync(`${filePath}.zst`)
  || fs.existsSync(`${filePath}.bak`)
);
const logExpectedArtifacts = async ({ label, mode }) => {
  const buildInfo = resolveBuildRoot(mode);
  if (!buildInfo?.buildRoot) {
    console.warn(`[triage-test] missing current build root for mode=${mode}`);
    return;
  }
  const indexDir = path.join(buildInfo.buildRoot, `index-${mode}`);
  const expectedArtifacts = [
    { name: 'chunk_meta', path: path.join(indexDir, 'chunk_meta.json') },
    { name: 'chunk_meta_stream', path: path.join(indexDir, 'chunk_meta.jsonl') },
    { name: 'chunk_meta_meta', path: path.join(indexDir, 'chunk_meta.meta.json') },
    { name: 'token_postings', path: path.join(indexDir, 'token_postings.json') },
    { name: 'token_postings_stream', path: path.join(indexDir, 'token_postings.jsonl') },
    { name: 'token_postings_meta', path: path.join(indexDir, 'token_postings.meta.json') },
    { name: 'phrase_ngrams', path: path.join(indexDir, 'phrase_ngrams.json') },
    { name: 'chargram_postings', path: path.join(indexDir, 'chargram_postings.json') },
    { name: 'index_state', path: path.join(indexDir, 'index_state.json') },
    { name: 'filelists', path: path.join(indexDir, '.filelists.json') },
    { name: 'pieces_manifest', path: path.join(indexDir, 'pieces', 'manifest.json') },
    { name: 'dense_vectors_code', path: path.join(indexDir, 'dense_vectors_code_uint8.json') },
    { name: 'dense_vectors_doc', path: path.join(indexDir, 'dense_vectors_doc_uint8.json') },
    { name: 'dense_vectors_merged', path: path.join(indexDir, 'dense_vectors_uint8.json') },
    { name: 'dense_vectors_lancedb', path: path.join(indexDir, 'dense_vectors.lancedb') },
    { name: 'dense_vectors_lancedb_meta', path: path.join(indexDir, 'dense_vectors.lancedb.meta.json') }
  ];
  const snapshot = expectedArtifacts.map((entry) => ({
    ...entry,
    exists: hasArtifactFile(entry.path)
  }));
  console.log(`[triage-test] ${label}: expected artifact locations for mode=${mode}`);
  for (const entry of snapshot) {
    console.log(`[triage-test] ${mode}:${entry.name} path=${entry.path} exists=${entry.exists}`);
  }
  await writeTestLog(`${label}-${mode}-artifact-locations.json`, {
    mode,
    buildId: buildInfo.buildId,
    buildRoot: buildInfo.buildRoot,
    indexDir,
    artifacts: snapshot
  });
};

const ingestGeneric = runJson('ingest-generic', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', path.join(triageFixtureRoot, 'generic.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env: testEnv });

if (!Array.isArray(ingestGeneric.recordIds) || ingestGeneric.recordIds.length === 0) {
  console.error('No records written for generic ingest.');
  process.exit(1);
}

run('build-index', [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--mode', 'code',
  '--repo', repoRoot
], { cwd: repoRoot, env: testEnv });
await logExpectedArtifacts({ label: 'post-build-index', mode: 'code' });

run('build-records-index', [
  path.join(root, 'build_index.js'),
  '--mode', 'records',
  '--stub-embeddings',
  '--repo', repoRoot
], { cwd: repoRoot, env: testEnv });
await logExpectedArtifacts({ label: 'post-build-records-index', mode: 'records' });

const recordSearch = runJson('search-records', [
  path.join(root, 'search.js'),
  'CVE-2024-0001',
  '--mode', 'records',
  '--meta', 'service=api',
  '--meta', 'env=prod',
  '--json',
  '--no-ann',
  '--repo', repoRoot
], { cwd: repoRoot, env: testEnv });

await writeTestLog('triage-record-search.json', recordSearch);

if (!Array.isArray(recordSearch.records) || recordSearch.records.length === 0) {
  console.error('Record search returned no results.');
  process.exit(1);
}

const firstRecord = recordSearch.records[0];
if (!firstRecord.docmeta?.record?.service || firstRecord.docmeta.record.service !== 'api') {
  console.error('Record search did not preserve docmeta.record.service.');
  process.exit(1);
}

console.log('Triage records index/search ok.');
