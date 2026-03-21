#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { createCli } from '../../src/shared/cli.js';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../src/shared/jsonrpc.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import {
  registerChildProcessForCleanup,
  terminateTrackedSubprocesses
} from '../../src/shared/subprocess.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

const root = resolveToolRoot();
const cli = createCli({
  scriptName: 'pairofcleats release verify-surface',
  options: {
    surface: { type: 'string' },
    stage: { type: 'string' },
    out: { type: 'string', default: '' },
    'install-root': { type: 'string', default: '' },
    'capture-out-dir': { type: 'string', default: '' }
  }
}).strictOptions();

const argv = cli.parse();

const surfaceId = String(argv.surface || '').trim();
const stage = String(argv.stage || '').trim().toLowerCase();

const allowedSurfaces = new Set(['api', 'mcp', 'vscode', 'sublime', 'tui']);
const allowedStages = new Set(['boot', 'smoke', 'install']);

if (!allowedSurfaces.has(surfaceId)) {
  console.error(`unsupported release verification surface: ${surfaceId || '(missing)'}`);
  process.exit(1);
}
if (!allowedStages.has(stage)) {
  console.error(`unsupported release verification stage: ${stage || '(missing)'}`);
  process.exit(1);
}

const defaultOutPath = path.join(root, 'dist', 'release-verification', surfaceId, stage, 'verification.json');
const outPath = path.resolve(root, String(argv.out || '').trim() || defaultOutPath);
const outDir = path.dirname(outPath);

const normalizePath = (value) => path.relative(root, value).replace(/\\/g, '/');
const ensureParentDir = async (filePath) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
};

const writeResult = async (payload) => {
  await ensureParentDir(outPath);
  await fsPromises.writeFile(outPath, `${stableStringify(payload)}\n`);
  process.stdout.write(`${stableStringify(payload)}\n`);
};

const fail = async (message, details = {}) => {
  const payload = {
    ok: false,
    surface: surfaceId,
    stage,
    error: message,
    ...details
  };
  await writeResult(payload);
  process.exit(1);
};

const runNodeChecked = (args, { cwd = root, env = process.env, timeoutMs = 30000 } = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
    killSignal: 'SIGTERM'
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `command failed: node ${args.join(' ')}`,
        result.stderr?.trim() || result.stdout?.trim() || `exit=${result.status ?? 'null'}`
      ].filter(Boolean).join('\n\n')
    );
  }
  return result;
};

const createVerificationEnv = (label) => {
  const tempRoot = path.join(root, 'dist', 'release-verification', surfaceId, stage, label);
  const cacheRoot = path.join(tempRoot, 'cache');
  const testConfig = {
    sqlite: { use: false },
    indexing: {
      embeddings: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  };
  return {
    tempRoot,
    env: {
      ...process.env,
      PAIROFCLEATS_TESTING: '1',
      PAIROFCLEATS_HOME: tempRoot,
      PAIROFCLEATS_CACHE_ROOT: cacheRoot,
      PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig)
    }
  };
};

const ensureFixtureIndex = ({ env, fixtureName = 'sample' }) => {
  const fixtureRoot = path.join(root, 'tests', 'fixtures', fixtureName);
  runNodeChecked([
    'bin/pairofcleats.js',
    'index',
    'build',
    '--repo',
    fixtureRoot,
    '--mode',
    'code'
  ], { env });
  return fixtureRoot;
};

