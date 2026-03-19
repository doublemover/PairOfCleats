#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-diagnostics-parity-report');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const diagnosticsPath = path.join(logsRoot, 'run-ub050-all.diagnostics.jsonl');
const logPath = path.join(logsRoot, 'run-ub050-all.log');
const now = new Date().toISOString();

await fsPromises.writeFile(
  diagnosticsPath,
  [
    {
      eventType: 'fallback_used',
      eventId: 'ub050:v1:fallback_used:aaaaaaaaaaaa',
      message: 'using fallback parser'
    },
    {
      eventType: 'provider_preflight_start',
      eventId: 'ub050:v1:provider_preflight_start:bbbbbbbbbbbb',
      message: '[tooling] preflight:start provider=gopls id=gopls.workspace-model class=workspace timeoutMs=20000',
      providerId: 'gopls',
      preflightId: 'gopls.workspace-model',
      preflightClass: 'workspace',
      preflightState: 'running',
      failureClass: 'start'
    },
    {
      eventType: 'provider_preflight_finish',
      eventId: 'ub050:v1:provider_preflight_finish:cccccccccccc',
      message: '[tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked',
      providerId: 'gopls',
      preflightId: 'gopls.workspace-model',
      preflightClass: 'workspace',
      preflightState: 'blocked',
      failureClass: 'blocked'
    },
    {
      eventType: 'provider_preflight_blocked',
      eventId: 'ub050:v1:provider_preflight_blocked:dddddddddddd',
      message: '[tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked',
      providerId: 'gopls',
      preflightId: 'gopls.workspace-model',
      preflightClass: 'workspace',
      preflightState: 'blocked',
      failureClass: 'blocked'
    },
    {
      eventType: 'provider_request_timeout',
      eventId: 'ub050:v1:provider_request_timeout:eeeeeeeeeeee',
      message: '[tooling] request:timeout provider=pyright method=textDocument/documentSymbol stage=documentSymbol workspacePartition=. class=timeout',
      providerId: 'pyright',
      requestMethod: 'textDocument/documentSymbol',
      workspacePartition: '.',
      failureClass: 'timeout'
    },
    {
      eventType: 'provider_request_failed',
      eventId: 'ub050:v1:provider_request_failed:ffffffffffff',
      message: '[tooling] request:failed provider=sourcekit method=textDocument/semanticTokens/full stage=semantic_tokens workspacePartition=swift-package class=request_failed',
      providerId: 'sourcekit',
      requestMethod: 'textDocument/semanticTokens/full',
      workspacePartition: 'swift-package',
      failureClass: 'request_failed'
    },
    {
      eventType: 'provider_circuit_breaker',
      eventId: 'ub050:v1:provider_circuit_breaker:111111111111',
      message: '[tooling] pyright circuit breaker tripped.',
      providerId: 'pyright',
      failureClass: 'circuit_breaker'
    },
    {
      eventType: 'provider_degraded_mode_entered',
      eventId: 'ub050:v1:provider_degraded_mode_entered:121212121212',
      message: '[tooling] pyright degraded mode active (fail-open).',
      providerId: 'pyright',
      failureClass: 'fail_open'
    },
    {
      eventType: 'workspace_partition_decision',
      eventId: 'ub050:v1:workspace_partition_decision:131313131313',
      message: '[tooling] workspace:partition provider=gopls state=degraded reason=gopls_workspace_partition_incomplete workspacePartition=multiple partitionCount=2 unmatchedDocuments=1 unmatchedTargets=1',
      providerId: 'gopls',
      workspacePartition: 'multiple',
      failureClass: 'gopls_workspace_partition_incomplete'
    }
  ].map((entry) => JSON.stringify({
    schemaVersion: 2,
    ts: now,
    occurrence: 1,
    signature: entry.eventType,
    source: 'stdout',
    ...entry
  })).join('\n') + '\n',
  'utf8'
);

await fsPromises.writeFile(
  logPath,
  [
    '[tooling] preflight:start provider=gopls id=gopls.workspace-model class=workspace timeoutMs=20000',
    '[tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked',
    '[tooling] request:timeout provider=pyright method=textDocument/documentSymbol stage=documentSymbol workspacePartition=. class=timeout',
    '[tooling] request:failed provider=sourcekit method=textDocument/semanticTokens/full stage=semantic_tokens workspacePartition=swift-package class=request_failed',
    '[tooling] pyright circuit breaker tripped.',
    '[tooling] pyright degraded mode active (fail-open).',
    '[tooling] workspace:partition provider=gopls state=degraded reason=gopls_workspace_partition_incomplete workspacePartition=multiple partitionCount=2 unmatchedDocuments=1 unmatchedTargets=1',
    'using fallback parser'
  ].join('\n') + '\n',
  'utf8'
);

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: tempRoot,
  results: [],
  config: {}
});

const parity = output?.diagnostics?.parity;
assert.ok(parity && typeof parity === 'object', 'expected diagnostics parity summary');
assert.equal(parity.status, 'ok', 'expected parity summary to agree when logs and stream match');
assert.equal(parity.mismatchCount, 0, 'expected zero diagnostics parity mismatches');
assert.equal(parity.countsFromLogs.provider_preflight_blocked, 1, 'expected blocked preflight parity count');
assert.equal(parity.countsFromLogs.provider_request_timeout, 1, 'expected request timeout parity count');
assert.equal(parity.countsFromLogs.provider_degraded_mode_entered, 1, 'expected degraded mode parity count');
assert.equal(parity.countsFromDiagnosticsStream.provider_request_failed, 1, 'expected request failed stream parity count');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language diagnostics parity report test passed');
