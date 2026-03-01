#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getToolCatalog, getToolDefs, MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { DEFAULT_MODEL_ID } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

applyTestEnv();
const root = process.cwd();
const sampleRepo = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'mcp-schema');
const cacheRoot = path.join(tempRoot, 'cache');
const emptyRepo = path.join(tempRoot, 'empty');
const defaultCacheHome = path.join(tempRoot, 'default-cache-home');
const snapshotPath = path.join(root, 'tests', 'fixtures', 'mcp', 'schema-snapshot.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

// The config_status/index_status tools report dictionary paths based on the test-only fallback
// lookup in the default cache root. That default location depends on environment variables
// like XDG_CACHE_HOME / LOCALAPPDATA. In CI, the default cache is usually empty, while local
// dev machines often have dictionaries downloaded, causing snapshot instability.
//
// To keep the snapshot stable across environments, force the default cache root to a temp
// location and seed it with exactly one dictionary file and a placeholder vector extension
// binary. These are used by config_status/index_status via test-only fallback lookups that
// bypass PAIROFCLEATS_CACHE_ROOT.
const fallbackDictionaryFiles = [
  path.join(defaultCacheHome, 'pairofcleats', 'dictionaries', 'combined.txt'),
  path.join(defaultCacheHome, 'PairOfCleats', 'dictionaries', 'combined.txt')
];
for (const filePath of fallbackDictionaryFiles) {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, 'test\n', 'utf8');
}

// getExtensionsDir() uses getDefaultCacheRoot() in testing mode, which means the presence of the
// sqlite vector extension binary can change the warnings emitted by config_status. Create a
// zero-byte placeholder at the expected default path to make the snapshot deterministic.
const binarySuffix = process.platform === 'win32'
  ? '.dll'
  : (process.platform === 'darwin' ? '.dylib' : '.so');
const platformKey = `${process.platform}-${process.arch}`;
const extensionRelPath = path.join(
  'extensions',
  'sqlite-vec',
  platformKey,
  `vec0${binarySuffix}`
);
const fallbackExtensionFiles = [
  path.join(defaultCacheHome, 'pairofcleats', extensionRelPath),
  path.join(defaultCacheHome, 'PairOfCleats', extensionRelPath)
];
for (const filePath of fallbackExtensionFiles) {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, Buffer.alloc(0));
}

const shapeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => shapeValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = shapeValue(value[key]);
    }
    return out;
  }
  if (value === null) return '<null>';
  return `<${typeof value}>`;
};

const toolSchemaSnapshot = getToolDefs(DEFAULT_MODEL_ID).map((tool) => ({
  name: tool.name,
  required: Array.isArray(tool.inputSchema?.required)
    ? [...tool.inputSchema.required].sort()
    : [],
  properties: Object.keys(tool.inputSchema?.properties || {}).sort()
}));
const toolCatalog = getToolCatalog(DEFAULT_MODEL_ID);
if (!toolCatalog.schemaVersion) {
  throw new Error('MCP schemaVersion missing from tool catalog.');
}
if (toolCatalog.schemaVersion !== MCP_SCHEMA_VERSION) {
  throw new Error(`MCP schemaVersion mismatch (expected ${MCP_SCHEMA_VERSION}).`);
}
if (!toolCatalog.toolVersion) {
  throw new Error('MCP toolVersion missing from tool catalog.');
}

