#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { collectLspTypes } from '../../src/integrations/tooling/providers/lsp.js';
import {
  diffJsonRpcTraceSummaries,
  readJsonRpcTrace,
  replayJsonRpcTrace
} from '../../src/integrations/tooling/lsp/trace.js';
import { emitGateResult } from '../shared/tooling-gate-utils.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-lsp-replay-gate',
  options: {
    json: { type: 'string', default: '' },
    baseline: { type: 'string', default: '' },
    mode: { type: 'string', default: 'clangd-hover-richer' },
    enforce: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (detail === 'int add(int a, int b)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {
        a: 'int',
        b: 'int'
      },
      paramNames: ['a', 'b']
    };
  }
  return null;
};

const loadBaselineSummary = async (baselinePath) => {
  const resolvedPath = String(baselinePath || '').trim();
  if (!resolvedPath) return null;
  const raw = await fs.readFile(path.resolve(resolvedPath), 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed?.summary && typeof parsed.summary === 'object') return parsed.summary;
  return parsed && typeof parsed === 'object' ? parsed : null;
};

const main = async () => {
  const argv = parseArgs();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-replay-'));
  const tracePath = argv.json
    ? path.join(path.dirname(path.resolve(argv.json)), `tooling-lsp-replay-${String(argv.mode || 'signature-help')}.trace.jsonl`)
    : path.join(tempRoot, 'lsp-rpc-trace.jsonl');
  const cacheRoot = path.join(tempRoot, 'cache');
  const docText = 'add(a, b)\n';
  const virtualPath = '.poc-vfs/src/sample.cpp#seg:tooling-lsp-replay.cpp';
  const serverPath = path.join(process.cwd(), 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
  const baselineSummary = await loadBaselineSummary(argv.baseline);
  const previousTracePath = process.env.POC_LSP_RPC_TRACE;

  let result = null;
  try {
    process.env.POC_LSP_RPC_TRACE = tracePath;
    result = await collectLspTypes({
      rootDir: tempRoot,
      vfsRoot: tempRoot,
      cacheRoot,
      documents: [{
        virtualPath,
        text: docText,
        languageId: 'cpp',
        effectiveExt: '.cpp',
        docHash: 'trace-gate-doc-hash'
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid: 'ck64:v1:test:src/sample.cpp:tooling-lsp-replay',
          chunkId: 'chunk_tooling_lsp_replay',
          file: 'src/sample.cpp',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docText.length }
        },
        virtualPath,
        virtualRange: { start: 0, end: docText.length },
        symbolHint: { name: 'add', kind: 'function' }
      }],
      cmd: process.execPath,
      args: [serverPath, '--mode', String(argv.mode || 'clangd-hover-richer')],
      providerId: 'clangd',
      providerVersion: 'trace-gate',
      workspaceKey: 'trace-gate',
      parseSignature,
      hoverRequireMissingReturn: true,
      retries: 0,
      timeoutMs: 2000
    });
  } finally {
    if (previousTracePath == null) {
      delete process.env.POC_LSP_RPC_TRACE;
    } else {
      process.env.POC_LSP_RPC_TRACE = previousTracePath;
    }
  }

  try {
    const traceEntries = await readJsonRpcTrace(tracePath);
    const summary = replayJsonRpcTrace(traceEntries);
    const diff = baselineSummary ? diffJsonRpcTraceSummaries(summary, baselineSummary) : null;
    const failures = [];

    if (!summary.outboundRequests.includes('initialize')) {
      failures.push('trace missing outbound initialize request');
    }
    if (!summary.outboundNotifications.includes('textDocument/didOpen')) {
      failures.push('trace missing outbound didOpen notification');
    }
    if (!summary.outboundRequests.includes('textDocument/documentSymbol')) {
      failures.push('trace missing outbound documentSymbol request');
    }
    if (!summary.outboundRequests.includes('textDocument/hover')) {
      failures.push('trace missing outbound hover request');
    }
    if (summary.pendingRequestCount > 0) {
      failures.push(`trace replay left ${summary.pendingRequestCount} pending request(s)`);
    }
    if (summary.unmatchedResponses > 0) {
      failures.push(`trace replay found ${summary.unmatchedResponses} unmatched response(s)`);
    }
    if (summary.hasProtocolErrors) {
      failures.push('trace replay reported protocol errors');
    }
    if (!result?.byChunkUid || !result.byChunkUid['ck64:v1:test:src/sample.cpp:tooling-lsp-replay']) {
      failures.push('trace capture run did not produce enrichment payload');
    }

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: failures.length ? (argv.enforce === true ? 'error' : 'warn') : 'ok',
      enforced: argv.enforce === true,
      mode: String(argv.mode || 'clangd-hover-richer'),
      tracePath,
      summary,
      diff,
      failures
    };

    await emitGateResult({
      jsonPath: argv.json,
      payload,
      heading: 'Tooling LSP replay gate',
      summaryLines: [
        `- status: ${payload.status}`,
        `- mode: ${payload.mode}`,
        `- traceEvents: ${summary.eventCount}`,
        `- outboundRequests: ${summary.outboundRequests.length}`,
        `- pendingRequestCount: ${summary.pendingRequestCount}`,
        `- unmatchedResponses: ${summary.unmatchedResponses}`
      ],
      failures,
      enforceFailureExit: argv.enforce === true
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
};

main().catch((error) => {
  console.error(`tooling lsp replay gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
