#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { getMcpServerConfig } from './mcp/server-config.js';
import { handleToolCall } from './mcp/tools.js';
import { createMcpTransport } from './mcp/transport.js';

const argv = createCli({
  scriptName: 'mcp-server',
  options: {
    'mcp-mode': { type: 'string' },
    repo: { type: 'string' }
  },
  aliases: {
    'mcp-mode': ['mcpMode']
  }
}).parse();

const { toolDefs, schemaVersion, toolVersion, serverInfo, queueMax, maxBufferBytes, resolveToolTimeoutMs, userConfig, envConfig } =
  getMcpServerConfig(argv.repo ? path.resolve(argv.repo) : null);
const capabilities = getCapabilities();
const normalizeMode = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const cliMode = normalizeMode(argv['mcp-mode']);
const envMode = normalizeMode(envConfig.mcpMode);
const configMode = normalizeMode(userConfig?.mcp?.mode);
const requestedMode = cliMode || envMode || configMode || 'legacy';
if (!['legacy', 'sdk', 'auto'].includes(requestedMode)) {
  console.error(`[mcp] Invalid MCP mode: ${requestedMode}`);
  process.exit(1);
}
const resolvedMode = requestedMode === 'auto'
  ? (capabilities.mcp.sdk ? 'sdk' : 'legacy')
  : requestedMode;

if (resolvedMode === 'sdk') {
  if (!capabilities.mcp.sdk) {
    console.error('[mcp] MCP SDK mode requested but @modelcontextprotocol/sdk is not available.');
    process.exit(1);
  }
  const { startMcpSdkServer } = await import('./mcp-server-sdk.js');
  await startMcpSdkServer({
    toolDefs,
    schemaVersion,
    toolVersion,
    serverInfo,
    resolveToolTimeoutMs,
    queueMax,
    maxBufferBytes,
    capabilities
  });
} else {
  const transport = createMcpTransport({
    toolDefs,
    schemaVersion,
    toolVersion,
    serverInfo,
    handleToolCall,
    resolveToolTimeoutMs,
    queueMax,
    maxBufferBytes,
    capabilities
  });

  transport.start();
}
