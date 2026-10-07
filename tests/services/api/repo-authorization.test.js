#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-repo-auth'
});
const emptyRepo = path.join(cohort.cacheRoot, 'empty');
await fsPromises.mkdir(emptyRepo, { recursive: true });

const { serverInfo, requestJson, stop } = await cohort.start({
  allowedRoots: [emptyRepo]
});

try {
  const forbidden = await requestJson('POST', '/search', {
    repoPath: cohort.cacheRoot,
    query: 'return'
  }, serverInfo);
  if (forbidden.status !== 403 || forbidden.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed repo paths');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API repo authorization ok.');
