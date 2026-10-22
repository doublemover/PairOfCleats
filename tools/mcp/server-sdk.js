#!/usr/bin/env node
import PQueue from 'p-queue';
import { buildInitializeResult, formatToolError } from '../../src/integrations/mcp/protocol.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { attachObservability, normalizeObservability } from '../../src/shared/observability.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { tryImport } from '../../src/shared/optional-deps.js';
import { incTimeout } from '../../src/shared/metrics/core.js';
import { raceAbort } from '../../src/shared/abort.js';
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

const cancelledError = () => Object.assign(new Error('Request cancelled.'), {
  name: 'AbortError', code: ERROR_CODES.CANCELLED
});

// A slow transport retains only the newest pending update. Progress is an
// increasing event count, not an invented percentage of unknown tool work.
const buildProgressSender = (context, token, signal) => {
  let accepting = true, disabled = false, count = 0, pending = null, flight = null;
  const enabled = token !== null && token !== undefined
    && typeof context?.sendNotification === 'function';
  const drain = async () => {
    while (pending && !disabled && !signal.aborted) {
      const params = pending;
      pending = null;
      try { await context.sendNotification({ method: 'notifications/progress', params }); }
      catch { disabled = true; pending = null; }
    }
  };
  const cancel = () => { accepting = false; pending = null; };
  const pump = () => {
    flight = drain().finally(() => {
      flight = null;
      if (pending && !disabled && !signal.aborted) pump();
    });
  };
  signal.addEventListener('abort', cancel, { once: true });
  return {
    progress: enabled ? payload => {
      const message = payload?.message ? String(payload.message) : '';
      if (!message || !accepting || disabled || signal.aborted) return;
      pending = { progressToken: token, progress: ++count, message };
      if (!flight) pump();
    } : null,
    async close() {
      accepting = false;
      if (signal.aborted) pending = null;
      while (flight && !signal.aborted) {
        try { await raceAbort(signal, flight); }
        catch (error) { if (!signal.aborted) throw error; }
      }
      signal.removeEventListener('abort', cancel);
    }
  };
};

