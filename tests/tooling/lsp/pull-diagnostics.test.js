import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiagnosticPull } from '../../../src/integrations/tooling/providers/lsp/pull-diagnostics.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { TYPESCRIPT_NATIVE_PROFILE, TYPESCRIPT_NATIVE_PRESET } from '../../../src/index/tooling/typescript-native-profile.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { createToolingGuard } from '../../../src/integrations/tooling/providers/shared.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/pull-diagnostics/')[1];
const diagnostic = { message: 'current diagnostic', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
const document = { uri: 'file:///owned/a.ts', version: 1, closed: false };
const openDocs = new Map([['a.ts', document]]), accepted = new Map();
const input = { capability: { identifier: 'typescript' }, openDocs,
  setDiagnosticsForUri: (uri, items, version) => accepted.set(uri, { items, version }),
  invalidateDiagnosticsForUri: uri => accepted.delete(uri),
  request: async (method, params, timeout) => { assert.equal(method, 'textDocument/diagnostic');
    assert.deepEqual(params, { textDocument: { uri: document.uri }, identifier: 'typescript' }); assert.ok(timeout > 0 && timeout <= 4000);
    return { kind: 'full', items: [diagnostic] }; } };
if (mode === 'full-original-document-report') {
  const result = await createDiagnosticPull().collect(input);
  assert.equal(result.complete, true); assert.equal(result.observed, 1); assert.deepEqual(accepted.get(document.uri), { items: [diagnostic], version: 1 });
  const unsupported = await createDiagnosticPull().collect({ ...input, capability: null, request: () => assert.fail('Push-only server cannot get pull requests') });
  assert.equal(unsupported.mode, 'push');
} else if (mode === 'refresh-replaces-prior-reports') {
  const pull = createDiagnosticPull(); let requests = 0, clears = 0;
  const result = await pull.collect({ ...input, request: async () => {
    if (++requests === 1) { pull.refresh(); return { kind: 'full', items: [{ ...diagnostic, message: 'stale' }] }; }
    return { kind: 'full', items: [diagnostic] };
  }, invalidateDiagnosticsForUri: uri => { clears++; accepted.delete(uri); } });
  assert.equal(result.complete, true); assert.equal(result.passes, 2); assert.equal(requests, 2); assert.equal(clears, 1);
  assert.deepEqual(accepted.get(document.uri).items, [diagnostic]);
  const noisy = createDiagnosticPull(); accepted.clear();
  const limited = await noisy.collect({ ...input, request: async () => { noisy.refresh(); return { kind: 'full', items: [diagnostic] }; } });
  assert.equal(limited.complete, false); assert.equal(limited.reason, 'refresh-limit'); assert.equal(limited.requested, 2); assert.equal(accepted.size, 0);
} else if (mode === 'bounded-admission-and-unsupported-reports') {
  let clock = 0, requests = 0;
  const docs = new Map([['a.ts', document], ['b.ts', { uri: 'file:///owned/b.ts', version: 1, closed: false }]]);
  const result = await createDiagnosticPull({ now: () => clock }).collect({ ...input, openDocs: docs, maxDurationMs: 10,
    request: async () => { requests++; clock = 10; return { kind: 'full', items: [diagnostic] }; } });
  assert.equal(result.complete, false); assert.equal(result.reason, 'deadline'); assert.equal(requests, 1);
  const capped = await createDiagnosticPull().collect({ ...input, openDocs: docs, maxDocuments: 1 });
  assert.equal(capped.complete, false); assert.equal(capped.omittedDocuments, 1); assert.equal(capped.requested, 1);
  accepted.clear();
  for (const report of [{ kind: 'unchanged', resultId: 'unowned-old-answer' }, { kind: 'full', items: null }]) {
    const rejected = await createDiagnosticPull().collect({ ...input, request: async () => report });
    assert.equal(rejected.complete, false); assert.equal(rejected.reason, 'unsupported-report'); assert.equal(accepted.size, 0);
  }
  const related = await createDiagnosticPull().collect({ ...input, request: async () => ({ kind: 'full', items: [],
    relatedDocuments: { 'file:///foreign.ts': { kind: 'full', items: [diagnostic] } } }) });
  assert.equal(related.complete, false); assert.equal(related.reason, 'unrequested-related-documents'); assert.equal(accepted.has('file:///foreign.ts'), false);
} else if (mode === 'replacement-and-original-pending-work') {
  const changed = await createDiagnosticPull().collect({ ...input, request: async () => {
    openDocs.set('a.ts', { ...document }); return { kind: 'full', items: [diagnostic] };
  } });
  assert.equal(changed.complete, false); assert.equal(changed.reason, 'document-changed'); assert.equal(accepted.size, 0);
  openDocs.set('a.ts', document);
  const original = Object.assign(new Error('original request still owns work'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => false });
  await assert.rejects(() => createDiagnosticPull().collect({ ...input, request: async () => { throw original; } }),
    error => error === original || error.cause === original || error.errors?.includes(original));
  const controller = new AbortController(); controller.abort(false);
  await assert.rejects(() => createDiagnosticPull().collect({ ...input, signal: controller.signal, request: () => assert.fail('Pre-cancelled request launched') }),
    error => error.cause === false || error === false);
} else if (mode === 'guard-narrows-retry-admission') {
  const original = new Error('single bounded diagnostic failure'); let calls = 0;
  const guard = createToolingGuard({ name: 'bounded-diagnostic-fixture', retries: 2, breakerThreshold: 10 });
  await assert.rejects(() => guard.run(async parameters => { calls++; assert.equal(parameters.retriesRemaining, 0); throw original; },
    { retriesOverride: 0 }), error => error === original);
  assert.equal(calls, 1, 'a shared diagnostic deadline cannot inherit a multi-attempt request policy');
  const none = createToolingGuard({ name: 'zero-retry-fixture', retries: 0, breakerThreshold: 10 });
  await assert.rejects(() => none.run(async parameters => { assert.equal(parameters.retriesRemaining, 0); throw original; },
    { retriesOverride: 5 }), error => error === original);
  await assert.rejects(() => guard.run(() => assert.fail('Invalid retry policy admitted work'), { retriesOverride: -1 }), TypeError);
} else if (mode === 'framed-native-profile-and-owned-disposal') {
  const scope = path.resolve('.tmp/tasks/typescript-pull-fixture'); await fs.mkdir(scope, { recursive: true });
  const root = await fs.mkdtemp(path.join(scope, 'case-')), trace = path.join(root, 'trace.jsonl');
  const text = 'export const answer: number = "broken";\n', virtualPath = 'sample.ts', chunkUid = 'ck64:v1:test:typescript:pull';
  try {
    await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null,
      PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([root]) }), async () => {
      const result = await collectLspTypes({ rootDir: root, vfsRoot: root,
        documents: [{ virtualPath, text, effectiveExt: '.ts', languageId: 'typescript' }],
        targets: [{ chunkRef: { docId: 0, chunkUid, chunkId: 'native-pull', file: virtualPath,
          segmentUid: null, segmentId: null, range: { start: 0, end: text.length } },
        virtualPath, virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'answer', kind: 'variable' } }],
        providerId: 'lsp-typescript-native', protocolProfile: TYPESCRIPT_NATIVE_PROFILE,
        cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/native-typescript-pull-server.js'), trace],
        initializationOptions: TYPESCRIPT_NATIVE_PRESET.initializationOptions,
        collectTypes: false, captureDiagnostics: true, sessionPoolingEnabled: false, vfsColdStartCache: false,
        timeoutMs: 3000, retries: 0, documentSymbolConcurrency: 1, hoverConcurrency: 1,
        hoverEnabled: false, signatureHelpEnabled: false, definitionEnabled: false, typeDefinitionEnabled: false,
        referencesEnabled: false, semanticTokensEnabled: false, inlayHintsEnabled: false });
      assert.equal(result.diagnosticsCount, 1);
      assert.equal(result.diagnosticsByChunkUid[chunkUid][0].message, 'native pull fixture type mismatch');
      assert.equal(result.runtime.diagnosticsDrain.mode, 'pull'); assert.equal(result.runtime.diagnosticsDrain.complete, true);
      const events = (await fs.readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line).kind);
      for (const required of ['initialize', 'settings', 'open', 'refresh-ack', 'pull', 'close', 'shutdown']) assert.ok(events.includes(required), required);
      assert.ok(events.indexOf('pull') < events.indexOf('close')); assert.ok(events.indexOf('close') < events.indexOf('shutdown'));
      assert.deepEqual(result.checks.filter(check => check.status === 'warn' || check.status === 'error'), []);
    });
  } finally { await fs.rm(root, { recursive: true }); }
} else throw new Error('Unknown pull diagnostics case: ' + mode);
console.log('Pull diagnostics case passed: ' + mode);
