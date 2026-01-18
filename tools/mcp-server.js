#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getToolDefs } from '../src/integrations/mcp/defs.js';
import { DEFAULT_MODEL_ID, loadUserConfig, resolveRepoRoot, resolveToolRoot } from './dict-utils.js';
import { parseTimeoutMs, resolveToolTimeoutMs } from './mcp/repo.js';
import { handleToolCall } from './mcp/tools.js';
import { createMcpTransport } from './mcp/transport.js';

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

const baseConfigRoot = resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(baseConfigRoot);
const mcpConfig = userConfig?.mcp && typeof userConfig.mcp === 'object' ? userConfig.mcp : {};
const parseIntEnv = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};
const envQueueMax = parseIntEnv(process.env.PAIROFCLEATS_MCP_QUEUE_MAX);
const envMaxBuffer = parseIntEnv(process.env.PAIROFCLEATS_MCP_MAX_BUFFER_BYTES);
const envToolTimeoutMs = parseTimeoutMs(process.env.PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS);
const configQueueMax = parseIntEnv(mcpConfig.queueMax);
const configMaxBuffer = parseIntEnv(mcpConfig.maxBufferBytes);
const queueMax = envQueueMax ?? configQueueMax ?? DEFAULT_MCP_QUEUE_MAX;
const maxBufferBytes = envMaxBuffer ?? configMaxBuffer ?? DEFAULT_MCP_MAX_BUFFER_BYTES;

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
