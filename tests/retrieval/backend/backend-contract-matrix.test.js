#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { evaluateAutoSqliteThresholds } from '../../../src/retrieval/cli/auto-sqlite.js';
import { resolveBackendSelection } from '../../../src/retrieval/cli/policy.js';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const backendMatrixTestConfig = {
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: {
      enabled: false
    }
  }
};

const runNode = (env, args, label) => {
  const result = spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

const baseBackendSelection = {
  sqliteScoreModeConfig: false,
  sqliteConfigured: true,
  sqliteAvailable: true,
  sqliteCodeAvailable: true,
  sqliteProseAvailable: true,
  sqliteCodePath: 'code.db',
  sqliteProsePath: 'prose.db',
  lmdbConfigured: true,
  lmdbAvailable: true,
  lmdbCodeAvailable: true,
  lmdbProseAvailable: true,
  lmdbCodePath: 'lmdb-code',
  lmdbProsePath: 'lmdb-prose',
  sqliteAutoChunkThreshold: 0,
  sqliteAutoArtifactBytes: 0,
  needsSqlite: true,
  needsCode: true,
  needsProse: false,
  root: process.cwd(),
  userConfig: {}
};

const cases = [
  {
    name: 'auto sqlite thresholds reject missing stats and allow satisfied thresholds',
    run() {
      const disabled = evaluateAutoSqliteThresholds({
        stats: [{ chunkCount: null, artifactBytes: null }],
        chunkThreshold: 0,
        artifactThreshold: 0
      });
      assert.equal(disabled.allowed, true);

      const missingChunks = evaluateAutoSqliteThresholds({
        stats: [{ chunkCount: null, artifactBytes: 1200 }],
        chunkThreshold: 10,
        artifactThreshold: 0
      });
      assert.equal(missingChunks.allowed, false);
      assert.match(missingChunks.reason || '', /chunk stats are unavailable/i);

      const missingBytes = evaluateAutoSqliteThresholds({
        stats: [{ chunkCount: 12, artifactBytes: null }],
        chunkThreshold: 0,
        artifactThreshold: 5000
      });
      assert.equal(missingBytes.allowed, false);
      assert.match(missingBytes.reason || '', /artifact bytes are unavailable/i);

      const tooSmall = evaluateAutoSqliteThresholds({
        stats: [{ chunkCount: 5, artifactBytes: 100 }],
        chunkThreshold: 10,
        artifactThreshold: 1000
      });
      assert.equal(tooSmall.allowed, false);
      assert.match(tooSmall.reason || '', /auto sqlite thresholds not met/i);

      const meetsBytes = evaluateAutoSqliteThresholds({
        stats: [{ chunkCount: 5, artifactBytes: 1500 }],
        chunkThreshold: 0,
        artifactThreshold: 1000
      });
      assert.equal(meetsBytes.allowed, true);
    }
  },
  {
    name: 'backend policy selects sqlite, lmdb fallback, and forced modes consistently',
    async run() {
      const autoResult = await resolveBackendSelection({
        ...baseBackendSelection,
        backendArg: ''
      });
      assert.equal(autoResult.useSqlite, true);
      assert.equal(autoResult.useLmdb, false);

      const lmdbFallback = await resolveBackendSelection({
        ...baseBackendSelection,
        backendArg: '',
        sqliteAvailable: false,
        sqliteCodeAvailable: false,
        lmdbAvailable: true
      });
      assert.equal(lmdbFallback.useSqlite, false);
      assert.equal(lmdbFallback.useLmdb, true);

      const forcedSqlite = await resolveBackendSelection({
        ...baseBackendSelection,
        backendArg: 'sqlite',
        sqliteAvailable: false,
        sqliteCodeAvailable: false
      });
      assert.ok(forcedSqlite.error);
      assert.match(forcedSqlite.error.message, /SQLite backend requested/);
      assert.match(forcedSqlite.error.message, /code=code\.db/);

      const forcedLmdb = await resolveBackendSelection({
        ...baseBackendSelection,
        backendArg: 'lmdb',
        lmdbAvailable: false,
        lmdbCodeAvailable: false
      });
      assert.ok(forcedLmdb.error);
      assert.match(forcedLmdb.error.message, /LMDB backend requested/);
      assert.match(forcedLmdb.error.message, /code=lmdb-code/);

      const forcedTantivy = await resolveBackendSelection({
        ...baseBackendSelection,
        backendArg: 'tantivy'
      });
      assert.equal(forcedTantivy.useSqlite, false);
      assert.equal(forcedTantivy.useLmdb, false);
      assert.equal(forcedTantivy.backendPolicy.backendLabel, 'tantivy');
      assert.equal(forcedTantivy.backendForcedTantivy, true);
    }
  },
  {
    name: 'sqlite fts remains eligible when only internal filters are active',
    async run() {
      let sqliteCalls = 0;
      const rankSqliteFts = () => {
        sqliteCalls += 1;
        return [{ idx: 0, score: 1 }];
      };
      const emptyAnnState = {
        code: { available: false },
        prose: { available: false },
        records: { available: false },
        'extracted-prose': { available: false }
      };
      const emptyAnnUsed = {
        code: false,
        prose: false,
        records: false,
        'extracted-prose': false
      };

      const pipeline = createSearchPipeline({
        useSqlite: true,
        sqliteFtsRequested: true,
        sqliteFtsNormalize: false,
        sqliteFtsProfile: null,
        sqliteFtsWeights: [],
        bm25K1: 1.2,
        bm25B: 0.75,
        fieldWeights: null,
        postingsConfig: { enablePhraseNgrams: false, enableChargrams: false },
        queryTokens: ['hello'],
        queryAst: null,
        phraseNgramSet: null,
        phraseRange: null,
        explain: false,
        symbolBoost: null,
        filters: { filePrefilter: { enabled: true } },
        filtersActive: undefined,
        topN: 5,
        annEnabled: false,
        annBackend: 'auto',
        scoreBlend: null,
        minhashMaxDocs: null,
        sparseBackend: 'auto',
        vectorAnnState: emptyAnnState,
        vectorAnnUsed: emptyAnnUsed,
        hnswAnnState: emptyAnnState,
        hnswAnnUsed: emptyAnnUsed,
        lanceAnnState: emptyAnnState,
        lanceAnnUsed: emptyAnnUsed,
        lancedbConfig: {},
        buildCandidateSetSqlite: () => new Set(),
        getTokenIndexForQuery: () => null,
        rankSqliteFts,
        rankVectorAnnSqlite: () => [],
        sqliteHasFts: () => true,
        signal: null,
        rrf: { enabled: false }
      });

      const hits = await pipeline({
        chunkMeta: [{ id: 0, file: 'foo.js', tokens: [] }],
        fileRelations: null,
        filterIndex: null,
        phraseNgrams: null,
        minhash: null,
        denseVec: null
      }, 'code', null);

      assert.equal(sqliteCalls, 1);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].file, 'foo.js');
    }
  },
  {
    name: 'strict and non-strict searches both fail once manifest embeddings are missing after cutover',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'retrieval-backend-contract-matrix');
      const fixtureRoot = path.join(tempRoot, 'repo');
      const cacheRoot = path.join(tempRoot, 'cache');
      const env = applyTestEnv({
        cacheRoot,
        embeddings: 'stub',
        testConfig: backendMatrixTestConfig
      });

      await fsPromises.rm(tempRoot, { recursive: true, force: true });
      await fsPromises.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
      await fsPromises.mkdir(cacheRoot, { recursive: true });
      await fsPromises.writeFile(
        path.join(fixtureRoot, 'src', 'token.js'),
        [
          'export function tokenMarker() {',
          '  return "token manifest backend";',
          '}',
          ''
        ].join('\n')
      );

      runNode(env, [
        path.join(root, 'build_index.js'),
        '--stub-embeddings',
        '--repo',
        fixtureRoot,
        '--stage',
        'stage1',
        '--mode',
        'code'
      ], 'build index');
      runNode(env, [
        path.join(root, 'tools', 'build', 'embeddings.js'),
        '--stub-embeddings',
        '--repo',
        fixtureRoot,
        '--mode',
        'code'
      ], 'build embeddings');

      const userConfig = loadUserConfig(fixtureRoot);
      const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
      const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
      await fsPromises.rm(manifestPath, { force: true });
      await fsPromises.rm(`${manifestPath}.bak`, { force: true });

      const searchArgs = [
        path.join(root, 'search.js'),
        'token',
        '--mode',
        'code',
        '--backend',
        'memory',
        '--json',
        '--repo',
        fixtureRoot
      ];

      const strictResult = spawnSync(process.execPath, searchArgs, { env, encoding: 'utf8' });
      assert.notEqual(strictResult.status, 0);
      const strictMessage = (() => {
        try { return JSON.parse(strictResult.stdout || '').message || ''; } catch { return strictResult.stdout || strictResult.stderr || ''; }
      })();
      assert.match(String(strictMessage), /manifest/i);

      const nonStrictResult = spawnSync(process.execPath, [...searchArgs, '--non-strict'], { env, encoding: 'utf8' });
      assert.notEqual(nonStrictResult.status, 0);
      const nonStrictMessage = (() => {
        try { return JSON.parse(nonStrictResult.stdout || '').message || ''; } catch { return nonStrictResult.stdout || nonStrictResult.stderr || ''; }
      })();
      assert.match(String(nonStrictMessage), /manifest/i);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('backend contract matrix test passed');
