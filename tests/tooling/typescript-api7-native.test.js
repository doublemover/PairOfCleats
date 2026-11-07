import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { runTypeScriptApi7Request } from '../../src/index/tooling/typescript/api7/runtime.js';
import { TYPESCRIPT_API7_PROFILE } from '../../src/shared/typescript-api7-pins.js';
import { TYPESCRIPT_API7_QUALIFICATION_ROOT, TYPESCRIPT_API7_QUALIFICATION_TOOLING } from '../../tools/ci/typescript-api7-qualification.js';
import { createTypeIrArena, deserializeTypeIr, containsTypeIr } from '../../src/index/tooling/typescript/type-ir/index.js';
import { createFiniteStringFrontend } from '../../src/index/tooling/typescript/type-ir/frontend.js';
import { createSymbolicTypeGraph } from '../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../src/index/build/artifacts/checksums.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { openPublishedSymbolicTypeStore } from '../../src/semantic/symbolic-type-store.js';
import { runSemanticDetail } from '../../src/integrations/tooling/semantic-detail.js';
import { getBuildsRoot } from '../../src/shared/repo-paths.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { getTrackedSubprocessCount, trackedOwnershipIdByAbortSignal } from '../../src/shared/subprocess/tracking.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/typescript-api7-native/')[1];
assert.ok(['finite-strings-and-overloads', 'configured-dependency-authority', 'host-fallback-refused', 'original-snapshot-isolation',
  'cancellation', 'invalid-config', 'retained-template-parity'].includes(mode));
const hash = value => createHash('sha256').update(value).digest('hex');
const requestFor = (text, name = 'State') => ({ schemaVersion: 1, profile: TYPESCRIPT_API7_PROFILE,
  files: [{ path: 'main.ts', text }], project: { kind: 'roots', roots: ['main.ts'] },
  queries: [{ id: 'state', path: 'main.ts', position: text.indexOf(name) }] });
