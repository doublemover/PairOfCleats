#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../../../src/config/validate.js';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';
import { loadConfigSchema } from '../../helpers/config-schema.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testConfig: null });
const schema = await loadConfigSchema();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-loader-schema-'));
const configPath = path.join(root, '.pairofcleats.json');

// Cover every declared key, including nested maps and all current union shapes.
// New schema properties automatically enter this projection-regression test.
const sample = (node, variant) => {
  if (node.enum) return node.enum[variant % node.enum.length];
  if (node.anyOf) return sample(node.anyOf[variant % node.anyOf.length], variant);
  const type = Array.isArray(node.type) ? node.type[variant % node.type.length] : node.type;
  switch (type) {
    case 'object': {
      const value = Object.fromEntries(
        Object.entries(node.properties || {}).map(([key, child]) => [key, sample(child, variant)])
      );
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        value.fixture = sample(node.additionalProperties, variant);
      }
      return value;
    }
    case 'array': return variant === 0 ? [] : [sample(node.items, variant)];
    case 'boolean': return variant === 1;
    case 'number':
    case 'integer': return Math.max(node.minimum ?? 0, variant);
    case 'null': return null;
    case 'string': return 'fixture';
    default: throw new Error(`Unhandled schema shape: ${JSON.stringify(node)}`);
  }
};

try {
  assert.deepEqual(loadUserConfig(root), {}, 'missing config must leave runtime defaults unset');
  for (let variant = 0; variant < 3; variant += 1) {
    const input = sample(schema, variant);
    const validation = validateConfig(schema, input);
    assert.equal(validation.ok, true, validation.errors.join('\n'));
    await fs.writeFile(configPath, JSON.stringify(input));
    const expected = structuredClone(input);
    expected.cache.root = path.resolve(root, input.cache.root);
    const warnings = [];
    const originalWarn = console.warn;
    try {
      console.warn = (message) => warnings.push(message);
      assert.deepEqual(loadUserConfig(root), expected, `schema field projection, variant ${variant}`);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1, 'unsupported legacy maxFileLines must be diagnosed');
    assert.match(warnings[0], /indexing.maxFileLines.*unsupported.*indexing.fileCaps.default.maxLines/);
  }

  // Extensible indexing/provider namespaces belong to their runtime consumers.
  const extensions = {
    indexing: {
      typeInference: false,
      workerPool: { enabled: false, maxWorkers: 1 },
      tinyRepoFastPath: { enabled: true, maxFiles: 12 },
      memory: { reserveRssMb: 512 },
      embeddings: { enabled: false, hnsw: { enabled: false } }
    },
    tooling: { pyright: { enabled: false, maxRetries: 0 } }
  };
  await fs.writeFile(configPath, JSON.stringify(extensions));
  assert.deepEqual(loadUserConfig(root), extensions);

  const normalizedInput = {
    cache: { root: '  ./cache  ' },
    search: { sqliteAutoChunkThreshold: -2, sqliteAutoArtifactBytes: 3.9 }
  };
  await fs.writeFile(configPath, JSON.stringify(normalizedInput));
  assert.deepEqual(loadUserConfig(root), {
    cache: { root: path.join(root, 'cache') },
    search: { sqliteAutoChunkThreshold: 0, sqliteAutoArtifactBytes: 3 }
  });

  // Preserving validated input must not turn strict namespaces into passthroughs.
  for (const input of [
    { unsupportedRootKey: true },
    { search: { unsupportedSearchKey: true } },
    { search: { annDefault: 'false' } },
    { search: { denseVectorMode: 'unknown' } },
    { indexing: { concurrency: '1' } }
  ]) {
    await fs.writeFile(configPath, JSON.stringify(input));
    assert.throws(() => loadUserConfig(root), /Config errors/);
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('config loader schema contract test passed');
