#!/usr/bin/env node
import { runSearchCli } from '../../../src/retrieval/cli.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const indexCache = new Map();
const sqliteCache = new Map();
let chain = Promise.resolve();

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
  try {
    const payload = await runSearchCli(args, {
      emitOutput: false,
      exitOnError: false,
      indexCache,
      sqliteCache
    });
    sendMessage({ id, ok: true, payload });
  } catch (err) {
    sendMessage({
      id,
      ok: false,
      error: {
        code: err?.code || 'ERR_QUERY_WORKER',
        message: err?.message || String(err)
      }
    });
  }
};

process.on('message', (message) => {
  if (message?.type === 'shutdown') {
    process.exit(0);
    return;
  }
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
