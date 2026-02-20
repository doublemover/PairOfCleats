#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats,
  shutdownTreeSitterWorkerPool
} from '../../../src/lang/tree-sitter.js';
import { chunkIniToml, chunkJson, chunkXml, chunkYaml } from '../../../src/index/chunking.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('config tree-sitter meta parity test timed out');
  process.exit(1);
}, 20000);

const requiredLangs = ['json', 'yaml', 'toml', 'xml'];

const assertConfigMeta = (chunks, format, label) => {
  assert.ok(Array.isArray(chunks) && chunks.length > 0, `${label}: expected chunks`);
  assert.ok(
    chunks.some((chunk) => Number.isFinite(chunk?.meta?.startLine)),
    `${label}: expected tree-sitter metadata (meta.startLine)`
  );
  for (const chunk of chunks) {
    assert.equal(chunk.meta?.format, format, `${label}: expected meta.format=${format}`);
    assert.ok(typeof chunk.meta?.title === 'string' && chunk.meta.title.length > 0, `${label}: expected meta.title`);
    assert.ok(typeof chunk.kind === 'string' && chunk.kind.length > 0, `${label}: expected kind`);
  }
};

try {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });

  const log = () => {};
  const ok = await initTreeSitterRuntime({ log });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping config tree-sitter meta parity test.');
  } else {
    const preload = await preloadTreeSitterLanguages(requiredLangs, { log, parallel: false });
    const missing = requiredLangs.filter((id) => !preload.loaded.includes(id));
    if (missing.length) {
      console.log(`tree-sitter missing config grammars (${missing.join(', ')}); skipping config tree-sitter meta parity test.`);
    } else {
      const context = {
        log,
        treeSitter: {
          enabled: true,
          strict: true,
          configChunking: true,
          languages: {
            json: true,
            yaml: true,
            toml: true,
            xml: true
          }
        }
      };

      const jsonChunks = chunkJson('{"db":{"host":"localhost","port":5432}}', context);
      assertConfigMeta(jsonChunks, 'json', 'json');

      const yamlChunks = chunkYaml('db:\n  host: localhost\n  port: 5432\n', 'config.yaml', context);
      assertConfigMeta(yamlChunks, 'yaml', 'yaml');

      const tomlChunks = chunkIniToml('[db]\nhost = "localhost"\nport = 5432\n', 'toml', context);
      assertConfigMeta(tomlChunks, 'toml', 'toml');

      const xmlChunks = chunkXml('<config><db host="localhost" port="5432"/></config>\n', context);
      assertConfigMeta(xmlChunks, 'xml', 'xml');
    }
  }

  console.log('config tree-sitter meta parity test passed');
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}
