#!/usr/bin/env node
import { resolveDevelopmentArtifactPath } from '../../tools/shared/dev-artifacts.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { resolveTypeScriptRuntimeHeapMb, runTypeScriptProviderSubprocess } from '../../src/index/tooling/typescript/runtime/index.js';
import { getTrackedSubprocessCount, trackedOwnershipIdByAbortSignal } from '../../src/shared/subprocess/tracking.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-runtime-'));
const oldTrusted = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const oldMode = process.env.POC_TYPESCRIPT_RUNTIME_FIXTURE_MODE;
let toolingDir = null;
const reason = expected => error => error.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE' && error.reason === expected;
const normalized = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'collectedAt' ? '<time>' : item));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const running = async pid => {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') return (await fs.readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1]?.[0] !== 'Z';
    return true;
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return false; throw error; }
};
try {
  assert.equal(resolveTypeScriptRuntimeHeapMb({ env: {}, execArgv: [] }), 4096);
  assert.equal(resolveTypeScriptRuntimeHeapMb({ env: { NODE_OPTIONS: '--max-old-space-size=16384' }, execArgv: [] }), 16384);
  assert.equal(resolveTypeScriptRuntimeHeapMb({ env: { NODE_OPTIONS: '--max-old-space-size=16384' }, execArgv: ['--max-old-space-size=2048'] }), 2048);
  assert.equal(resolveTypeScriptRuntimeHeapMb({ env: { NODE_OPTIONS: '--max-old-space-size=16384' }, execArgv: ['--max-old-space-size', '2048'] }), 4096,
    'invalid spaced Node 26 startup flags cannot authorize a heap observation');
  assert.equal(resolveTypeScriptRuntimeHeapMb({ maxOldSpaceMb: 512, env: { NODE_OPTIONS: '--max-old-space-size=16384' }, execArgv: ['--max-old-space-size=2048'] }), 512);
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: ['consumer.ts', 'shared.ts', 'ambient.d.ts'] }));
  await fs.writeFile(path.join(root, 'consumer.ts'), 'export function read() { return "stale physical snapshot"; }');
  await fs.writeFile(path.join(root, 'shared.ts'), 'export const shared = "stale";');
  await fs.writeFile(path.join(root, 'ambient.d.ts'), 'declare const ambient: { ready: boolean };');
  const documents = [
    { containerPath: 'consumer.ts', virtualPath: '.vfs/a/input.ts', effectiveExt: '.ts', languageId: 'typescript',
      text: 'import { shared } from "./shared"; export function read(input: string) { return { value: shared, input, ready: ambient.ready }; }' },
    { containerPath: 'shared.ts', virtualPath: '.vfs/b/input.ts', effectiveExt: '.ts', languageId: 'typescript', text: 'export const shared = 42;' }
  ];
  const start = documents[0].text.indexOf('export function');
  const end = documents[0].text.length;
  const inputs = { documents, targets: [{ virtualPath: documents[0].virtualPath, virtualRange: { start, end },
    chunkRef: { chunkUid: 'ck:runtime', chunkId: 'chunk_runtime', file: 'consumer.ts', start, end },
    symbolHint: { name: 'read', kind: 'function' } }] };
  const ctx = { repoRoot: root, strict: true, toolingConfig: { typescript: { resolveOrder: ['global'] } } };
  const direct = await createTypeScriptProvider().run(ctx, inputs);
  const seen = [];
  const isolated = await runTypeScriptProviderSubprocess(ctx, inputs, {
    timeoutMs: 5000, maxOldSpaceMb: 256, ownershipId: 'ts-runtime-parity',
    onRecord: async record => { await sleep(1); seen.push(record.type); }
  });
  assert.deepEqual(normalized(isolated), normalized(direct), 'transport must preserve ordinary provider results, VFS snapshots and ambient context');
  assert.match(isolated.byChunkUid['ck:runtime'].payload.returnType, /value: number/);
  assert.match(isolated.byChunkUid['ck:runtime'].payload.returnType, /ready: boolean/);
  assert.ok(seen.includes('chunk') && seen.includes('complete'));
  assert.equal(getTrackedSubprocessCount('ts-runtime-parity'), 0);
  const toolingCacheParent = resolveDevelopmentArtifactPath(process.cwd(), 'test-cache');
  await fs.mkdir(toolingCacheParent, { recursive: true });
  toolingDir = await fs.mkdtemp(path.join(toolingCacheParent, 'typescript-runtime-relative-'));
  const cachedCompiler = path.join(toolingDir, 'node/node_modules/typescript/lib/typescript.js');
  await fs.mkdir(path.dirname(cachedCompiler), { recursive: true });
  await fs.copyFile(fileURLToPath(import.meta.resolve('typescript')), cachedCompiler);
  const relativeContext = { ...ctx, toolingConfig: { dir: path.relative(process.cwd(), toolingDir), typescript: { resolveOrder: ['cache'] } } };
  const relativeDirect = await createTypeScriptProvider().run(relativeContext, inputs);
  const relativeIsolated = await runTypeScriptProviderSubprocess(relativeContext, inputs, { timeoutMs: 5000 });
  assert.deepEqual(normalized(relativeIsolated), normalized(relativeDirect), 'relative tooling cache resolution must preserve the launcher working directory');
  await assert.rejects(runTypeScriptProviderSubprocess({ ...ctx, semanticSession: {} }, inputs), reason('unsupported-compiler-session'));
  await assert.rejects(runTypeScriptProviderSubprocess({ ...ctx, semanticLspSession: {} }, inputs), reason('unsupported-compiler-session'));
  await assert.rejects(runTypeScriptProviderSubprocess({ ...ctx, compilerSystem() {} }, inputs), reason('unsupported-compiler-session'));
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(runTypeScriptProviderSubprocess({ ...ctx, abortSignal: stopped.signal }, inputs), error => error.code === 'ABORT_ERR');
  await assert.rejects(runTypeScriptProviderSubprocess(ctx, inputs, { timeoutMs: 5000, maxCollectorBytes: 10 }), reason('collector-byte-limit'));
  await assert.rejects(runTypeScriptProviderSubprocess(ctx, inputs, { timeoutMs: 5000, protocolLimits: { maxRecordBytes: 256 } }), reason('record-byte-limit'));
  // Even if the child has exited, an unfinished async record consumer remains
  // subject to the invocation deadline. It cannot hang the provider forever.
  await assert.rejects(runTypeScriptProviderSubprocess({ ...ctx, toolingConfig: { typescript: { enabled: false } } }, { documents: [], targets: [] }, {
    timeoutMs: 300, onRecord: () => new Promise(() => {})
  }), reason('timeout'));

  const compiler = path.join(root, 'node_modules/typescript/lib/typescript.js');
  const marker = path.join(root, 'child-pids.json');
  await fs.mkdir(path.dirname(compiler), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/typescript/package.json'), '{"type":"module"}');
  await fs.writeFile(compiler, [
    'import { spawn } from "node:child_process";',
    'import fs from "node:fs";',
    'const mode = process.env.POC_TYPESCRIPT_RUNTIME_FIXTURE_MODE;',
    'if (mode === "exit") process.exit(19);',
    'if (mode === "malformed") process.stdout.write("{bad}\\n");',
    'if (mode === "oversized") process.stdout.write("x".repeat(4096) + "\\n");',
    'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], { stdio: "ignore" });',
    `fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, descendant.pid]));`,
    'setInterval(() => {}, 10000);',
    'await new Promise(() => {});',
    'export default {};'
  ].join('\n'));
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([root]);
  const fixtureCtx = { ...ctx, toolingConfig: { typescript: { resolveOrder: ['repo'] } } };
  for (const mode of ['timeout', 'abort', 'malformed', 'oversized', 'exit']) {
    await fs.rm(marker, { force: true });
    process.env.POC_TYPESCRIPT_RUNTIME_FIXTURE_MODE = mode;
    const controller = new AbortController();
    trackedOwnershipIdByAbortSignal.set(controller.signal, `ts-runtime-${mode}`);
    const pending = runTypeScriptProviderSubprocess(fixtureCtx, inputs, {
      timeoutMs: mode === 'timeout' ? 1000 : 3000,
      signal: controller.signal,
      protocolLimits: { maxRecordBytes: 2048 }
    });
    // Attach rejection handling immediately while waiting for the owned child.
    const expected = mode === 'oversized' ? 'record-byte-limit' : mode === 'malformed' ? 'malformed-record'
      : mode === 'abort' ? 'aborted' : mode === 'exit' ? 'child-exit' : 'timeout';
    const checked = assert.rejects(pending, mode === 'abort' ? error => error.code === 'ABORT_ERR' : reason(expected));
    if (mode === 'abort') {
      for (let i = 0; i < 100; i += 1) {
        if (await fs.stat(marker).then(() => true, () => false)) break;
        await sleep(10);
      }
      assert.ok(await fs.stat(marker).then(() => true, () => false), 'abort fixture must first launch its descendant');
      controller.abort();
    }
    await checked;
    assert.equal(getTrackedSubprocessCount(`ts-runtime-${mode}`), 0, `${mode}: child ownership must be reaped`);
    const pids = await fs.readFile(marker, 'utf8').then(JSON.parse, () => []);
    if (mode === 'abort' || mode === 'timeout') assert.equal(pids.length, 2);
    for (const pid of pids) assert.equal(await running(pid), false, `${mode}: owned pid ${pid} must not remain alive`);
  }
  // Use the actual compiler, blocking its checker seam after Program creation.
  // The parent's logger must observe that phase before the provider completes.
  await fs.writeFile(compiler, [
    `import ts from ${JSON.stringify(import.meta.resolve('typescript'))};`,
    'export default { ...ts, createProgram(...args) {',
    '  const program = ts.createProgram(...args);',
    '  const checker = program.getTypeChecker;',
    '  program.getTypeChecker = (...inner) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); return checker(...inner); };',
    '  return program;',
    '} };'
  ].join('\n'));
  const phaseController = new AbortController();
  let observedBlockedPhase = false;
  await assert.rejects(runTypeScriptProviderSubprocess({ ...fixtureCtx, logger: event => {
    if (event.message.includes('phase=checker:start')) {
      observedBlockedPhase = true;
      phaseController.abort();
    }
  } }, inputs, { timeoutMs: 3000, signal: phaseController.signal, ownershipId: 'ts-runtime-live-phase' }), error => error.code === 'ABORT_ERR');
  assert.equal(observedBlockedPhase, true, 'phase telemetry must arrive before the blocked checker returns');
  assert.equal(getTrackedSubprocessCount('ts-runtime-live-phase'), 0);
  console.log('TypeScript subprocess preserves full-context parity and reaps timeout, abort and invalid-protocol children.');
} finally {
  if (oldTrusted === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = oldTrusted;
  if (oldMode === undefined) delete process.env.POC_TYPESCRIPT_RUNTIME_FIXTURE_MODE;
  else process.env.POC_TYPESCRIPT_RUNTIME_FIXTURE_MODE = oldMode;
  await fs.rm(root, { recursive: true, force: true });
  if (toolingDir) await fs.rm(toolingDir, { recursive: true, force: true });
}
