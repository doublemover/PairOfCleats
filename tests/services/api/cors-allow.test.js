#!/usr/bin/env node
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-cors-allow'
});
const origin = 'https://example.com';
const { serverInfo, requestJson, stop } = await cohort.start({
  allowedRoots: [],
  corsAllowedOrigins: ['example.com']
});

try {
  const allowed = await requestJson('GET', '/health', null, serverInfo, {
    headers: { Origin: origin }
  });
  if (allowed.status !== 200) {
    throw new Error('expected allowed origin to succeed');
  }
  const allowHeader = allowed.headers?.['access-control-allow-origin'];
  if (allowHeader !== origin) {
    throw new Error('expected access-control-allow-origin header to match origin');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API CORS allow test passed.');
