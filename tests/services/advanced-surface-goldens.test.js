#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { URLSearchParams, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { computeIndexDiff } from '../../src/index/diffs/compute.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';
import { buildPerRepoArgsFromRequest } from '../../src/retrieval/federation/args.js';
import { runFederatedSearch } from '../../src/retrieval/federation/coordinator.js';
import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';
import { buildSearchParams, buildSearchPayloadFromQuery } from '../../tools/api/router/search.js';
import { getRepoCacheRoot, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { startApiServer } from '../helpers/api-server.js';
import { writeFederatedWorkspaceConfig } from '../helpers/federated-api.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const goldenPath = path.join(__dirname, 'golden', 'advanced-surface-goldens.json');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'advanced-surface-goldens');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const markerFile = 'src/phase14-advanced-surface.js';

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: {
        enabled: false,
        mode: 'off',
        lancedb: { enabled: false },
        hnsw: { enabled: false }
      }
    }
  },
  extraEnv: { PAIROFCLEATS_WORKER_POOL: 'off' }
});

const writeJson = async (filePath, value) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const runBuild = () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--repo',
      repoRoot,
      '--stage',
      'stage2',
      '--mode',
      'code',
      '--stub-embeddings',
      '--no-sqlite',
      '--progress',
      'off'
    ],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`build_index failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
};

const normalizeSearchHit = (hit) => ({
  file: hit?.file || null,
  start: Number(hit?.start ?? 0),
  end: Number(hit?.end ?? 0),
  repoAlias: hit?.repoAlias || null
});

const normalizeDiffRef = (value) => value
  ? {
    ref: value.ref || null,
    snapshotId: value.snapshotId || null
  }
  : null;

const normalizeDiffId = () => '<diff-id>';

const normalizeAsOfResponse = (response) => ({
  status: response.status,
  body: {
    ok: response.body?.ok === true,
    result: {
      asOf: {
        ref: response.body?.result?.asOf?.ref || null
      },
      code: Array.isArray(response.body?.result?.code)
        ? response.body.result.code.map(normalizeSearchHit)
        : []
    }
  }
});

const normalizeDiffShowResponse = (response) => ({
  status: response.status,
  body: {
    ok: response.body?.ok === true,
    diff: {
      entry: {
        id: normalizeDiffId(),
        from: normalizeDiffRef(response.body?.diff?.entry?.from || null),
        to: normalizeDiffRef(response.body?.diff?.entry?.to || null),
        modes: Array.isArray(response.body?.diff?.entry?.modes)
          ? response.body.diff.entry.modes.slice()
          : []
      },
      summary: response.body?.diff?.summary
        ? {
          id: normalizeDiffId(),
          from: normalizeDiffRef(response.body.diff.summary.from || null),
          to: normalizeDiffRef(response.body.diff.summary.to || null),
          modes: Array.isArray(response.body.diff.summary.modes)
            ? response.body.diff.summary.modes.slice()
            : [],
          limits: response.body.diff.summary.limits || null,
          totals: response.body.diff.summary.totals || null,
          truncated: response.body.diff.summary.truncated === true
        }
        : null,
      events: Array.isArray(response.body?.diff?.events)
        ? response.body.diff.events.map((event) => ({
          kind: event?.kind || null,
          file: event?.file || null,
          chunkId: event?.chunkId || null
        }))
        : []
    }
  }
});

const normalizeStreamedDiffEvents = (payload) => payload.map((event) => ({
  kind: event?.kind || null,
  file: event?.file || null,
  chunkId: event?.chunkId || null
}));

const normalizeFederatedArgs = (args) => args.map((entry) => String(entry));

const normalizeFederatedResponse = (response) => ({
  ok: response?.ok === true,
  backend: response?.backend || null,
  meta: {
    workspace: {
      name: response?.meta?.workspace?.name || '',
      workspaceId: '<workspace-id>'
    },
    selection: {
      selectedRepos: Array.isArray(response?.meta?.selection?.selectedRepos)
        ? response.meta.selection.selectedRepos.map((repo) => ({
          alias: repo?.alias || null,
          priority: Number(repo?.priority || 0),
          enabled: repo?.enabled !== false
        }))
        : []
    },
    limits: response?.meta?.limits || null
  },
  code: Array.isArray(response?.code) ? response.code.map(normalizeSearchHit) : [],
  repos: Array.isArray(response?.repos)
    ? response.repos.map((entry) => ({
      status: entry?.status || null,
      error: entry?.error
        ? {
          code: entry.error.code || null,
          message: entry.error.message || null
        }
        : null
    }))
    : [],
  warnings: Array.isArray(response?.warnings) ? response.warnings.slice() : []
});

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, markerFile), 'export const phase14_marker = "phase14alpha";\n', 'utf8');
runBuild();

const userConfig = loadUserConfig(repoRoot);
const snapshotA = 'snap-20260212000000-goldena';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotA
});

await fsPromises.writeFile(path.join(repoRoot, markerFile), 'export const phase14_marker = "phase14beta";\n', 'utf8');
runBuild();

const snapshotB = 'snap-20260212000000-goldenb';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotB
});

const diff = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: `snap:${snapshotA}`,
  to: `snap:${snapshotB}`,
  modes: ['code'],
  includeRelations: false
});

const { serverInfo, requestJson, requestRaw, stop } = await startApiServer({
  repoRoot,
  allowedRoots: [],
  env
});

const asOfQueryString = `q=phase14beta&mode=code&top=50&asOf=${encodeURIComponent(`snap:${snapshotB}`)}`;
const asOfPayloadInfo = buildSearchPayloadFromQuery(new URLSearchParams(asOfQueryString));
assert.deepEqual(asOfPayloadInfo.errors, [], 'expected as-of search query parsing to succeed');
const asOfParams = buildSearchParams(repoRoot, asOfPayloadInfo.payload, 'json');
assert.equal(asOfParams.ok, true, 'expected as-of search params to build');
const asOfResponse = await requestJson('GET', `/search?${asOfQueryString}`, null, serverInfo);

const diffShowPath = `/index/diffs/${diff.diffId}?format=jsonl&mode=code&kind=file.modified&max-events=1`;
const diffShowResponse = await requestJson('GET', diffShowPath, null, serverInfo);
const diffEventsPath = `/index/diffs/${diff.diffId}/events?mode=code&kind=file.modified&maxEvents=1`;
const diffEventsResponse = await requestRaw('GET', diffEventsPath, null, serverInfo);
await stop();

const diffEventLines = diffEventsResponse.body
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const federatedTempRoot = path.join(tempRoot, 'federated');
const federatedCacheRoot = path.join(federatedTempRoot, 'cache');
const repoA = path.join(federatedTempRoot, 'repo-a');
const repoB = path.join(federatedTempRoot, 'repo-b');
const workspacePath = path.join(federatedTempRoot, '.pairofcleats-workspace.jsonc');

const writeFederatedRepo = async (repoPath, alias) => {
  await fsPromises.mkdir(repoPath, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q'], {
    cwd: repoPath,
    encoding: 'utf8'
  });
  if (gitInit.status !== 0) {
    throw new Error(`git init failed for ${repoPath}: ${gitInit.stderr || gitInit.stdout || 'unknown error'}`);
  }
  await fsPromises.writeFile(path.join(repoPath, '.pairofcleats.json'), JSON.stringify({
    cache: { root: federatedCacheRoot }
  }, null, 2), 'utf8');
  const repoCache = getRepoCacheRoot(repoPath);
  const buildRoot = path.join(repoCache, 'builds', 'test-build');
  await fsPromises.mkdir(path.join(repoCache, 'builds'), { recursive: true });
  await fsPromises.writeFile(path.join(repoCache, 'builds', 'current.json'), JSON.stringify({
    buildId: 'test-build',
    buildRoot,
    modes: ['code']
  }, null, 2), 'utf8');
  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    chunkMeta: [
      {
        id: 0,
        file: `src/${alias}.js`,
        start: 1,
        end: 1
      }
    ],
    tokenPostings: {
      vocab: ['risky', alias],
      postings: [
        [[0, 1]],
        [[0, 1]]
      ],
      docLengths: [1],
      avgDocLen: 1,
      totalDocs: 1
    },
    indexState: {
      generatedAt: '2026-02-12T00:10:00.000Z',
      mode: 'code',
      artifactSurfaceVersion: '0.2.0',
      compatibilityKey: 'compat-code'
    }
  });
  await replaceDir(indexDir, path.join(buildRoot, 'index-code'));
  await fsPromises.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });
};

await writeFederatedRepo(repoA, 'alpha');
await writeFederatedRepo(repoB, 'beta');
await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot: federatedCacheRoot,
  repos: [
    { root: repoA, alias: 'alpha', priority: 10, tags: ['team-a'] },
    { root: repoB, alias: 'beta', priority: 5, tags: ['team-b'] }
  ]
});

const federatedWorkspaceRequest = {
  workspacePath,
  query: 'workspace-risk',
  select: {
    tag: ['team-a']
  },
  search: {
    mode: 'code',
    top: 3
  },
  limits: {
    perRepoTop: 4,
    concurrency: 1
  }
};

const federatedRiskRequest = {
  workspacePath,
  query: 'risky',
  search: {
    mode: 'code',
    top: 3,
    riskTag: 'security',
    riskCategory: 'injection',
    riskFlow: 'request.body->eval'
  },
  limits: {
    perRepoTop: 4,
    concurrency: 1
  }
};

const federatedRiskDegradedRequest = {
  ...federatedRiskRequest,
  query: 'risky-degraded'
};

const federatedWorkspaceArgs = buildPerRepoArgsFromRequest({
  query: federatedWorkspaceRequest.query,
  search: federatedWorkspaceRequest.search,
  perRepoTop: federatedWorkspaceRequest.limits.perRepoTop
});
const federatedRiskArgs = buildPerRepoArgsFromRequest({
  query: federatedRiskRequest.query,
  search: federatedRiskRequest.search,
  perRepoTop: federatedRiskRequest.limits.perRepoTop
});
const federatedRiskDegradedArgs = buildPerRepoArgsFromRequest({
  query: federatedRiskDegradedRequest.query,
  search: federatedRiskDegradedRequest.search,
  perRepoTop: federatedRiskDegradedRequest.limits.perRepoTop
});

const federatedSearchFn = async (repoRootCanonical) => {
  const alias = path.basename(repoRootCanonical) === 'repo-a' ? 'alpha' : 'beta';
  return {
    backend: 'memory',
    code: [
      {
        id: `hit-${alias}`,
        file: `src/${alias}.js`,
        start: 1,
        end: 1,
        score: alias === 'alpha' ? 10 : 5
      }
    ],
    prose: [],
    extractedProse: [],
    records: []
  };
};

const federatedWorkspaceResponse = await runFederatedSearch(federatedWorkspaceRequest, {
  searchFn: federatedSearchFn
});
const federatedRiskResponse = await runFederatedSearch(federatedRiskRequest, {
  searchFn: federatedSearchFn
});
const federatedRiskDegradedResponse = await runFederatedSearch(federatedRiskDegradedRequest, {
  searchFn: async (repoRootCanonical) => {
    if (path.basename(repoRootCanonical) === 'repo-a') {
      throw createError(ERROR_CODES.NO_INDEX, 'simulated missing index');
    }
    return await federatedSearchFn(repoRootCanonical);
  }
});

const snapshot = {
  apiSearchAsOf: {
    request: {
      queryString: asOfQueryString,
      payload: asOfPayloadInfo.payload,
      args: asOfParams.args
    },
    response: normalizeAsOfResponse(asOfResponse)
  },
  apiDiffFiltered: {
    request: {
      showPath: '/index/diffs/<diff-id>?format=jsonl&mode=code&kind=file.modified&max-events=1',
      eventsPath: '/index/diffs/<diff-id>/events?mode=code&kind=file.modified&maxEvents=1'
    },
    response: normalizeDiffShowResponse(diffShowResponse),
    streamedEvents: normalizeStreamedDiffEvents(diffEventLines)
  },
  federatedWorkspace: {
    request: {
      payload: {
        query: federatedWorkspaceRequest.query,
        select: federatedWorkspaceRequest.select,
        search: federatedWorkspaceRequest.search,
        limits: federatedWorkspaceRequest.limits
      },
      args: normalizeFederatedArgs(federatedWorkspaceArgs)
    },
    response: normalizeFederatedResponse(federatedWorkspaceResponse)
  },
  federatedRisk: {
    request: {
      payload: {
        query: federatedRiskRequest.query,
        search: federatedRiskRequest.search,
        limits: federatedRiskRequest.limits
      },
      args: normalizeFederatedArgs(federatedRiskArgs)
    },
    successResponse: normalizeFederatedResponse(federatedRiskResponse),
    degradedRequest: {
      payload: {
        query: federatedRiskDegradedRequest.query,
        search: federatedRiskDegradedRequest.search,
        limits: federatedRiskDegradedRequest.limits
      },
      args: normalizeFederatedArgs(federatedRiskDegradedArgs)
    },
    degradedResponse: normalizeFederatedResponse(federatedRiskDegradedResponse)
  }
};

if (!fs.existsSync(goldenPath)) {
  console.log(stableStringify(snapshot));
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
assert.deepEqual(snapshot, expected, 'advanced surface golden drift detected');

console.log('advanced surface goldens test passed');
