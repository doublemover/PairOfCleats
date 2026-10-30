#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimpleBenchArgs } from '../shared.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';

const PREFIX = '\u001ePOC_ONNX_PROFILE:';
const MAX_REQUEST_BYTES = 64 * 1024, MAX_REPORT_BYTES = 1024 * 1024;
const args = parseSimpleBenchArgs();
const boolean = value => value === true || value === 'true' || value === '1';
const allowed = new Set(['qualify', 'repo', 'model', 'threads', 'sessions', 'intra-op', 'graph', 'arena',
  'mem-pattern', 'memory-evidence', 'out', 'batch', 'rounds', 'profile-child']);
if (Object.keys(args).some(key => !allowed.has(key))) throw new Error('Unknown ONNX execution-profile experiment option.');

const child = async () => {
  let bytes = 0, chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error('ONNX profile request exceeds its byte allowance.');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')); chunks = [];
  if (request.qualify !== true) throw new Error('Explicit --qualify is required for a real ONNX experiment.');
  const { loadUserConfig, getModelConfig } = await import('../../shared/dict-utils.js');
  const { resolveOnnxConfig } = await import('../../../src/shared/onnx-embeddings/config.js');
  const { resolveCurrentProcessRuntimeEnvelope } = await import('../../../src/shared/runtime-envelope/resolve-current-process-envelope.js');
  const { readEffectiveMemory } = await import('../../../src/shared/effective-memory.js');
  const { runOnnxProfileExperiment } = await import('./onnx-profile-experiment.js');
  const rootDir = path.resolve(request.repo), userConfig = loadUserConfig(rootDir);
  const model = getModelConfig(rootDir, userConfig);
  const onnxConfig = resolveOnnxConfig(userConfig.indexing?.embeddings?.onnx || userConfig.models?.onnx || {});
  const envelope = resolveCurrentProcessRuntimeEnvelope({ argv: request.threads == null ? {} : { threads: request.threads },
    rawArgv: request.threads == null ? [] : ['--threads', String(request.threads)], userConfig });
  const memory = readEffectiveMemory({ configuredLimitBytes: envelope.concurrency.totalMemBytes });
  const report = await runOnnxProfileExperiment({ rootDir, modelId: request.model || model.id,
    modelsDir: model.dir, onnxConfig, envelope, memory, candidate: request.candidate,
    memoryEvidence: request.memoryEvidence, batchSize: request.batchSize, rounds: request.rounds });
  const serialized = JSON.stringify(report);
  if (Buffer.byteLength(serialized) > MAX_REPORT_BYTES) throw new Error('ONNX profile report exceeds its byte allowance.');
  process.stdout.write(`${PREFIX}${serialized}\n`);
};

if (args['profile-child']) {
  await child().catch(error => { console.error(JSON.stringify({ code: error.code || 'ERR_ONNX_PROFILE',
    message: error.message, stack: error.stack, cacheOwnershipPending: error.cacheOwnershipPending === true })); process.exitCode = 1; });
} else {
  if (!boolean(args.qualify)) throw new Error('Explicit --qualify is required; no ONNX profile experiment runs by default.');
  let memoryEvidence = null;
  if (args['memory-evidence']) {
    const filename = path.resolve(String(args['memory-evidence']));
    const value = JSON.parse((await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: 128 * 1024 })).buffer.toString('utf8'));
    memoryEvidence = value.memoryEvidence || value;
  }
  const request = { qualify: true, repo: path.resolve(String(args.repo || process.cwd())), model: args.model || null,
    threads: args.threads == null ? null : Number(args.threads), memoryEvidence,
    batchSize: args.batch == null ? 4 : Number(args.batch), rounds: args.rounds == null ? 2 : Number(args.rounds),
    candidate: { sessions: args.sessions == null ? 1 : Number(args.sessions),
      intraOpNumThreads: args['intra-op'] == null ? 1 : Number(args['intra-op']), interOpNumThreads: 1,
      graphOptimizationLevel: args.graph || 'basic', enableCpuMemArena: boolean(args.arena),
      enableMemPattern: boolean(args['mem-pattern']) } };
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) throw new Error('ONNX profile request exceeds its byte allowance.');
  // The existing supervisor owns timeout, kill-tree, close confirmation and
  // pending ownership. A started case is never retried or moved into the parent.
  const outcome = await spawnSubprocess(process.execPath, [fileURLToPath(import.meta.url), '--profile-child'], {
    input, cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], timeoutMs: 28000,
    outputMode: 'string', maxOutputBytes: MAX_REPORT_BYTES + 4096, captureStdout: true, captureStderr: true,
    ownershipId: 'onnx-profile-experiment', cleanupScope: 'onnx-profile-experiment', name: 'onnx-profile-experiment' });
  if (outcome.outputCapture?.stdout?.truncated) throw new Error('Truncated ONNX profile evidence is not qualification.');
  const records = outcome.stdout.split(/\r?\n/).filter(line => line.startsWith(PREFIX));
  if (records.length !== 1) throw new Error('ONNX profile child returned missing or repeated terminal evidence.');
  const report = JSON.parse(records[0].slice(PREFIX.length));
  if (report.kind !== 'onnx-profile-experiment' || report.status !== 'observed-unaccepted' || report.accepted !== false) throw new Error('Invalid ONNX profile child evidence.');
  report.child = { exitCode: outcome.exitCode, durationMs: outcome.durationMs,
    stderr: outcome.stderr, outputCapture: outcome.outputCapture };
  const output = `${JSON.stringify(report)}\n`;
  if (args.out) {
    const handle = await fs.open(path.resolve(String(args.out)), 'wx', 0o600);
    try {
      const bytes = Buffer.from(output); let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
        if (!bytesWritten) throw new Error('Profile report write made no forward progress.');
        offset += bytesWritten;
      }
      await handle.sync();
    } finally { await handle.close(); }
  }
  process.stdout.write(output);
}
