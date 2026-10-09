import { installEg2WorkerShutdownWatchdog } from './eg2-worker-watchdog.js';
import path from 'node:path';
import { getEmbeddingAdapter } from '../../shared/embedding-adapter.js';

const MAX_IPC_BYTES = 16 * 1024 * 1024;
let nonce = null, adapter = null, active = false, cancelling = false, nextHandle = 1, lastId = 0;
let finishing = false;
const prepared = new Map();
const bounded = message => {
  try { return Buffer.byteLength(JSON.stringify(message)) <= MAX_IPC_BYTES; }
  catch { return false; }
};
const send = message => {
  if (process.connected && bounded(message)) process.send(message);
};
const finish = async () => {
  if (active || finishing) return;
  finishing = true;
  prepared.clear();
  try { await adapter?.dispose?.(); } catch {}
  shutdown.clear();
  process.exit(0);
};
const shutdown = installEg2WorkerShutdownWatchdog({ onStop: () => { cancelling = true; void finish(); } });
const fatal = () => shutdown.beginStop();
process.on('message', async message => {
  if (!message || typeof message !== 'object' || !bounded(message)) { fatal(); return; }
  if (message.type === 'init') {
    const config = message.config;
    if (nonce || typeof message.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(message.nonce)
      || !config || config.fullProfile?.family !== 'embeddinggemma2'
      || config.fullProfile.dimensions !== 768 || config.fullProfile.maxLength !== 8192
      || !path.isAbsolute(config.modelsDir) || typeof config.localFilesOnly !== 'boolean'
      || typeof config.modelId !== 'string' || config.modelId.length > 200) { fatal(); return; }
    nonce = message.nonce;
    try {
      adapter = getEmbeddingAdapter({
        provider: 'xenova', modelId: config.modelId, modelsDir: config.modelsDir,
        modelProfile: config.fullProfile, normalize: true,
        localFilesOnly: config.localFilesOnly, sessionOptions: config.sessionOptions,
        modelFileName: config.modelFileName
      });
      send({ type: 'ready', nonce, pid: process.pid, info: adapter.executionInfo() });
    } catch { fatal(); }
    return;
  }
  if (!nonce || message.nonce !== nonce) { fatal(); return; }
  if (message.type === 'cancel') { shutdown.beginStop(); return; }
  if (cancelling) return;
  if (message.type !== 'request' || !Number.isSafeInteger(message.id)
    || message.id <= lastId || active
    || !['prepare', 'prepared', 'batch', 'query', 'endProfiling'].includes(message.method)) {
    fatal(); return;
  }
  lastId = message.id;
  active = true;
  try {
    let value;
    const input = message.value;
    if (message.method === 'prepare' || message.method === 'batch') {
      const maxCount = message.method === 'prepare' ? 256 : 64;
      if (!Array.isArray(input) || input.length > maxCount || input.some(text => typeof text !== 'string')
        || input.reduce((sum, text) => sum + Buffer.byteLength(text), 0) > 4 * 1024 * 1024) throw new Error('Input budget.');
      if (message.method === 'prepare') {
        prepared.clear();
        const items = await adapter.prepare(input);
        value = items.map(item => {
          const id = nextHandle++;
          prepared.set(id, item);
          return { id, tokenLength: item.tokenLength };
        });
      } else value = await adapter.embed(input);
    } else if (message.method === 'prepared') {
      if (!Array.isArray(input) || input.length > 64
        || input.some(id => !Number.isSafeInteger(id) || !prepared.has(id))) throw new Error('Invalid prepared handles.');
      value = await adapter.embedPrepared(input.map(id => prepared.get(id)));
    } else if (message.method === 'query') {
      if (typeof input !== 'string' || Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error('Query budget.');
      value = [await adapter.embedOne(input)];
    } else value = await adapter.endProfiling();
    if (!cancelling) send({ type: 'result', nonce, id: message.id, ok: true, value, info: adapter.executionInfo() });
  } catch {
    if (!cancelling) send({ type: 'result', nonce, id: message.id, ok: false });
  } finally {
    active = false;
    if (cancelling) void finish();
  }
});
