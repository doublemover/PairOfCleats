#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getToolDefs } from '../src/integrations/mcp/defs.js';
import { DEFAULT_MODEL_ID, getRuntimeConfig, loadUserConfig, resolveRepoRoot, resolveToolRoot } from './dict-utils.js';
import { parseTimeoutMs, resolveToolTimeoutMs } from './mcp/repo.js';
import { handleToolCall } from './mcp/tools.js';
import { createMcpTransport } from './mcp/transport.js';
import { configureServiceLogger } from './service/logger.js';

const toolRoot = resolveToolRoot();
const PKG = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf8'));

const TOOL_DEFS = getToolDefs(DEFAULT_MODEL_ID);

const DEFAULT_MCP_QUEUE_MAX = 64;
const DEFAULT_MCP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOOL_TIMEOUT_MS = 120000;
const DEFAULT_TOOL_TIMEOUTS = {
  build_index: 10 * 60 * 1000,
  build_sqlite_index: 10 * 60 * 1000,
  download_models: 10 * 60 * 1000,
  download_dictionaries: 10 * 60 * 1000,
  download_extensions: 10 * 60 * 1000,
  bootstrap: 10 * 60 * 1000,
  triage_ingest: 5 * 60 * 1000
};

const envQueueMax = parseTimeoutMs(process.env.PAIROFCLEATS_MCP_QUEUE_MAX);
const envMaxBufferBytes = parseTimeoutMs(process.env.PAIROFCLEATS_MCP_MAX_BUFFER_BYTES);
const envToolTimeoutMs = parseTimeoutMs(process.env.PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS);
const baseConfigRoot = resolveRepoRoot(process.cwd());
const baseConfig = loadUserConfig(baseConfigRoot);
const { logLine } = configureServiceLogger({ repoRoot: baseConfigRoot, service: 'mcp' });
const runtimeConfig = getRuntimeConfig(baseConfigRoot, baseConfig);
const effectiveUvRaw = Number(process.env.UV_THREADPOOL_SIZE);
const effectiveUvThreadpoolSize = Number.isFinite(effectiveUvRaw) && effectiveUvRaw > 0
  ? Math.floor(effectiveUvRaw)
  : null;
if (effectiveUvThreadpoolSize) {
  if (runtimeConfig.uvThreadpoolSize && runtimeConfig.uvThreadpoolSize !== effectiveUvThreadpoolSize) {
    logLine(`[mcp] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env overrides runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
  } else if (runtimeConfig.uvThreadpoolSize) {
    logLine(`[mcp] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
  } else {
    logLine(`[mcp] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env)`);
  }
} else if (runtimeConfig.uvThreadpoolSize) {
  logLine(`[mcp] UV_THREADPOOL_SIZE=default (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize} not applied; start via pairofcleats CLI or set UV_THREADPOOL_SIZE before launch)`);
}

const baseMcpConfig = baseConfig?.mcp && typeof baseConfig.mcp === 'object' ? baseConfig.mcp : {};
const configuredQueueMax = parseTimeoutMs(baseMcpConfig.queueMax);
const configuredMaxBufferBytes = parseTimeoutMs(baseMcpConfig.maxBufferBytes);
const queueMax = Math.max(1, configuredQueueMax ?? envQueueMax ?? DEFAULT_MCP_QUEUE_MAX);
const maxBufferBytes = configuredMaxBufferBytes ?? envMaxBufferBytes ?? DEFAULT_MCP_MAX_BUFFER_BYTES;

const resolveTimeout = (name, args) => resolveToolTimeoutMs(name, args, {
  envToolTimeoutMs,
  defaultToolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  defaultToolTimeouts: DEFAULT_TOOL_TIMEOUTS
});

const transport = createMcpTransport({
  toolDefs: TOOL_DEFS,
  serverInfo: { name: 'PairOfCleats', version: PKG.version },
  handleToolCall,
  resolveToolTimeoutMs: resolveTimeout,
  queueMax,
  maxBufferBytes
});

transport.start();
