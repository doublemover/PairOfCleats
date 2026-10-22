import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MCP_PROTOCOL_VERSION } from '../../../src/integrations/mcp/protocol.js';
import { createOwnedStdioClient } from './stdio-client.js';

/** A session-owned client for the canonical legacy MCP framing. It proves
 * initialize and tools/list responses; PID existence is never health evidence.
 * No arbitrary tools/call, credentials, or external server attachment is admitted.
 */
export const createTuiMcpClients = ({ toolRoot, requireScope, createClient = createOwnedStdioClient } = {}) => {
  const clients = new Map();
  const run = async ({ scope, jobId }, { signal, env, onSpawn, onActivity }) => {
    requireScope(scope.id);
    if (clients.size >= 2 || [...clients.values()].some(entry => entry.scopeId === scope.id)) {
      throw Object.assign(new Error('This session already owns the selected MCP client or reached its two-client bound.'),
        { code: 'ERR_TUI_MCP_ADMISSION' });
    }
    const client = createClient({ command: process.execPath,
      args: [path.join(toolRoot, 'tools/mcp/cli-entry.js'), '--mcp-mode=legacy', `--repo=${scope.configRoot}`],
      cwd: scope.configRoot, env, signal, onSpawn });
    const entry = { client, scopeId: scope.id, jobId, phase: 'initializing', initialized: false,
      lastHealthAt: null, healthChecks: 0, toolCount: null };
    clients.set(jobId, entry);
    try {
      const hello = await client.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {}, clientInfo: { name: 'pairofcleats-native', version: '1' } }, { signal });
      if (hello?.protocolVersion !== MCP_PROTOCOL_VERSION || typeof hello?.serverInfo?.name !== 'string') {
        throw Object.assign(new Error('MCP initialization did not match the supported protocol.'), { code: 'ERR_TUI_MCP_INITIALIZE' });
      }
      entry.initialized = true;
      while (!signal.aborted && client.status().connected) {
        requireScope(scope.id);
        const listing = await client.request('tools/list', {}, { signal });
        if (!Array.isArray(listing?.tools) || listing.tools.length > 256
          || listing.tools.some(tool => typeof tool?.name !== 'string' || tool.name.length > 128)) {
          throw Object.assign(new Error('Invalid bounded MCP tool inventory.'), { code: 'ERR_TUI_MCP_INVENTORY' });
        }
        entry.phase = 'healthy'; entry.lastHealthAt = new Date().toISOString();
        entry.healthChecks += 1; entry.toolCount = listing.tools.length;
        onActivity({ phase: 'mcp-health', stage: 'tools/list', current: entry.healthChecks,
          unit: 'verified responses', message: 'Owned MCP initialization and bounded inventory responded.' });
        // Child close interrupts this timer; no detached polling survives disposal.
        const sleeper = new AbortController();
        let ended;
        try { ended = await Promise.race([client.completion.then(() => true),
          delay(5000, false, { signal: AbortSignal.any([signal, sleeper.signal]) }).catch(() => true)]); }
        finally { sleeper.abort(); }
        if (ended) break;
      }
      const result = await client.dispose();
      return { exitCode: signal.aborted ? 130 : 1,
        stdout: JSON.stringify({ service: 'mcp', initialized: entry.initialized,
          healthChecks: entry.healthChecks, lastHealthAt: entry.lastHealthAt, stopped: true }), signal: result.signal };
    } finally {
      await client.dispose();
      clients.delete(jobId);
    }
  };
  const status = scopeId => [...clients.values()].filter(entry => entry.scopeId === scopeId)
    .map(({ client, scopeId: _scope, ...entry }) => ({ ...entry, ...client.status(),
      healthMeaning: 'Last initialize/tools-list response; no search, index or tool-execution readiness claim.' }));
  const dispose = async () => { await Promise.all([...clients.values()].map(entry => entry.client.dispose())); };
  return { run, status, dispose };
};