const waitForJsonStartupLine = (child, label, timeoutMs = 20000) => new Promise((resolve, reject) => {
  let stdoutBuffer = '';
  let stdoutTail = '';
  let stderrTail = '';
  let settled = false;
  const appendTail = (current, chunk) => {
    const combined = `${current}${chunk}`;
    return combined.length <= 4096 ? combined : combined.slice(-4096);
  };
  const cleanup = () => {
    clearTimeout(timeout);
    child.stdout?.off('data', onStdout);
    child.stderr?.off('data', onStderr);
    child.off('exit', onExit);
    child.off('error', onError);
  };
  const succeed = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(value);
  };
  const failWith = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const onStdout = (chunk) => {
    const text = chunk.toString();
    if (!text) return;
    stdoutTail = appendTail(stdoutTail, text);
    stdoutBuffer += text;
    while (true) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline === -1) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        succeed(JSON.parse(line));
        return;
      } catch {}
    }
  };
  const onStderr = (chunk) => {
    const text = chunk.toString();
    if (!text) return;
    stderrTail = appendTail(stderrTail, text);
  };
  const onExit = (code, signal) => {
    failWith(new Error(
      [
        `${label} exited before startup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        stderrTail.trim() ? `stderr tail:\n${stderrTail.trim()}` : '',
        stdoutTail.trim() ? `stdout tail:\n${stdoutTail.trim()}` : ''
      ].filter(Boolean).join('\n\n')
    ));
  };
  const onError = (error) => failWith(error instanceof Error ? error : new Error(String(error)));
  const timeout = setTimeout(() => {
    failWith(new Error(
      [
        `${label} startup timed out after ${timeoutMs}ms`,
        stderrTail.trim() ? `stderr tail:\n${stderrTail.trim()}` : '',
        stdoutTail.trim() ? `stdout tail:\n${stdoutTail.trim()}` : ''
      ].filter(Boolean).join('\n\n')
    ));
  }, timeoutMs);
  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);
  child.once('exit', onExit);
  child.once('error', onError);
});

const startApiServer = async ({ repoRoot, env }) => {
  const args = [
    path.join(root, 'tools', 'api', 'server.js'),
    '--repo',
    repoRoot,
    '--port',
    '0',
    '--json',
    '--quiet',
    '--allow-unauthenticated'
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const ownershipId = `release-api:${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
  const unregister = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: false,
    command: process.execPath,
    args,
    name: 'release-api-server',
    ownershipId,
    scope: ownershipId
  });
  const startup = await waitForJsonStartupLine(child, 'api-server');
  const stop = async () => {
    try {
      child.kill('SIGTERM');
    } catch {}
    try {
      await terminateTrackedSubprocesses({
        reason: 'release_api_shutdown',
        ownershipId,
        force: true
      });
    } finally {
      unregister();
    }
  };
  return { child, startup, stop };
};

const requestJson = async ({ serverInfo, method, requestPath, body = null }) => {
  const payload = body === null ? '' : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: String(serverInfo.host || '127.0.0.1'),
        port: Number(serverInfo.port || 0),
        path: requestPath,
        method,
        headers: payload
          ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
          : undefined
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode || 0,
              body: JSON.parse(data || '{}')
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
};

const createMessageQueue = () => {
  const items = [];
  let waiter = null;
  let failure = null;
  const settle = () => {
    if (!waiter) return;
    if (failure) {
      const pending = waiter;
      waiter = null;
      pending.reject(failure);
      return;
    }
    if (items.length === 0) return;
    const pending = waiter;
    waiter = null;
    pending.resolve(items.shift());
  };
  return {
    push(item) {
      items.push(item);
      settle();
    },
    fail(error) {
      failure = error instanceof Error ? error : new Error(String(error));
      settle();
    },
    async read(timeoutMs = 20000) {
      if (failure) throw failure;
      if (items.length > 0) return items.shift();
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (waiter?.reject !== reject) return;
          waiter = null;
          reject(new Error(`timed out waiting for MCP response after ${timeoutMs}ms`));
        }, timeoutMs);
        waiter = {
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          }
        };
      });
    }
  };
};

const startMcpServer = async ({ repoRoot, env }) => {
  const args = [
    path.join(root, 'tools', 'mcp', 'server.js'),
    '--mcp-mode',
    'legacy',
    '--repo',
    repoRoot
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...env,
      PAIROFCLEATS_MCP_MODE: 'legacy'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const ownershipId = `release-mcp:${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
  const unregister = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: false,
    command: process.execPath,
    args,
    name: 'release-mcp-server',
    ownershipId,
    scope: ownershipId
  });
  let stderrTail = '';
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    if (!text) return;
    stderrTail = `${stderrTail}${text}`;
    if (stderrTail.length > 4096) {
      stderrTail = stderrTail.slice(-4096);
    }
  });
  const queue = createMessageQueue();
  const parser = createFramedJsonRpcParser({
    onMessage(message) {
      queue.push(message);
    },
    onError(error) {
      queue.fail(error);
    }
  });
  child.stdout?.on('data', (chunk) => {
    parser.push(chunk);
  });
  child.once('exit', (code, signal) => {
    queue.fail(
      new Error(
        [
          `mcp server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          stderrTail.trim() ? `stderr tail:\n${stderrTail.trim()}` : ''
        ].filter(Boolean).join('\n\n')
      )
    );
  });
  const send = async (payload) => {
    await writeFramedJsonRpc(child.stdin, payload);
  };
  const stop = async () => {
    try {
      child.kill('SIGTERM');
    } catch {}
    try {
      await terminateTrackedSubprocesses({
        reason: 'release_mcp_shutdown',
        ownershipId,
        force: true
      });
    } finally {
      unregister();
    }
  };
  return {
    send,
    readMessage: async (timeoutMs = 20000) => await queue.read(timeoutMs),
    stop
  };
};

