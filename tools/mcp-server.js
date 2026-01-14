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
const envToolTimeoutMs = parseTimeoutMs(process.env.PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS);
const baseConfigRoot = resolveRepoRoot(process.cwd());
const baseConfig = loadUserConfig(baseConfigRoot);
const { logLine } = configureServiceLogger({ repoRoot: baseConfigRoot, service: 'mcp' });
const runtimeConfig = getRuntimeConfig(baseConfigRoot, baseConfig);
const parsedUv = Number(process.env.UV_THREADPOOL_SIZE);
const effectiveUvThreadpoolSize = Number.isFinite(parsedUv) && parsedUv > 0 ? Math.floor(parsedUv) : null;
if (effectiveUvThreadpoolSize || runtimeConfig.uvThreadpoolSize) {
  logLine(`[mcp] UV_THREADPOOL_SIZE: ${effectiveUvThreadpoolSize ?? 'default'} (config=${runtimeConfig.uvThreadpoolSize ?? 'none'})`);
}

const baseMcpConfig = baseConfig?.mcp && typeof baseConfig.mcp === 'object' ? baseConfig.mcp : {};
const configuredQueueMax = parseTimeoutMs(baseMcpConfig.queueMax);
const queueMax = Math.max(1, configuredQueueMax ?? envQueueMax ?? DEFAULT_MCP_QUEUE_MAX);

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
  queueMax
});

transport.start();
