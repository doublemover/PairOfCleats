import fs from 'node:fs';
import path from 'node:path';
import { getToolDefs } from '../../src/integrations/mcp/defs.js';
import { getEnvConfig } from '../../src/shared/env.js';
import {
  DEFAULT_MODEL_ID,
  loadUserConfig,
  resolveRepoRoot,
  resolveToolRoot
} from '../dict-utils.js';
import { parseTimeoutMs, resolveToolTimeoutMs } from './repo.js';

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

const parseIntEnv = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

export function getMcpServerConfig(repoPath = null) {
  const toolRoot = resolveToolRoot();
  const pkg = JSON.parse(fs.readFileSync(path.join(toolRoot, 'package.json'), 'utf8'));
  const configRoot = resolveRepoRoot(repoPath ? path.resolve(repoPath) : process.cwd());
  const userConfig = loadUserConfig(configRoot);
  const mcpConfig = userConfig?.mcp && typeof userConfig.mcp === 'object' ? userConfig.mcp : {};
  const envConfig = getEnvConfig();

  const envQueueMax = parseIntEnv(envConfig.mcpQueueMax);
  const envMaxBuffer = parseIntEnv(envConfig.mcpMaxBufferBytes);
  const envToolTimeoutMs = parseTimeoutMs(envConfig.mcpToolTimeoutMs);
  const configQueueMax = parseIntEnv(mcpConfig.queueMax);
  const configMaxBuffer = parseIntEnv(mcpConfig.maxBufferBytes);

  const queueMax = envQueueMax ?? configQueueMax ?? DEFAULT_MCP_QUEUE_MAX;
  const maxBufferBytes = envMaxBuffer ?? configMaxBuffer ?? DEFAULT_MCP_MAX_BUFFER_BYTES;

  const resolveTimeout = (name, args) => resolveToolTimeoutMs(name, args, {
    envToolTimeoutMs,
    defaultToolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    defaultToolTimeouts: DEFAULT_TOOL_TIMEOUTS
  });

  return {
    toolDefs: getToolDefs(DEFAULT_MODEL_ID),
    serverInfo: { name: 'PairOfCleats', version: pkg.version },
    userConfig,
    envConfig,
    queueMax,
    maxBufferBytes,
    resolveToolTimeoutMs: resolveTimeout
  };
}
