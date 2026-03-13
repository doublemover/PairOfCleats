#!/usr/bin/env node
import { runSearchCli } from '../../../src/retrieval/cli.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const envConfig = getEnvConfig();
const HEARTBEAT_MS = Number.isFinite(Number(envConfig.tests?.benchQueryWorkerHeartbeatMs))
  ? Math.max(250, Math.floor(Number(envConfig.tests.benchQueryWorkerHeartbeatMs)))
  : 5000;
const indexCache = new Map();
const sqliteCache = new Map();
let chain = Promise.resolve();
let shutdownRequested = false;

const sendMessage = (payload) => {
  if (typeof process.send !== 'function') return;
  try {
    process.send(payload);
  } catch {}
};

const runMessage = async (message) => {
  const id = Number(message?.id);
  const args = Array.isArray(message?.args) ? message.args : null;
  if (!Number.isFinite(id) || !args) {
    sendMessage({
      id,
      ok: false,
      error: { code: 'ERR_QUERY_WORKER_REQUEST', message: 'Invalid query worker request.' }
    });
    return;
  }
  const startedAt = Date.now();
  sendMessage({ type: 'run-start', id, elapsedMs: 0 });
  const heartbeat = setInterval(() => {
    sendMessage({
      type: 'run-heartbeat',
      id,
      elapsedMs: Date.now() - startedAt,
      rssBytes: Number(process.memoryUsage?.().rss || 0)
    });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const payload = await runSearchCli(args, {
      emitOutput: false,
      exitOnError: false,
      indexCache,
      sqliteCache
    });
    sendMessage({ type: 'run-complete', id, elapsedMs: Date.now() - startedAt });
    sendMessage({ id, ok: true, payload });
  } catch (err) {
    sendMessage({ type: 'run-complete', id, elapsedMs: Date.now() - startedAt });
    sendMessage({
      id,
      ok: false,
      error: {
        code: err?.code || 'ERR_QUERY_WORKER',
        message: err?.message || String(err)
      }
    });
  } finally {
    clearInterval(heartbeat);
  }
};

process.on('message', (message) => {
  if (message?.type === 'shutdown') {
    shutdownRequested = true;
    chain = chain.finally(() => {
      process.exit(0);
    });
    return;
  }
  if (shutdownRequested) return;
  if (message?.type !== 'run') return;
  chain = chain
    .then(() => runMessage(message))
    .catch((err) => {
      sendMessage({
        id: Number(message?.id),
        ok: false,
        error: {
          code: err?.code || 'ERR_QUERY_WORKER_CHAIN',
          message: err?.message || String(err)
        }
      });
    });
});
