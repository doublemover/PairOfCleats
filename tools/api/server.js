#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { SERVICE_API_OPTIONS } from '../../src/shared/cli-options.js';
import { parseCommaList } from '../../src/shared/comma-list.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { getMetricsRegistry } from '../../src/shared/metrics/core.js';
import { createApiRouter } from './router.js';
import { configureServiceLogger } from '../service/logger.js';
import { getEnvSecrets } from '../../src/shared/env/runtime.js';
import {
  evaluateApiTrustBoundary,
  formatApiTrustBoundarySummary,
  validateApiTrustBoundary
} from './trust-boundary.js';

const argv = createCli({
  scriptName: 'api-server',
  options: SERVICE_API_OPTIONS
}).parse();

const host = argv.host || '127.0.0.1';
const port = Number.isFinite(Number(argv.port)) ? Number(argv.port) : 7345;
const defaultRepo = resolveRepoRootArg(argv.repo);
const envSecrets = getEnvSecrets();
const jsonOutput = argv.json === true;
const quiet = argv.quiet === true;
const metricsRegistry = getMetricsRegistry();
const { logLine } = configureServiceLogger({ repoRoot: defaultRepo, service: 'api' });
const formatHostForUrl = (value) => {
  if (!value) return 'localhost';
  const normalized = String(value).trim();
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    return `[${normalized}]`;
  }
  return normalized;
};
const allowUnauthenticated = argv['allow-unauthenticated'] === true;
const authToken = String(argv['auth-token'] || envSecrets.apiToken || '').trim();
const corsAllowedOrigins = parseCommaList(argv['cors-allowed-origins']);
const corsAllowAny = argv['cors-allow-any'] === true;
const allowedRepoRoots = parseCommaList(argv['allowed-repo-roots']);
const trustBoundary = evaluateApiTrustBoundary({
  host,
  defaultRepo,
  allowedRepoRoots,
  allowUnauthenticated,
  authToken,
  corsAllowAny
});
const boundaryIssues = validateApiTrustBoundary(trustBoundary);
if (boundaryIssues.length > 0) {
  for (const issue of boundaryIssues) {
    console.error(issue);
  }
  process.exit(1);
}
const maxBodyBytes = Number.isFinite(Number(argv['max-body-bytes']))
  ? Math.max(0, Math.floor(Number(argv['max-body-bytes'])))
  : null;

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
    required: trustBoundary.auth.required
  },
  allowedRepoRoots,
  maxBodyBytes: maxBodyBytes ?? undefined,
  trustBoundary
});

const server = http.createServer(router.handleRequest);

server.listen({ port, host }, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${formatHostForUrl(host)}:${actualPort}`;
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: true, host, port: actualPort, repo: defaultRepo, baseUrl, trustBoundary }));
  } else {
    log(`[api] listening at ${baseUrl}`);
    log(`[api] repo root: ${defaultRepo}`);
    log(`[api] trust boundary: ${formatApiTrustBoundarySummary(trustBoundary)}`);
    if (trustBoundary.repos?.effectiveAllowedRepoRoots?.length) {
      log(`[api] allowed repo roots: ${trustBoundary.repos.effectiveAllowedRepoRoots.join(', ')}`);
    }
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