const findFirstDiff = (expected, actual, currentPath = '') => {
  if (expected === actual) return null;

  const classify = (value) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  const expectedType = classify(expected);
  const actualType = classify(actual);
  if (expectedType !== actualType) {
    return {
      path: currentPath || '<root>',
      expected,
      actual,
      reason: `type mismatch (${expectedType} vs ${actualType})`
    };
  }

  if (expectedType === 'array') {
    if (expected.length !== actual.length) {
      return {
        path: currentPath || '<root>',
        expected: `len=${expected.length}`,
        actual: `len=${actual.length}`,
        reason: 'array length mismatch'
      };
    }
    for (let i = 0; i < expected.length; i += 1) {
      const next = findFirstDiff(expected[i], actual[i], `${currentPath}[${i}]`);
      if (next) return next;
    }
    return null;
  }

  if (expectedType === 'object') {
    const expectedKeys = expected ? Object.keys(expected) : [];
    const actualKeys = actual ? Object.keys(actual) : [];
    expectedKeys.sort();
    actualKeys.sort();
    const expectedSet = new Set(expectedKeys);
    const actualSet = new Set(actualKeys);
    for (const key of expectedKeys) {
      if (!actualSet.has(key)) {
        return {
          path: currentPath ? `${currentPath}.${key}` : key,
          expected: '<present>',
          actual: '<missing>',
          reason: 'missing key'
        };
      }
    }
    for (const key of actualKeys) {
      if (!expectedSet.has(key)) {
        return {
          path: currentPath ? `${currentPath}.${key}` : key,
          expected: '<missing>',
          actual: '<present>',
          reason: 'unexpected key'
        };
      }
    }
    for (const key of expectedKeys) {
      const next = findFirstDiff(
        expected[key],
        actual[key],
        currentPath ? `${currentPath}.${key}` : key
      );
      if (next) return next;
    }
    return null;
  }

  return {
    path: currentPath || '<root>',
    expected,
    actual,
    reason: 'value mismatch'
  };
};

async function run(session) {
  session.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await session.readMessage();

  session.send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'index_status',
      arguments: { repoPath: sampleRepo }
    }
  });
  const status = await session.readMessage();
  const statusText = status.result?.content?.[0]?.text || '';
  const statusPayload = JSON.parse(statusText || '{}');

  session.send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: emptyRepo }
    }
  });
  const configStatus = await session.readMessage();
  const configText = configStatus.result?.content?.[0]?.text || '';
  const configPayload = JSON.parse(configText || '{}');

  session.send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await session.readMessage();
  session.send({ jsonrpc: '2.0', method: 'exit' });

  return {
    tools: toolSchemaSnapshot,
    responses: {
      index_status: shapeValue(statusPayload),
      config_status: shapeValue(configPayload)
    }
  };
}

const session = await startMcpServer({
  cacheRoot,
  timeoutMs: 30000,
  env: {
    // Force the default cache root to our seeded test directory to keep schema snapshots stable.
    XDG_CACHE_HOME: defaultCacheHome,
    LOCALAPPDATA: process.platform === 'win32' ? defaultCacheHome : ''
  }
});

run(session)
  .then(async (actual) => {
    try {
      const expectedRaw = await fsPromises.readFile(snapshotPath, 'utf8');
      const expected = JSON.parse(expectedRaw);
      const expectedStable = stableStringify(expected);
      const actualStable = stableStringify(actual);
      if (actualStable !== expectedStable) {
        console.error('MCP schema snapshot mismatch.');
        const diff = findFirstDiff(expected, actual);
        if (diff) {
          console.error(`First diff (${diff.reason}) at: ${diff.path}`);
          console.error(`Expected: ${JSON.stringify(diff.expected)}`);
          console.error(`Actual:   ${JSON.stringify(diff.actual)}`);
        }

        const debugActualPath = path.join(tempRoot, 'schema-snapshot.actual.json');
        const debugExpectedPath = path.join(tempRoot, 'schema-snapshot.expected.json');
        await fsPromises.writeFile(debugActualPath, `${actualStable}\n`, 'utf8');
        await fsPromises.writeFile(debugExpectedPath, `${expectedStable}\n`, 'utf8');
        console.error(`Wrote expected snapshot to: ${debugExpectedPath}`);
        console.error(`Wrote actual snapshot to:   ${debugActualPath}`);

        const updateSnapshots = process.env.PAIROFCLEATS_UPDATE_SNAPSHOTS === '1'
          || process.env.UPDATE_SNAPSHOTS === '1';
        if (updateSnapshots) {
          await fsPromises.writeFile(snapshotPath, `${actualStable}\n`, 'utf8');
          console.error(`Updated snapshot at: ${snapshotPath}`);
          return;
        }

        console.error('Set PAIROFCLEATS_UPDATE_SNAPSHOTS=1 to update schema-snapshot.json.');
        process.exitCode = 1;
        return;
      }
      console.log('MCP schema snapshot test passed');
    } finally {
      await session.shutdown();
    }
  })
  .catch(async (err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
    await session.shutdown();
  });
