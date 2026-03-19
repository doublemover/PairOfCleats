import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { createApiRouter } from '../../tools/api/router.js';
import { handleToolCall } from '../../tools/mcp/tools.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');

const tryParseJson = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const normalizeSurfaceError = (payload) => ({
  code: payload?.canonicalCode || payload?.code || null,
  reason: payload?.reason || null
});

export const runCliJson = (args, { env = process.env } = {}) => {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    env
  });
  const stdout = result.stdout?.trim() || '';
  const stderr = result.stderr?.trim() || '';
  return {
    status: result.status,
    stdout,
    stderr,
    parsed: tryParseJson(stdout) || tryParseJson(stderr)
  };
};

export const createAnalysisSurfaceHarness = async ({ fixtureRoot, env }) => {
  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: fixtureRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });
  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    runCli(args) {
      return runCliJson(args, { env });
    },
    async runApi(apiPath, payload) {
      const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const parsed = await response.json();
      return {
        status: response.status,
        parsed
      };
    },
    async runMcp(toolName, payload) {
      try {
        return {
          ok: true,
          result: await handleToolCall(toolName, payload)
        };
      } catch (error) {
        return {
          ok: false,
          error
        };
      }
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (typeof router.close === 'function') {
        router.close();
      }
    }
  };
};
