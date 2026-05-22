#!/usr/bin/env node
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  fixtureName: 'call-sites-determinism',
  cacheName: 'api-server-stream',
  fixtureOptions: {
    requiredModes: ['code']
  }
});

let serverInfo = null;
let stopServer = null;
try {
  const started = await cohort.start();
  serverInfo = started.serverInfo;
  stopServer = started.stop;
  if (!serverInfo?.port) {
    throw new Error('api-server did not report a listening port');
  }

  const statusStream = await started.requestSse('GET', '/status/stream', null, serverInfo, {
    stopOnEvent: 'done'
  });
  const statusEvents = statusStream.events;
  const statusResult = statusEvents.find((evt) => evt.event === 'result');
  if (!statusResult?.data?.status?.repo?.root) {
    throw new Error('status stream missing repo payload');
  }
  const statusBody = JSON.stringify(statusResult.data || {});
  if (statusBody.includes(cohort.fixtureRoot) || statusBody.includes(cohort.cacheRoot)) {
    throw new Error('status stream leaked absolute paths');
  }

  const searchStream = await started.requestSse('POST', '/search/stream', { query: 'return', mode: 'code' }, serverInfo, {
    stopOnEvent: 'done'
  });
  const searchEvents = searchStream.events;
  const searchResult = searchEvents.find((evt) => evt.event === 'result');
  const hits = searchResult?.data?.result?.code || [];
  if (!hits.length) {
    throw new Error('search stream returned no results');
  }

  await started.requestSse('POST', '/search/stream', { query: 'return', mode: 'code' }, serverInfo, {
    abortAfterFirstChunk: true,
    abortTimeoutMs: 1000
  });
  const followUpStream = await started.requestSse('GET', '/status/stream', null, serverInfo, {
    stopOnEvent: 'done'
  });
  const followUp = followUpStream.events;
  const followResult = followUp.find((evt) => evt.event === 'result');
  if (!followResult?.data?.status?.repo?.root) {
    throw new Error('stream abort should not break subsequent requests');
  }
  const followBody = JSON.stringify(followResult.data || {});
  if (followBody.includes(cohort.fixtureRoot) || followBody.includes(cohort.cacheRoot)) {
    throw new Error('follow-up status stream leaked absolute paths');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  if (typeof stopServer === 'function') {
    await stopServer();
  }
}

console.log('api-server stream tests passed');

