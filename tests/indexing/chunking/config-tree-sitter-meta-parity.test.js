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

const assertConfigMeta = (chunks, format, label, nativeChunks = chunks) => {
  assert.ok(Array.isArray(chunks) && chunks.length > 0, `${label}: expected chunks`);
  assert.ok(Array.isArray(nativeChunks) && nativeChunks.length > 0, `${label}: expected native sections`);
  assert.ok(
    nativeChunks.some((chunk) => Number.isFinite(chunk?.meta?.startLine)),
    `${label}: expected tree-sitter metadata (meta.startLine)`
  );
  for (const chunk of new Set([...chunks, ...nativeChunks])) {
    assert.equal(chunk.meta?.format, format, `${label}: expected meta.format=${format}`);
    assert.ok(typeof chunk.kind === 'string' && chunk.kind.length > 0, `${label}: expected kind`);
  }
  for (const chunk of nativeChunks)
    assert.ok(typeof chunk.meta?.title === 'string' && chunk.meta.title.length > 0, `${label}: expected native meta.title`);
};

try {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });

  const log = () => {};
  const ok = await initTreeSitterRuntime({ log });
  assert.equal(ok, true, 'required native runtime must activate');
  const preload = await preloadTreeSitterLanguages(requiredLangs, { log, parallel: false });
  const missing = requiredLangs.filter((id) => !preload.loaded.includes(id));
  assert.deepEqual(missing, [], 'all four required config grammars must activate');
  const context = {
    log,
    yamlChunking: { mode: 'top-level' },
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

  const yamlText = 'db:\n  host: localhost\n  port: 5432\n';
  const yamlChunks = chunkYaml(yamlText, 'config.yaml', context);
  assertConfigMeta(yamlChunks, 'yaml', 'yaml', yamlChunks.flatMap(chunk => chunk.meta?.nativeSections || []));
  assert.ok(yamlChunks.every(chunk => chunk.meta.nativeParser === 'tree-sitter'
        && chunk.meta.documentEnvelopeSource === 'yaml-syntax-nodes'));
  assert.equal(yamlChunks.map(chunk => yamlText.slice(chunk.start, chunk.end)).join(''), yamlText);
  const root = chunkYaml(yamlText, 'config.yaml', { ...context, yamlChunking: { mode: 'root' } });
  assert.equal(root.length, 1);
  assert.equal(root[0].meta.nativeRouteReason, 'yaml-root-mode-precedence');
  assert.equal(root[0].meta.nativeSections, undefined, 'explicit root mode does not claim selected native sections');

  const tomlChunks = chunkIniToml('[db]\nhost = "localhost"\nport = 5432\n', 'toml', context);
  assertConfigMeta(tomlChunks, 'toml', 'toml');

  const xmlText = '<config><db host="localhost" port="5432"/></config>\n';
  const xmlChunks = chunkXml(xmlText, context);
  assertConfigMeta(xmlChunks, 'xml', 'xml', xmlChunks.filter(chunk => chunk.meta?.structuralRangeSource === 'native-node'));
  for (let offset = 0; offset < xmlText.length; offset++)
    assert.ok(xmlChunks.some(chunk => chunk.start <= offset && chunk.end > offset), 'XML document gaps retain source ownership');

  console.log('config tree-sitter meta parity test passed');
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}