export async function startMcpSdkServer({
  toolDefs,
  schemaVersion,
  toolVersion,
  serverInfo,
  resolveToolTimeoutMs,
  queueMax,
  maxBufferBytes = 8 * 1024 * 1024,
  capabilities,
  capabilityManifest,
  executeTool = handleToolCall,
  transport: suppliedTransport = null,
  stdin = process.stdin,
  stdout = process.stdout
}) {
  const {
    Server,
    StdioServerTransport,
    CallToolRequestSchema,
    ListToolsRequestSchema,
    InitializeRequestSchema
  } = await resolveSdkModules();
  const queue = new PQueue({ concurrency: 1 });
  const lifetime = new AbortController();
  const attachToolResultObservability = (result, requestObservability) => (
    result && typeof result === 'object' && !Array.isArray(result) && result.observability
      ? result
      : attachObservability(result, requestObservability)
  );
  const baseCapabilities = {
    tools: { listChanged: false },
    resources: { listChanged: false }
  };
  if (capabilities && typeof capabilities === 'object') {
    baseCapabilities.experimental = {
      pairofcleats: {
        schemaVersion: schemaVersion || null,
        toolVersion: toolVersion || null,
        capabilities,
        manifest: capabilityManifest || null
      }
    };
  }
  const server = new Server(serverInfo, {
    capabilities: baseCapabilities
  });
  server.onclose = () => lifetime.abort(cancelledError());

  if (InitializeRequestSchema) {
    server.setRequestHandler(InitializeRequestSchema, async () => buildInitializeResult({
      serverInfo,
      schemaVersion,
      toolVersion,
      capabilities,
      capabilityManifest
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
    const requestSignal = context?.signal;
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, lifetime.signal]) : lifetime.signal;
    const errorResult = error => ({
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }]
    });
    if (signal.aborted) return errorResult(cancelledError());
    const totalQueued = queue.size + queue.pending;
    if (Number.isFinite(queueMax) && queueMax > 0 && totalQueued >= queueMax) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(formatToolError({ code: ERROR_CODES.QUEUE_OVERLOADED, message: 'Server overloaded.' }), null, 2) }]
      };
    }
    // PQueue's signal is admission-only: aborting a running queue task would
    // release its slot before the underlying tool/owned children have settled.
    const admission = new AbortController();
    const cancelAdmission = () => admission.abort(cancelledError());
    signal.addEventListener('abort', cancelAdmission, { once: true });
    try { return await queue.add(async () => {
      signal.removeEventListener('abort', cancelAdmission);
      if (signal.aborted) return errorResult(cancelledError());
      const timeoutMs = resolveToolTimeoutMs(name, args);
      const controller = new AbortController();
      const workSignal = AbortSignal.any([signal, controller.signal]);
      const progressToken = request?.params?._meta?.progressToken ?? context?.progressToken;
      const requestObservability = normalizeObservability({
        correlationId: request?.params?._meta?.correlationId || null,
        parentCorrelationId: request?.params?._meta?.parentCorrelationId || null,
        requestId: request?.params?._meta?.requestId || context?.requestId || null
      }, {
        surface: 'mcp',
        operation: name,
        context: {
          tool: name,
          toolCallId: context?.requestId || null
        }
      });
      const sender = buildProgressSender(context, progressToken, workSignal);
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => {
        incTimeout({ surface: 'mcp', operation: 'tool' });
        controller.abort(Object.assign(new Error(`Tool timeout after ${timeoutMs}ms (${name}).`), {
          code: ERROR_CODES.TOOL_TIMEOUT, timeoutMs
        }));
      }, timeoutMs) : null;
      try {
        // Keep the capacity lease until execution and subprocess teardown
        // finish. Cancellation/timeout signals never substitute for settlement.
        const result = await executeTool(name, args, {
          progress: sender.progress,
          toolCallId: context?.requestId ?? null,
          signal: workSignal,
          observability: requestObservability
        });
        if (workSignal.aborted) throw workSignal.reason;
        await sender.close();
        if (workSignal.aborted) throw workSignal.reason;
        return {
          content: [{ type: 'text', text: JSON.stringify(attachToolResultObservability(result, requestObservability), null, 2) }]
        };
      } catch (error) {
        return errorResult(workSignal.aborted
          ? (workSignal.reason?.code === ERROR_CODES.TOOL_TIMEOUT ? workSignal.reason : cancelledError()) : error);
      } finally {
        if (timer) clearTimeout(timer);
        await sender.close();
      }
    }, { signal: admission.signal }); }
    catch (error) { return errorResult(signal.aborted ? cancelledError() : error); }
    finally { signal.removeEventListener('abort', cancelAdmission); }
  });

  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 0) throw new TypeError('MCP maxBufferBytes must be a nonnegative integer.');
  const transport = suppliedTransport || new StdioServerTransport(stdin, stdout, {
    maxBufferSize: maxBufferBytes === 0 ? Infinity : maxBufferBytes
  });
  await server.connect(transport);
  let closing = null;
  const onInputEnd = () => { void service.close().catch(() => { process.exitCode = 1; }); };
  const service = {
    server,
    queue,
    close() {
      if (!closing) closing = (async () => {
        lifetime.abort(cancelledError());
        let transportError;
        try { await server.close(); } catch (error) { transportError = error; }
        try { await queue.onIdle(); }
        finally {
          if (!suppliedTransport) {
            stdin.off('end', onInputEnd); stdin.off('close', onInputEnd);
          }
          await (await import('../../src/shared/embedding-adapter.js')).disposeEmbeddingAdapterCaches();
        }
        if (transportError) throw transportError;
      })();
      return closing;
    }
  };
  // The SDK stdio transport does not translate EOF into transport.onclose.
  // EOF is nevertheless a disconnect and must cancel owned tool work.
  if (!suppliedTransport) {
    stdin.once('end', onInputEnd);
    stdin.once('close', onInputEnd);
  }
  return service;
}

if (isDirectExecution(import.meta.url)) {
  const capabilities = getCapabilities();
  const { getRuntimeCapabilityManifest } = await import('../../src/shared/runtime-capability-manifest.js');
  const capabilityManifest = getRuntimeCapabilityManifest({ runtimeCapabilities: capabilities });
  if (!capabilities.mcp.sdk) {
    console.error('[mcp] MCP SDK is not available. Install @modelcontextprotocol/sdk to use sdk mode.');
    process.exit(1);
  }
  const config = getMcpServerConfig();
  await startMcpSdkServer({ ...config, capabilities, capabilityManifest });
}
