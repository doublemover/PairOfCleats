#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getToolCatalog, getToolDefs, MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { DEFAULT_MODEL_ID } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const serverPath = path.join(root, 'tools', 'mcp-server.js');
const sampleRepo = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'mcp-schema');
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

function encodeMessage(payload) {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function createReader(stream) {
  let buffer = Buffer.alloc(0);
  const tryRead = () => {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      return null;
    }
    const length = parseInt(match[1], 10);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return null;
    const body = buffer.slice(headerEnd + 4, total).toString('utf8');
    buffer = buffer.slice(total);
    return JSON.parse(body);
  };
  const notifications = [];
  const readRaw = async () => {
    const existing = tryRead();
    if (existing) return existing;
    return new Promise((resolve) => {
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const parsed = tryRead();
        if (!parsed) return;
        stream.off('data', onData);
        resolve(parsed);
      };
      stream.on('data', onData);
    });
  };
  const readMessage = async () => {
    while (true) {
      const parsed = await readRaw();
      if (parsed && parsed.method && parsed.id === undefined) {
        notifications.push(parsed);
        continue;
      }
      return parsed;
    }
  };
  return { readMessage, notifications };
}

const server = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_HOME: cacheRoot,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    // Force the default cache root to our seeded test directory to keep schema snapshots stable.
    XDG_CACHE_HOME: defaultCacheHome,
    LOCALAPPDATA: process.platform === 'win32' ? defaultCacheHome : ''
  }
});

const { readMessage } = createReader(server.stdout);
const timeout = setTimeout(() => {
  console.error('MCP schema test timed out.');
  server.kill('SIGKILL');
  process.exit(1);
}, 30000);

function send(payload) {
  server.stdin.write(encodeMessage(payload));
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

async function run() {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await readMessage();

  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'index_status',
      arguments: { repoPath: sampleRepo }
    }
  });
  const status = await readMessage();
  const statusText = status.result?.content?.[0]?.text || '';
  const statusPayload = JSON.parse(statusText || '{}');

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: emptyRepo }
    }
  });
  const configStatus = await readMessage();
  const configText = configStatus.result?.content?.[0]?.text || '';
  const configPayload = JSON.parse(configText || '{}');

  send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });

  return {
    tools: toolSchemaSnapshot,
    responses: {
      index_status: shapeValue(statusPayload),
      config_status: shapeValue(configPayload)
    }
  };
}

run()
  .then(async (actual) => {
    clearTimeout(timeout);
    server.stdin.end();
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
        process.exit(0);
      }

      console.error('Set PAIROFCLEATS_UPDATE_SNAPSHOTS=1 to update schema-snapshot.json.');
      process.exit(1);
    }
    console.log('MCP schema snapshot test passed');
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error(err?.message || err);
    server.kill('SIGKILL');
    process.exit(1);
  });