const verifyArchiveInstall = async ({
  archivePath,
  expectedEntries,
  unpackRoot
}) => {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`missing packaged archive: ${normalizePath(archivePath)}`);
  }
  const manifestPath = `${archivePath}.manifest.json`;
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing archive manifest: ${normalizePath(manifestPath)}`);
  }
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries().map((entry) => entry.entryName);
  for (const entry of expectedEntries) {
    if (!entries.includes(entry)) {
      throw new Error(`archive missing required entry: ${entry}`);
    }
  }
  await fsPromises.rm(unpackRoot, { recursive: true, force: true });
  await fsPromises.mkdir(unpackRoot, { recursive: true });
  zip.extractAllTo(unpackRoot, true);
  for (const entry of expectedEntries) {
    const extractedPath = path.join(unpackRoot, ...entry.split('/'));
    if (!fs.existsSync(extractedPath)) {
      throw new Error(`failed to unpack required entry: ${entry}`);
    }
  }
  return {
    archive: normalizePath(archivePath),
    manifest: normalizePath(manifestPath),
    unpackRoot: normalizePath(unpackRoot),
    entryCount: entries.length
  };
};

const verifyApi = async () => {
  const { env, tempRoot } = createVerificationEnv('runtime');
  const fixtureRoot = stage === 'smoke' ? ensureFixtureIndex({ env, fixtureName: 'sample' }) : path.join(root, 'tests', 'fixtures', 'sample');
  const { startup, stop } = await startApiServer({ repoRoot: fixtureRoot, env });
  try {
    const health = await requestJson({ serverInfo: startup, method: 'GET', requestPath: '/health' });
    if (health.status !== 200 || health.body?.ok !== true) {
      throw new Error('api /health did not return ok=true');
    }
    const summary = {
      ok: true,
      surface: surfaceId,
      stage,
      repo: normalizePath(fixtureRoot),
      baseUrl: startup.baseUrl,
      tempRoot: normalizePath(tempRoot),
      checks: { health: true }
    };
    if (stage === 'smoke') {
      const status = await requestJson({ serverInfo: startup, method: 'GET', requestPath: '/status' });
      if (status.status !== 200 || status.body?.ok !== true || !status.body?.status?.repo?.root) {
        throw new Error('api /status did not return repo payload');
      }
      const capabilities = await requestJson({ serverInfo: startup, method: 'GET', requestPath: '/capabilities' });
      if (capabilities.status !== 200 || capabilities.body?.ok !== true || !capabilities.body?.runtimeManifest?.surfaces?.api) {
        throw new Error('api /capabilities did not return runtime manifest');
      }
      const search = await requestJson({
        serverInfo: startup,
        method: 'POST',
        requestPath: '/search',
        body: {
          query: 'greet',
          mode: 'code',
          top: 1,
          backend: 'memory'
        }
      });
      if (search.status !== 200 || search.body?.ok !== true || !Array.isArray(search.body?.result?.code) || search.body.result.code.length < 1) {
        throw new Error('api /search did not return fixture hits');
      }
      summary.checks.status = true;
      summary.checks.capabilities = true;
      summary.checks.search = true;
    }
    await writeResult(summary);
  } finally {
    await stop();
  }
};

const verifyMcp = async () => {
  const { env, tempRoot } = createVerificationEnv('runtime');
  const fixtureRoot = stage === 'smoke' ? ensureFixtureIndex({ env, fixtureName: 'sample' }) : path.join(root, 'tests', 'fixtures', 'sample');
  const { send, readMessage, stop } = await startMcpServer({ repoRoot: fixtureRoot, env });
  try {
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} }
    });
    const initialize = await readMessage();
    if (!initialize?.result?.serverInfo?.name || !initialize?.result?.capabilities?.experimental?.pairofcleats) {
      throw new Error('mcp initialize response missing serverInfo or capabilities payload');
    }
    const summary = {
      ok: true,
      surface: surfaceId,
      stage,
      repo: normalizePath(fixtureRoot),
      tempRoot: normalizePath(tempRoot),
      checks: { initialize: true }
    };
    if (stage === 'smoke') {
      await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const toolsList = await readMessage();
      const toolNames = (toolsList?.result?.tools || []).map((entry) => entry?.name).filter(Boolean);
      if (!toolNames.includes('search') || !toolNames.includes('index_status')) {
        throw new Error('mcp tools/list missing required tools');
      }

      await send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'index_status',
          arguments: { repoPath: fixtureRoot }
        }
      });
      const indexStatus = await readMessage();
      const indexPayload = JSON.parse(indexStatus?.result?.content?.[0]?.text || '{}');
      if (!indexPayload?.repoPath || !indexPayload?.repoId) {
        throw new Error('mcp index_status response missing repo identity');
      }

      await send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'search',
          arguments: {
            repoPath: fixtureRoot,
            query: 'greet',
            mode: 'code',
            top: 1,
            backend: 'memory'
          }
        }
      });
      const search = await readMessage();
      const searchPayload = JSON.parse(search?.result?.content?.[0]?.text || '{}');
      if (!Array.isArray(searchPayload?.code) || searchPayload.code.length < 1) {
        throw new Error('mcp search response missing fixture hits');
      }
      summary.checks.toolsList = true;
      summary.checks.indexStatus = true;
      summary.checks.search = true;
    }

    await send({ jsonrpc: '2.0', id: 99, method: 'shutdown' });
    await readMessage();
    await send({ jsonrpc: '2.0', method: 'exit' });

    await writeResult(summary);
  } finally {
    await stop();
  }
};

const verifyVsCode = async () => {
  const archivePath = path.join(root, 'dist', 'vscode', 'pairofcleats.vsix');
  const unpackRoot = path.join(outDir, 'unpacked');
  const payload = await verifyArchiveInstall({
    archivePath,
    unpackRoot,
    expectedEntries: [
      'extension/package.json',
      'extension/extension.js',
      'extension/README.md'
    ]
  });
  await writeResult({
    ok: true,
    surface: surfaceId,
    stage,
    ...payload
  });
};

const verifySublime = async () => {
  const archivePath = path.join(root, 'dist', 'sublime', 'pairofcleats.sublime-package');
  const unpackRoot = path.join(outDir, 'unpacked');
  const payload = await verifyArchiveInstall({
    archivePath,
    unpackRoot,
    expectedEntries: [
      'PairOfCleats/plugin.py',
      'PairOfCleats/README.md',
      'PairOfCleats/PairOfCleats.sublime-settings'
    ]
  });
  await writeResult({
    ok: true,
    surface: surfaceId,
    stage,
    ...payload
  });
};

const verifyTui = async () => {
  const installRoot = path.resolve(root, String(argv['install-root'] || '').trim() || path.join('dist', 'tui', 'install-smoke'));
  const captureOutDir = path.resolve(
    root,
    String(argv['capture-out-dir'] || '').trim() || path.join(outDir, 'capture')
  );
  const fixturePath = path.join(root, 'tests', 'tui', 'fixtures', 'supervised-session.json');
  const result = spawnSync(process.execPath, [path.join(root, 'bin', 'pairofcleats-tui.js')], {
    cwd: root,
    env: {
      ...process.env,
      PAIROFCLEATS_TESTING: '1',
      PAIROFCLEATS_TUI_INSTALL_ROOT: installRoot,
      PAIROFCLEATS_TUI_CAPTURE_FIXTURE: fixturePath,
      PAIROFCLEATS_TUI_CAPTURE_OUT_DIR: captureOutDir
    },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000,
    killSignal: 'SIGTERM'
  });
  if (result.status !== 0) {
    throw new Error(
      [
        'tui wrapper boot verification failed',
        result.stderr?.trim() || result.stdout?.trim() || `exit=${result.status ?? 'null'}`
      ].filter(Boolean).join('\n\n')
    );
  }
  const captureManifestPath = path.join(captureOutDir, 'supervised-session', 'capture-manifest.json');
  if (!fs.existsSync(captureManifestPath)) {
    throw new Error(`missing TUI capture manifest: ${normalizePath(captureManifestPath)}`);
  }
  await writeResult({
    ok: true,
    surface: surfaceId,
    stage,
    installRoot: normalizePath(installRoot),
    captureFixture: normalizePath(fixturePath),
    captureManifest: normalizePath(captureManifestPath)
  });
};

const main = async () => {
  try {
    switch (`${surfaceId}:${stage}`) {
      case 'api:boot':
      case 'api:smoke':
        await verifyApi();
        return;
      case 'mcp:boot':
      case 'mcp:smoke':
        await verifyMcp();
        return;
      case 'vscode:install':
        await verifyVsCode();
        return;
      case 'sublime:install':
        await verifySublime();
        return;
      case 'tui:boot':
        await verifyTui();
        return;
      default:
        await fail(`unsupported surface/stage combination: ${surfaceId}:${stage}`);
    }
  } catch (error) {
    await fail(error?.message || String(error), {
      outputPath: normalizePath(outPath)
    });
  }
};

await main();
