#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApiRouter } from '../../tools/api/router.js';
import { startMcpSdkServer } from '../../tools/mcp/server-sdk.js';
import { __setTransformersModuleLoaderForTests,
  disposeEmbeddingAdapterCaches } from '../../src/shared/embedding-adapter.js';
import { getQueryEmbedding } from '../../src/retrieval/embedding.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('service-embedding-cache-shutdown');
const modelId = 'fixture/service';
const root = path.join(dir, modelId);
await fs.mkdir(path.join(root, 'onnx'), { recursive: true });
await fs.writeFile(path.join(root, 'onnx/model_quantized.onnx'), 'controlled weights');
await fs.writeFile(path.join(root, 'tokenizer.json'), '{}');
let creates = 0, releases = 0, entered, releaseRun, held;
__setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
  creates++;
  let disposed = false;
  const pipeline = async texts => {
    assert.equal(disposed, false);
    if (texts.includes('held')) { entered(); await held; }
    assert.equal(disposed, false, 'service shutdown must not dispose a sibling active query');
    return texts.map(() => Float32Array.from([1, 2, 3]));
  };
  pipeline.dispose = async () => { assert.equal(disposed, false); disposed = true; releases++; };
  return pipeline;
} }));
const query = text => getQueryEmbedding({ text, provider: 'xenova', modelId, modelDir: dir, rootDir: dir, dims: 3 });
try {
  for (const kind of ['api', 'mcp']) {
    let service, client;
    const started = new Promise(resolve => { entered = resolve; });
    held = new Promise(resolve => { releaseRun = resolve; });
    if (kind === 'api') service = createApiRouter({ host: '127.0.0.1', defaultRepo: dir });
    else {
      const [clientTransport, transport] = InMemoryTransport.createLinkedPair();
      service = await startMcpSdkServer({ toolDefs: [], serverInfo: { name: 'embedding-shutdown', version: '1' },
        queueMax: 4, resolveToolTimeoutMs: () => 1000, transport });
      client = new Client({ name: 'embedding-shutdown-client', version: '1' });
      await client.connect(clientTransport);
    }
    try {
      await query('warm');
      const pending = query('held');
      await started;
      let settled = false;
      const closing = service.close();
      closing.then(() => { settled = true; });
      assert.strictEqual(service.close(), closing);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, kind + ' shutdown joins the outstanding query lease');
      assert.equal(releases, creates - 1);
      releaseRun();
      assert.deepEqual(await pending, Float32Array.from([1, 2, 3]));
      await closing;
      assert.equal(releases, creates, kind + ' shutdown releases the warm native owner');
    } finally {
      releaseRun();
      await service.close();
      await client?.close();
    }
  }
} finally {
  releaseRun?.();
  await disposeEmbeddingAdapterCaches();
  __setTransformersModuleLoaderForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('API and MCP shutdown retire warm query caches after sibling active leases drain.');
