#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { computeIndexDiff } from '../../src/index/diffs/compute.js';
import { loadUserConfig } from '../../tools/shared/dict-utils.js';
import { startApiServer } from '../helpers/api-server.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'api-search-asof-service');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.cp(fixtureRoot, repoRoot, { recursive: true });

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

const runBuild = () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--repo',
      repoRoot,
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

const requestText = (serverInfo, requestPath, authToken = 'test-token') => new Promise((resolve, reject) => {
  const req = http.request(
    {
      host: serverInfo.host,
      port: serverInfo.port,
      path: requestPath,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body, headers: res.headers || {} });
      });
    }
  );
  req.on('error', reject);
  req.end();
});

const markerPath = path.join(repoRoot, 'src', 'phase14-api-asof.js');
await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, 'export const phase14_api_marker = "phase14alpha";\n', 'utf8');
runBuild();

const userConfig = loadUserConfig(repoRoot);
const snapshotA = 'snap-20260212000000-apiaa';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotA
});

await fs.writeFile(markerPath, 'export const phase14_api_marker = "phase14beta";\n', 'utf8');
runBuild();

const snapshotB = 'snap-20260212000000-apibb';
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
  modes: ['code']
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot,
  allowedRoots: [],
  env
});

try {
  const responseA = await requestJson(
    'GET',
    `/search?q=phase14alpha&mode=code&top=50&snapshotId=${encodeURIComponent(snapshotA)}`,
    null,
    serverInfo
  );
  assert.equal(responseA.status, 200);
  assert.equal(responseA.body?.ok, true);
  assert.equal(responseA.body?.result?.asOf?.ref, `snap:${snapshotA}`);

  const hitA = Array.isArray(responseA.body?.result?.code)
    ? responseA.body.result.code.find((hit) => String(hit.file || '').includes('phase14-api-asof.js'))
    : null;
  assert.ok(hitA, 'snapshot A search should include marker file');

  const responseB = await requestJson(
    'GET',
    `/search?q=phase14alpha&mode=code&top=50&asOf=${encodeURIComponent(`snap:${snapshotB}`)}`,
    null,
    serverInfo
  );
  assert.equal(responseB.status, 200);
  assert.equal(responseB.body?.ok, true);
  assert.equal(responseB.body?.result?.asOf?.ref, `snap:${snapshotB}`);

  const hitB = Array.isArray(responseB.body?.result?.code)
    ? responseB.body.result.code.find((hit) => String(hit.file || '').includes('phase14-api-asof.js'))
    : null;
  assert.ok(hitB, 'snapshot B search should include marker file');
  assert.notEqual(hitA?.end ?? null, hitB?.end ?? null, 'snapshot A and B search results should differ');

  const responseLatest = await requestJson(
    'GET',
    '/search?q=phase14beta&mode=code&top=50',
    null,
    serverInfo
  );
  assert.equal(responseLatest.status, 200);
  assert.equal(responseLatest.body?.ok, true);
  assert.equal(responseLatest.body?.result?.asOf?.ref, 'latest');

  const snapshotsList = await requestJson('GET', '/index/snapshots', null, serverInfo);
  assert.equal(snapshotsList.status, 200);
  assert.equal(snapshotsList.body?.ok, true);
  assert.ok(
    Array.isArray(snapshotsList.body?.snapshots)
    && snapshotsList.body.snapshots.some((entry) => entry.snapshotId === snapshotA)
    && snapshotsList.body.snapshots.some((entry) => entry.snapshotId === snapshotB),
    'snapshot list endpoint should include both snapshots'
  );

  const snapshotShow = await requestJson('GET', `/index/snapshots/${snapshotA}`, null, serverInfo);
  assert.equal(snapshotShow.status, 200);
  assert.equal(snapshotShow.body?.ok, true);
  assert.equal(snapshotShow.body?.snapshot?.entry?.snapshotId, snapshotA);

  const diffsList = await requestJson('GET', '/index/diffs', null, serverInfo);
  assert.equal(diffsList.status, 200);
  assert.equal(diffsList.body?.ok, true);
  assert.ok(
    Array.isArray(diffsList.body?.diffs)
    && diffsList.body.diffs.some((entry) => entry.id === diff.diffId),
    'diff list endpoint should include computed diff'
  );

  const diffsListModeAlias = await requestJson('GET', '/index/diffs?mode=code', null, serverInfo);
  assert.equal(diffsListModeAlias.status, 200);
  assert.equal(diffsListModeAlias.body?.ok, true);
  assert.ok(
    Array.isArray(diffsListModeAlias.body?.diffs)
    && diffsListModeAlias.body.diffs.some((entry) => entry.id === diff.diffId),
    'diff list should accept mode alias query param'
  );

  const diffShow = await requestJson('GET', `/index/diffs/${diff.diffId}`, null, serverInfo);
  assert.equal(diffShow.status, 200);
  assert.equal(diffShow.body?.ok, true);
  assert.equal(diffShow.body?.diff?.entry?.id, diff.diffId);

  const diffShowShaped = await requestJson(
    'GET',
    `/index/diffs/${diff.diffId}?format=jsonl&mode=code&kind=file.modified&max-events=1`,
    null,
    serverInfo
  );
  assert.equal(diffShowShaped.status, 200);
  assert.equal(diffShowShaped.body?.ok, true);
  assert.ok(Array.isArray(diffShowShaped.body?.diff?.events), 'jsonl format should include events in diff payload');
  assert.ok((diffShowShaped.body?.diff?.events || []).length <= 1, 'max-events should cap diff payload events');
  for (const event of diffShowShaped.body?.diff?.events || []) {
    assert.equal(event.kind, 'file.modified', 'kind filter should shape diff payload events');
  }

  const diffEvents = await requestText(serverInfo, `/index/diffs/${diff.diffId}/events`);
  assert.equal(diffEvents.status, 200);
  assert.ok(String(diffEvents.headers['content-type'] || '').includes('application/x-ndjson'));
  const eventLines = diffEvents.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(eventLines.length > 0, 'diff events endpoint should return at least one event');

  const diffEventsShaped = await requestText(
    serverInfo,
    `/index/diffs/${diff.diffId}/events?mode=code&kind=file.modified&maxEvents=1`
  );
  assert.equal(diffEventsShaped.status, 200);
  const shapedEventLines = diffEventsShaped.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(shapedEventLines.length <= 1, 'maxEvents should cap streamed diff events');
  for (const event of shapedEventLines) {
    assert.equal(event.kind, 'file.modified', 'kind filter should shape streamed diff events');
  }

  const statusResponse = await requestJson('GET', '/status', null, serverInfo);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.body?.ok, true);
  assert.ok(statusResponse.body?.status?.repo?.root, 'status endpoint should include repo payload');

  const combinedBodies = JSON.stringify({
    responseA: responseA.body,
    responseB: responseB.body,
    responseLatest: responseLatest.body,
    snapshotsList: snapshotsList.body,
    snapshotShow: snapshotShow.body,
    diffsList: diffsList.body,
    diffShow: diffShow.body,
    statusResponse: statusResponse.body,
    eventLines
  });
  assert.equal(combinedBodies.includes(repoRoot), false, 'API responses should not expose absolute repo paths');
} finally {
  await stop();
}

console.log('API search as-of service test passed');
