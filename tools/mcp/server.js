#!/usr/bin/env node
import { guardBootstrapEntry } from '../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
const { createCli } = await import('../../src/shared/cli.js');
const { getCapabilities } = await import('../../src/shared/capabilities.js');
const { getRuntimeCapabilityManifest } = await import('../../src/shared/runtime-capability-manifest.js');
const { getMcpServerConfig } = await import('./server-config.js');
const { handleToolCall } = await import('./tools.js');
const { createMcpTransport } = await import('./transport.js');

const argv = createCli({
  scriptName: 'pairofcleats service mcp',
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
const capabilityManifest = getRuntimeCapabilityManifest({ runtimeCapabilities: capabilities });
const normalizeMode = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const cliMode = normalizeMode(argv['mcp-mode'] ?? argv.mcpMode);
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
  const { startMcpSdkServer } = await import('./server-sdk.js');
  await startMcpSdkServer({
    toolDefs,
    schemaVersion,
    toolVersion,
    serverInfo,
    resolveToolTimeoutMs,
    queueMax,
    maxBufferBytes,
    capabilities,
    capabilityManifest
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
    capabilities,
    capabilityManifest
  });

  transport.start();
}
