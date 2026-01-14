#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getRuntimeConfig, resolveRepoRoot } from './dict-utils.js';
import { getMetricsRegistry } from '../src/shared/metrics.js';
import { createApiRouter } from './api/router.js';
import { configureServiceLogger } from './service/logger.js';

const argv = createCli({
  scriptName: 'api-server',
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '7345' },
    output: { type: 'string', default: 'compact' },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    repo: { type: 'string' },
    'auth-token': { type: 'string' },
    'allow-unauthenticated': { type: 'boolean', default: false },
    'cors-allowed-origins': { type: 'string' },
    'cors-allow-any': { type: 'boolean', default: false },
    'allowed-repo-roots': { type: 'string' },
    'max-body-bytes': { type: 'number' }
  }
}).parse();

const host = argv.host || '127.0.0.1';
const port = Number.isFinite(Number(argv.port)) ? Number(argv.port) : 7345;
const defaultRepo = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const runtimeConfig = getRuntimeConfig(defaultRepo);
const jsonOutput = argv.json === true;
const quiet = argv.quiet === true;
const metricsRegistry = getMetricsRegistry();
const { logLine } = configureServiceLogger({ repoRoot: defaultRepo, service: 'api' });
const parseList = (value) => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};
const isLocalHost = (value) => {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
};
const envAllowUnauth = process.env.PAIROFCLEATS_API_ALLOW_UNAUTHENTICATED === '1'
  || process.env.PAIROFCLEATS_API_ALLOW_UNAUTHENTICATED === 'true';
const allowUnauthenticated = argv['allow-unauthenticated'] === true || envAllowUnauth;
const authToken = String(argv['auth-token'] || process.env.PAIROFCLEATS_API_TOKEN || '').trim();
const hostIsLocal = isLocalHost(host);
if (!allowUnauthenticated && !hostIsLocal && !authToken) {
  console.error(
    'api-server requires PAIROFCLEATS_API_TOKEN when binding to non-localhost. '
    + 'Use --allow-unauthenticated to override.'
  );
  process.exit(1);
}
const authRequired = !allowUnauthenticated && (!hostIsLocal || authToken);
const corsAllowedOrigins = parseList(argv['cors-allowed-origins'] || process.env.PAIROFCLEATS_API_ALLOWED_ORIGINS);
const corsAllowAny = argv['cors-allow-any'] === true
  || process.env.PAIROFCLEATS_API_ALLOW_ANY_ORIGIN === '1'
  || process.env.PAIROFCLEATS_API_ALLOW_ANY_ORIGIN === 'true';
const allowedRepoRoots = parseList(argv['allowed-repo-roots'] || process.env.PAIROFCLEATS_API_ALLOWED_REPO_ROOTS);
const maxBodyBytes = Number.isFinite(Number(argv['max-body-bytes']))
  ? Math.max(0, Math.floor(Number(argv['max-body-bytes'])))
  : (Number.isFinite(Number(process.env.PAIROFCLEATS_API_MAX_BODY_BYTES))
    ? Math.max(0, Math.floor(Number(process.env.PAIROFCLEATS_API_MAX_BODY_BYTES)))
    : null);

const log = (message) => {
  if (quiet) return;
  logLine(message);
};

const router = createApiRouter({
  host,
  defaultRepo,
  defaultOutput: argv.output,
  metricsRegistry,
  cors: {
    allowedOrigins: corsAllowedOrigins,
    allowAnyOrigin: corsAllowAny
  },
  auth: {
    token: authToken || null,
    required: authRequired
  },
  allowedRepoRoots,
  maxBodyBytes: maxBodyBytes ?? undefined
});

const server = http.createServer(router.handleRequest);

server.listen({ port, host }, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: true, host, port: actualPort, repo: defaultRepo, baseUrl }));
  } else {
    const effectiveUvRaw = Number(process.env.UV_THREADPOOL_SIZE);
    const effectiveUvThreadpoolSize = Number.isFinite(effectiveUvRaw) && effectiveUvRaw > 0
      ? Math.floor(effectiveUvRaw)
      : null;
    if (effectiveUvThreadpoolSize) {
      if (runtimeConfig.uvThreadpoolSize && runtimeConfig.uvThreadpoolSize !== effectiveUvThreadpoolSize) {
        log(`[api] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env overrides runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
      } else if (runtimeConfig.uvThreadpoolSize) {
        log(`[api] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
      } else {
        log(`[api] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env)`);
      }
    } else if (runtimeConfig.uvThreadpoolSize) {
      log(`[api] UV_THREADPOOL_SIZE=default (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize} not applied; start via pairofcleats CLI or set UV_THREADPOOL_SIZE before launch)`);
    }
    log(`[api] listening at ${baseUrl}`);
    log(`[api] repo root: ${defaultRepo}`);
  }
});

const shutdown = (signal) => {
  log(`[api] ${signal} received; shutting down...`);
  server.close(() => {
    router.close();
    log('[api] shutdown complete.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
