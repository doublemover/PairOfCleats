import assert from 'node:assert/strict';
import { configureLogger, createLoggerScope, getRecentLogEvents, log, setProgressHandlers } from '../../../src/shared/progress-runtime.js';

const restoreHandlers = setProgressHandlers({ log() {}, logLine() {}, logError() {} });
try {
  configureLogger({ enabled: false, ringMax: 4, ringMaxBytes: 4096 });
  for (let index = 0; index < 4; index += 1) log(`text${index}`, { secret: 'synthetic-secret', ok: index });
  configureLogger({ enabled: false, ringMax: 1, ringMaxBytes: 1024 });
  assert.equal(getRecentLogEvents().length, 1, 'shrinking bounds prunes immediately in text mode');
  assert.ok(!getRecentLogEvents()[0].meta.includes('synthetic-secret'));
  const outputA = [], outputB = [];
  const scopeA = createLoggerScope({ enabled: true, destination: { write: line => outputA.push(JSON.parse(line)) },
    context: { buildId: 'A', repoRoot: 'repo-A' }, redact: { paths: ['nested.secret'], remove: true } });
  let releaseA;
  const gate = new Promise(resolve => { releaseA = resolve; });
  const workA = scopeA.run(async () => { await gate; log('A late', { nested: { secret: 'hide-A', keep: 1 } }); });
  const scopeB = createLoggerScope({ enabled: true, destination: { write: line => outputB.push(JSON.parse(line)) },
    context: { buildId: 'B', repoRoot: 'repo-B' }, redact: { paths: ['*.token'], censor: 'MASK' } });
  scopeB.log('B now', { nested: { token: 'hide-B' } });
  releaseA();
  await workA;
  assert.equal(outputA.length, 1);
  assert.equal(outputA[0].buildId, 'A');
  assert.equal(outputA[0].repoRoot, 'repo-A');
  assert.deepEqual(outputA[0].nested, { keep: 1 });
  assert.equal(outputB[0].buildId, 'B');
  assert.equal(outputB[0].nested.token, 'MASK');
  assert.deepEqual(JSON.parse(scopeA.getRecentLogEvents()[0].meta).nested, { keep: 1 });
  assert.equal(JSON.parse(scopeB.getRecentLogEvents()[0].meta).nested.token, 'MASK');
  const circular = { secret: 'untouched', value: 1n }; circular.self = circular;
  const publicScope = createLoggerScope({ enabled: false, redact: false });
  publicScope.setProgressHandlers({ log() {} });
  publicScope.log('opt-out', circular);
  assert.equal(circular.secret, 'untouched');
  assert.equal(JSON.parse(publicScope.getRecentLogEvents()[0].meta).secret, 'untouched');
  assert.equal(JSON.parse(publicScope.getRecentLogEvents()[0].meta).value, '1');
  await Promise.all([scopeA.close(), scopeB.close(), publicScope.close()]);
} finally { restoreHandlers(); }
console.log('scoped logger ring redaction test passed');
