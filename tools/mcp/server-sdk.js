#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import PQueue from 'p-queue';
import { buildInitializeResult, formatToolError } from '../../src/integrations/mcp/protocol.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { tryImport } from '../../src/shared/optional-deps.js';
import { withTimeout } from './runner.js';
import { handleToolCall } from './tools.js';
import { getMcpServerConfig } from './server-config.js';

const importFirst = async (candidates) => {
  let lastError = null;
  for (const name of candidates) {
    const result = await tryImport(name);
    if (result.ok) return result.mod;
    lastError = result.error || lastError;
  }
  const error = new Error(`Optional dependency unavailable: ${candidates.join(', ')}`);
  error.cause = lastError;
  throw error;
};

const resolveSdkModules = async () => {
  const serverMod = await importFirst([
    '@modelcontextprotocol/sdk/server/index.js',
    '@modelcontextprotocol/sdk/server'
  ]);
  const stdioMod = await importFirst([
    '@modelcontextprotocol/sdk/server/stdio.js',
    '@modelcontextprotocol/sdk/server/stdio'
  ]);
  const typesMod = await importFirst([
    '@modelcontextprotocol/sdk/types.js',
    '@modelcontextprotocol/sdk/types'
  ]);
  const Server = serverMod?.Server || serverMod?.McpServer;
  if (!Server) {
    throw new Error('MCP SDK Server export not found.');
  }
  const StdioServerTransport = stdioMod?.StdioServerTransport;
  if (!StdioServerTransport) {
    throw new Error('MCP SDK StdioServerTransport export not found.');
  }
  const CallToolRequestSchema = typesMod?.CallToolRequestSchema;
  const ListToolsRequestSchema = typesMod?.ListToolsRequestSchema;
  const InitializeRequestSchema = typesMod?.InitializeRequestSchema;
  if (!CallToolRequestSchema || !ListToolsRequestSchema) {
    throw new Error('MCP SDK request schema exports not found.');
  }
  return {
    Server,
    StdioServerTransport,
    CallToolRequestSchema,
    ListToolsRequestSchema,
    InitializeRequestSchema
  };
};

const buildProgressSender = (server, token, tool) => {
  if (!token || typeof server?.sendNotification !== 'function') {
    return null;
  }
  const notify = (method, params) => {
    try {
      server.sendNotification(method, params);
    } catch {
      try {
        server.sendNotification({ method, params });
      } catch {}
    }
  };
  return (payload) => {
    const message = payload?.message ? String(payload.message) : '';
    if (!message) return;
    notify('notifications/progress', {
      progressToken: token,
      tool,
      message,
      stream: payload?.stream || 'info',
      phase: payload?.phase || 'progress',
      ts: new Date().toISOString()
    });
  };
};

export async function startMcpSdkServer({
  toolDefs,
  schemaVersion,
  toolVersion,
  serverInfo,
  resolveToolTimeoutMs,
  queueMax,
  capabilities
}) {
  const {
    Server,
    StdioServerTransport,
    CallToolRequestSchema,
    ListToolsRequestSchema,
    InitializeRequestSchema
  } = await resolveSdkModules();
  const queue = new PQueue({ concurrency: 1 });
  const baseCapabilities = {
    tools: { listChanged: false },
    resources: { listChanged: false }
  };
  if (capabilities && typeof capabilities === 'object') {
    baseCapabilities.experimental = {
      pairofcleats: {
        schemaVersion: schemaVersion || null,
        toolVersion: toolVersion || null,
        capabilities
      }
    };
  }
  const server = new Server(serverInfo, {
    capabilities: baseCapabilities
  });

  if (InitializeRequestSchema) {
    server.setRequestHandler(InitializeRequestSchema, async () => buildInitializeResult({
      serverInfo,
      schemaVersion,
      toolVersion,
      capabilities
    }));
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));

  server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
    const name = request?.params?.name;
    const args = request?.params?.arguments || {};
    if (!name) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify(formatToolError({
            code: ERROR_CODES.INVALID_REQUEST,
            message: 'Missing tool name.'
          }), null, 2)
        }]
      };
    }
    const totalQueued = queue.size + queue.pending;
    if (Number.isFinite(queueMax) && queueMax > 0 && totalQueued >= queueMax) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(formatToolError({ code: ERROR_CODES.QUEUE_OVERLOADED, message: 'Server overloaded.' }), null, 2) }]
      };
    }
    return await queue.add(async () => {
      const timeoutMs = resolveToolTimeoutMs(name, args);
      const controller = new AbortController();
      let timedOut = false;
      const progressToken = request?.params?._meta?.progressToken || context?.progressToken;
      const progress = buildProgressSender(server, progressToken, name);
      try {
        const result = await withTimeout(
          handleToolCall(name, args, { progress, toolCallId: context?.requestId || null, signal: controller.signal }),
          timeoutMs,
          {
            label: name,
            onTimeout: () => {
              timedOut = true;
              controller.abort();
            }
          }
        );
        if (timedOut) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(formatToolError({ code: ERROR_CODES.TOOL_TIMEOUT, message: 'Tool timeout.' }), null, 2) }]
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        const payload = formatToolError(error);
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
        };
      }
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  const capabilities = getCapabilities();
  if (!capabilities.mcp.sdk) {
    console.error('[mcp] MCP SDK is not available. Install @modelcontextprotocol/sdk to use sdk mode.');
    process.exit(1);
  }
  const config = getMcpServerConfig();
  await startMcpSdkServer({ ...config, capabilities });
}