const run = request => runTypeScriptApi7Request({ toolingRoot: TYPESCRIPT_API7_QUALIFICATION_TOOLING, request });
const word = "export type State = 'on' | 'off';\n";
const members = (value, cases) => {
  assert.equal(value.status, 'exact-finite-string');
  const { arena, root } = deserializeTypeIr(value.finiteString.graph, { contextKey: value.finiteString.contextKey });
  for (const [text, expected] of cases) assert.equal(containsTypeIr(arena, root, text), expected, text);
};
let temporary, result;
try {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) {
    await assert.rejects(run(requestFor(word)), { code: 'ERR_TYPESCRIPT_API7_PLATFORM' });
  } else {
    await fs.mkdir(TYPESCRIPT_API7_QUALIFICATION_ROOT, { recursive: true });
    temporary = await fs.mkdtemp(path.join(TYPESCRIPT_API7_QUALIFICATION_ROOT, 'case-'));
    if (mode === 'finite-strings-and-overloads') {
      const text = word + '/** Toggle state. */\nexport function turn(value: "on"): "off";\n'
        + 'export function turn(value: "off"): "on";\nexport function turn(value: State): State { return value === "on" ? "off" : "on"; }\n';
      const request = requestFor(text); request.queries.push({ id: 'turn', path: 'main.ts', position: text.indexOf('turn') });
      result = await run(request); members(result.answers[0].type, [['on', true], ['off', true], ['other', false]]);
      const answer = result.answers[1]; assert.equal(answer.signatures.length, 2);
      assert.ok(answer.symbol.native.documentation.includes('Toggle state.')); assert.equal(answer.symbol.declarations.length, 3);
      for (const signature of answer.signatures) assert.equal(signature.parameters.length, 1);
      assert.ok(result.diagnostics.every(item => item.code === 2318), 'noLib profile explicitly reports only its missing global library types');
    } else if (mode === 'configured-dependency-authority') {
      const text = 'import type { Mode } from "./lib/index.js";\nexport const current: Mode = "on";\n';
      const request = requestFor(text, 'Mode'); request.files.push({ path: 'lib/index.ts', text: word.replace('State', 'Mode') },
        { path: 'base.json', text: '{"compilerOptions":{"strict":true,"noLib":true,"types":[],"module":"nodenext","moduleResolution":"nodenext"}}' },
        { path: 'tsconfig.json', text: '{"extends":"./base.json","files":["main.ts","lib/index.ts"]}' });
      request.project = { kind: 'configured', configFiles: ['tsconfig.json'] }; request.queries[0].configFile = 'tsconfig.json';
      result = await run(request); const answer = result.answers[0];
      assert.equal(answer.symbol.aliasTarget.status, 'resolved'); assert.equal(answer.symbol.aliasTarget.symbol.declarations[0].path, 'lib/index.ts');
      members(answer.type, [['on', true], ['off', true], ['hidden', false]]);
      assert.deepEqual(new Set(result.projects[0].configFiles.map(item => item.path)), new Set(['base.json', 'tsconfig.json']));
      assert.ok(result.diagnostics.every(item => item.code === 2318));
    } else if (mode === 'host-fallback-refused') {
      const file = path.join(temporary, 'outside.ts'); await fs.writeFile(file, 'export type Secret = "UNADMITTED_VALUE";');
      const text = 'import type { Secret } from ' + JSON.stringify(file.replaceAll('\\', '/')) + ';\nexport let current: Secret;\n';
      result = await run(requestFor(text, 'current'));
      assert.ok(result.diagnostics.some(item => item.code === 2307), 'physical outside file must remain absent in the full request filesystem');
      assert.equal(JSON.stringify(result).includes('UNADMITTED_VALUE'), false);
      assert.ok(result.diagnostics.every(item => [2307, 2318].includes(item.code)));
    } else if (mode === 'original-snapshot-isolation') {
      const first = await run(requestFor(word)), second = await run(requestFor(word.replace("'off'", "'ready'")));
      members(first.answers[0].type, [['off', true], ['ready', false]]); members(second.answers[0].type, [['ready', true], ['off', false]]);
      assert.notEqual(first.worldIdentity, second.worldIdentity); assert.notEqual(first.answers[0].sourceHash, second.answers[0].sourceHash);
      assert.equal(first.answers[0].sourceHash, hash(word)); assert.equal(first.answers[0].type.finiteString.contextKey, first.worldIdentity);
      result = { first, second };
    } else if (mode === 'cancellation') {
      const aborted = new AbortController(); aborted.abort(null);
      await assert.rejects(runTypeScriptApi7Request({ toolingRoot: TYPESCRIPT_API7_QUALIFICATION_TOOLING,
        request: requestFor(word), signal: aborted.signal }), error => error === null || error.name === 'AbortError');
      const controller = new AbortController(), owner = 'api7-native-cancel-' + process.pid;
      trackedOwnershipIdByAbortSignal.set(controller.signal, owner);
      const source = word + Array.from({ length: 6000 }, (_, index) => `export const value${index}: State = 'on';`).join('\n');
      let observedBothChildren = false;
      const watch = setInterval(() => {
        if (getTrackedSubprocessCount(owner) < 2) return;
        observedBothChildren = true; controller.abort(new Error('Original API7 caller cancellation.'));
      }, 2);
      const timer = setTimeout(() => controller.abort(new Error('Both original API7 children were not observed within the fixture admission bound.')), 2000);
      let failure;
      try { await runTypeScriptApi7Request({ toolingRoot: TYPESCRIPT_API7_QUALIFICATION_TOOLING, request: requestFor(source), signal: controller.signal }); }
      catch (error) { failure = error; }
      finally { clearTimeout(timer); clearInterval(watch); }
      assert.ok(controller.signal.aborted && failure, 'cancellation cannot publish a successful request');
      assert.equal(observedBothChildren, true, 'cancel only after both real subprocess owners exist');
      assert.equal(getTrackedSubprocessCount(owner), 0, 'both original child owners must close');
      assert.equal(failure.typescriptApi7Session.releaseAfterClosure(), true);
      result = { cancelled: true, trackedChildren: 0 };
    } else if (mode === 'invalid-config') {
      const request = requestFor(word); request.files.push({ path: 'tsconfig.json', text: '{"compilerOptions":{"noLib":true,"unknownOption":true},"files":["main.ts"]}' });
      request.project = { kind: 'configured', configFiles: ['tsconfig.json'] }; request.queries[0].configFile = 'tsconfig.json';
      result = await run(request);
      assert.ok(result.diagnostics.some(item => item.code === 5023 && item.text.includes('unknownOption')));
      assert.ok(result.diagnostics.every(item => [2318, 5023].includes(item.code)));
    } else {
      const text = "export type State = `prefix:${'on' | 'off'}`;\n";
      result = await run(requestFor(text)); const finite = result.answers[0].type;
      members(finite, [['prefix:on', true], ['prefix:off', true], ['prefix:other', false], ['on', false]]);
      const file = path.join(temporary, 'baseline.ts').replaceAll('\\', '/'), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const host = { getSourceFile: name => name === file ? ast : undefined, getDefaultLibFileName: () => 'absent.d.ts', writeFile() {},
        getCurrentDirectory: () => temporary, getDirectories: () => [], fileExists: name => name === file, readFile: name => name === file ? text : undefined,
        directoryExists: name => name === temporary, getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
      const program = ts.createProgram([file], { noLib: true, noEmit: true, strict: true }, host);
      const arena = createTypeIrArena({ contextKey: 'api7-paired-typescript-baseline' });
      const lowered = createFiniteStringFrontend({ ts, checker: program.getTypeChecker(), arena }).lowerTypeNode(ast.statements[0].type);
      assert.equal(lowered.status, 'complete');
      const native = deserializeTypeIr(finite.finiteString.graph);
      for (const value of ['prefix:on', 'prefix:off', 'prefix:other', 'on', ''])
        assert.equal(containsTypeIr(arena, lowered.root, value), containsTypeIr(native.arena, native.root, value));
      const repoRoot = path.join(temporary, 'repo'); await fs.mkdir(repoRoot);
      applyTestEnv({ cacheRoot: path.join(temporary, 'cache'), testConfig: { indexing: { semantic: { enabled: false } } } });
      const generation = { baseBuildId: 'api7-retained-' + process.pid, semanticRevision: 0 };
      const outDir = path.join(getBuildsRoot(repoRoot), generation.baseBuildId, 'index-code'); await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
      const graph = createSymbolicTypeGraph(finite.finiteString.graph), registry = createArtifactPieceRegistry({ outDir }), writes = [];
      enqueueSymbolicTypeArtifacts({ state: { chunks: [], symbolicTypeGraphs: [graph] }, outDir, indexState: { buildId: generation.baseBuildId },
        addPieceFile: registry.addPieceFile, declareArtifactFamily() {}, enqueueWrite(name, write) { writes.push(write); } });
      for (const write of writes) await write();
      await writePiecesManifest({ pieceEntries: registry.listPieceEntries(), outDir, mode: 'code',
        indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId }, abortSignal: new AbortController().signal });
      const ref = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId, contextKey: graph.graph.contextKey, nodeId: finite.finiteString.rootId };
      const store = await openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot, generation });
      assert.equal((await store.query({ ref, operation: 'membership', value: 'prefix:on' })).contains, true);
      assert.equal((await store.query({ ref, operation: 'membership', value: 'prefix:other' })).contains, false);
      const detail = await runSemanticDetail({ repoRoot, generation, refs: [], typeQueries: [{ ref, operation: 'classify' }] });
      assert.equal(detail.status, 'complete'); assert.equal(detail.typeResults[0].cardinality, 'many');
    }
    const results = mode === 'original-snapshot-isolation' ? [result.first, result.second] : mode === 'cancellation' ? [] : [result];
    for (const receipt of results) {
      assert.equal(receipt.lifecycle.nativeCloseObserved, true); assert.equal(receipt.lifecycle.sdkCloseObserved, true);
      assert.equal(receipt.lifecycle.nativeExitCode, 0); assert.equal(receipt.lifecycle.sdkExitCode, 0);
      assert.equal(receipt.lifecycle.apiClosed, true); assert.equal(receipt.lifecycle.snapshotDisposed, true);
      assert.equal(receipt.toolIdentity.version, '7.1.0-beta');
    }
    const evidence = path.resolve('.diagnostics', 'typescript-api7'); await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  }
  console.log('TypeScript7.1 native ' + mode + ' passed');
} finally {
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
