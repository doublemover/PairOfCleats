import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { captureTypeScriptApi7Request, api7Identity } from '../../src/index/tooling/typescript/api7/request.js';
import { projectTypeScriptApi7Snapshot } from '../../src/index/tooling/typescript/api7/projection.js';
import { captureTypeScriptApi7Result } from '../../src/index/tooling/typescript/api7/result.js';
import { deserializeTypeIr, classifyTypeIr, containsTypeIr } from '../../src/index/tooling/typescript/type-ir/index.js';
import { TYPESCRIPT_API7_PROFILE } from '../../src/shared/typescript-api7-pins.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/typescript-api7-contract/')[1];
assert.ok(['closed-request', 'passive-source-ownership', 'path-and-project-authority', 'query-authority', 'finite-string-consumer',
  'aliases-overloads-and-docs', 'unsupported-and-budget', 'snapshot-and-source-identity', 'configuration-closure', 'receipt-rejection', 'compiler-capability-inventory'].includes(mode));
const source = "export type State = 'on' | 'off';\nexport function turn(value: State): State { return value; }\n";
const makeRequest = () => ({ schemaVersion: 1, profile: TYPESCRIPT_API7_PROFILE,
  files: [{ path: 'main.ts', text: source }], project: { kind: 'roots', roots: ['main.ts'] },
  queries: [{ id: 'state', path: 'main.ts', position: source.indexOf('State') }] });
const virtualRoot = 'C:/__pairofcleats_api7__/11111111111111111111111111111111';
const toolIdentity = { sdk: { descriptorId: 'a'.repeat(64), installId: 'b'.repeat(64) }, native: { descriptorId: 'c'.repeat(64), installId: 'd'.repeat(64) } };
// These inert SDK-shaped values exercise projection and consumer contracts.
// They are never presented as native execution or vendor API qualification.
const flags = { StringLiteral: 1, Never: 2, Union: 4, TemplateLiteral: 8, Object: 16 };
const literal = value => ({ flags: flags.StringLiteral, value, isErrorType: () => false });
const union = values => ({ flags: flags.Union, getTypes: async () => values, isErrorType: () => false });
const world = (request = makeRequest()) => {
  const sdk = { TypeFlags: flags, SymbolFlags: { Alias: 1 }, SignatureKind: { Call: 0, Construct: 1 } };
  const type = union([literal('on'), literal('off')]);
  const handle = { path: virtualRoot + '/main.ts', resolve: async () => ({ pos: 0, end: source.indexOf('\n'), kind: 266 }) };
  const symbol = { name: 'State', flags: 0, declarations: [handle], getDocumentationComment: async () => 'The switch state.',
    getJsDocTags: async () => [{ name: 'example', text: 'on' }] };
  const checker = { getSymbolAtPosition: async () => symbol, getTypeAtPosition: async () => type,
    typeToString: async item => item.value ? JSON.stringify(item.value) : 'State', getSignaturesOfType: async () => [],
    getTypeOfSymbol: async () => type, getAliasedSymbol: async () => symbol, isUnknownSymbol: async () => false };
  const program = { getSourceFileNames: async () => [virtualRoot + '/main.ts'],
    getSourceFile: async () => ({ text: source }), getConfigFileNames: async () => [],
    getConfigSourceFile: async () => undefined, getCompilerOptions: () => ({ noEmit: true, noLib: true }) };
  for (const name of ['ConfigFileParsing', 'Program', 'Global', 'Syntactic', 'Bind', 'Semantic', 'Suggestion']) program['get' + name + 'Diagnostics'] = async () => [];
  const project = { id: 'synthetic:1', checker, program }, snapshot = { id: 1, getProjects: () => [project], getConfiguredProject: () => project };
  return { sdk, snapshot, request: captureTypeScriptApi7Request(request), virtualRoot, toolIdentity, type, handle, symbol, checker, program, project };
};
const produce = async state => ({ schemaVersion: 1, profile: TYPESCRIPT_API7_PROFILE, requestIdentity: api7Identity(state.request),
  ...await projectTypeScriptApi7Snapshot(state), lifecycle: { snapshotDisposed: true, apiClosed: true } });
const checked = async state => captureTypeScriptApi7Result(await produce(state), state);

if (mode === 'closed-request') {
  for (const change of [{ schemaVersion: 0 }, { profile: 'typescript-legacy' }, { compilerOptions: {} }, { fileSystem: { kind: 'layer' } },
    { queries: [] }, { files: [] }, { snapshotId: 1 }, { symbol: { id: 1 } }]) assert.throws(() => captureTypeScriptApi7Request({ ...makeRequest(), ...change }));
  const request = makeRequest(); request.files[0].extra = true; assert.throws(() => captureTypeScriptApi7Request(request));
  assert.equal(captureTypeScriptApi7Request(makeRequest()).profile, TYPESCRIPT_API7_PROFILE);
} else if (mode === 'passive-source-ownership') {
  const request = makeRequest(), captured = captureTypeScriptApi7Request(request);
  request.files[0].text = 'changed'; request.project.roots[0] = 'outside.ts'; request.queries[0].position = 500;
  assert.equal(captured.files[0].text, source); assert.equal(captured.project.roots[0], 'main.ts'); assert.equal(captured.queries[0].position, source.indexOf('State'));
  assert.ok(Object.isFrozen(captured.files[0])); let reads = 0;
  assert.throws(() => captureTypeScriptApi7Request({ ...makeRequest(), get files() { reads++; return []; } })); assert.equal(reads, 0);
  assert.throws(() => captureTypeScriptApi7Request(new Proxy(makeRequest(), { ownKeys() { reads++; return []; } }))); assert.equal(reads, 0);
} else if (mode === 'path-and-project-authority') {
  for (const name of ['../host.ts', '/host.ts', 'C:/host.ts', 'a/../host.ts', 'a\\host.ts', 'a//host.ts', 'AUX.ts', 'a./host.ts']) {
    const request = makeRequest(); request.files[0].path = name; request.project.roots = [name]; request.queries[0].path = name;
    assert.throws(() => captureTypeScriptApi7Request(request));
  }
  for (const name of ['MAIN.ts', 'main.ts/child.ts']) {
    const request = makeRequest(); request.files.push({ path: name, text: '' }); assert.throws(() => captureTypeScriptApi7Request(request));
  }
  const request = makeRequest(); request.files.push({ path: 'node_modules/pkg/index.d.ts', text: 'export type Flag = true;' });
  assert.equal(captureTypeScriptApi7Request(request).files.length, 2);
} else if (mode === 'query-authority') {
  for (const query of [{ path: 'outside.ts' }, { path: 'MAIN.ts' }, { position: source.length + 1 }, { position: -1 }, { configFile: 'main.ts' }, { handle: 1 }]) {
    const request = makeRequest(); Object.assign(request.queries[0], query); assert.throws(() => captureTypeScriptApi7Request(request));
  }
  const request = makeRequest(); request.queries.push({ ...request.queries[0] }); assert.throws(() => captureTypeScriptApi7Request(request));
} else if (mode === 'finite-string-consumer') {
  const result = await checked(world()), value = result.answers[0].type;
  assert.equal(value.status, 'exact-finite-string'); assert.equal(result.answers[0].symbol.name, 'State');
  const decoded = deserializeTypeIr(value.finiteString.graph, { contextKey: result.worldIdentity });
  const root = decoded.arena.getNode(value.finiteString.rootId);
  assert.equal(classifyTypeIr(decoded.arena, root).cardinality, 'many');
  assert.equal(containsTypeIr(decoded.arena, root, 'on'), true);
  assert.equal(containsTypeIr(decoded.arena, root, 'off'), true);
  assert.equal(containsTypeIr(decoded.arena, root, 'unknown'), false);
  assert.ok(Object.isFrozen(result.answers[0].type));
} else if (mode === 'aliases-overloads-and-docs') {
  const state = world(), alias = { ...state.symbol, name: 'ImportedState', flags: 1 };
  state.checker.getSymbolAtPosition = async () => alias;
  const signature = { getParameters: async () => [state.symbol], getTypeParameters: async () => [], getReturnType: async () => state.type,
    declaration: state.handle, hasRestParameter: false, isConstruct: false, isAbstract: false };
  state.checker.getSignaturesOfType = async (type, kind) => kind === 0 ? [signature, { ...signature, hasRestParameter: true }] : [];
  const result = await checked(state), answer = result.answers[0];
  assert.equal(answer.symbol.aliasTarget.symbol.name, 'State'); assert.equal(answer.symbol.native.documentation, 'The switch state.');
  assert.deepEqual(answer.symbol.native.jsDocTags, [{ name: 'example', text: 'on' }]);
  assert.equal(answer.signatures.length, 2); assert.equal(answer.signatures[1].native.hasRestParameter, true);
  assert.equal(answer.symbol.declarations[0].text, source.slice(0, source.indexOf('\n')));
} else if (mode === 'unsupported-and-budget') {
  const state = world(); state.checker.getTypeAtPosition = async () => ({ flags: flags.Object, isErrorType: () => false });
  assert.equal((await checked(state)).answers[0].type.status, 'native-only');
  state.checker.getTypeAtPosition = async () => ({ flags: flags.Object, isErrorType: () => true });
  assert.equal((await checked(state)).answers[0].type.status, 'unknown');
  state.checker.getTypeAtPosition = async () => union(Array.from({ length: 129 }, (_, index) => literal('v' + index)));
  await assert.rejects(checked(state), error => error.reason === 'type-union-bound');
} else if (mode === 'snapshot-and-source-identity') {
  const state = world(), first = await checked(state); state.snapshot.id = 2;
  const second = await checked(state); assert.notEqual(first.worldIdentity, second.worldIdentity);
  state.program.getSourceFile = async () => ({ text: source.replace('on', 'up') });
  await assert.rejects(checked(state), error => error.reason === 'native-source-bytes-mismatch');
  const foreign = world(); foreign.handle.path = 'C:/outside/private.ts';
  await assert.rejects(checked(foreign), error => error.reason === 'native-source-outside-request');
} else if (mode === 'configuration-closure') {
  const request = makeRequest(), config = '{"compilerOptions":{"noLib":true},"files":["main.ts"]}';
  request.files.push({ path: 'tsconfig.json', text: config }); request.project = { kind: 'configured', configFiles: ['tsconfig.json'] };
  assert.throws(() => captureTypeScriptApi7Request(request)); request.queries[0].configFile = 'tsconfig.json';
  const state = world(request); state.project.configFileName = virtualRoot + '/tsconfig.json';
  state.program.getConfigFileNames = async () => [virtualRoot + '/tsconfig.json']; state.program.getConfigSourceFile = async () => ({ text: config });
  assert.equal((await checked(state)).projects[0].configFiles[0].path, 'tsconfig.json');
  state.program.getConfigFileNames = async () => ['C:/host/tsconfig.json'];
  await assert.rejects(checked(state), error => error.reason === 'native-source-outside-request');
} else if (mode === 'compiler-capability-inventory') {
  const report = JSON.parse(await fs.readFile(new URL('../../docs/contracts/typescript-api7-capabilities.json', import.meta.url), 'utf8'));
  const calls = new Map();
  for (const file of report.ownerFiles) {
    const source = await fs.readFile(new URL('../../' + file, import.meta.url), 'utf8');
    assert.ok(source.length < 1024 * 1024);
    for (const [index, pattern] of report.patterns.entries()) for (const match of source.matchAll(new RegExp(pattern, 'g'))) {
      const call = index ? 'ast.' + match[1] : match[1] + '.' + match[2];
      if (!calls.has(call)) calls.set(call, new Set()); calls.get(call).add(file);
    }
  }
  assert.deepEqual([...calls.keys()].sort(), report.calls.map(item => item.call));
  for (const item of report.calls) {
    assert.deepEqual([...calls.get(item.call)].sort(), item.owners);
    assert.ok(item.status && (item.target || item.status.startsWith('unsupported-')));
  }
  assert.ok(report.calls.some(item => item.call === 'checker.signatureToString' && item.target === null));
  assert.ok(report.calls.some(item => item.call === 'ast.getStart' && item.status === 'unsupported-trivia-aware-token-start'));
} else {
  const state = world(), original = await produce(state);
  for (const mutate of [value => { value.lifecycle.apiClosed = false; }, value => { value.answers = []; },
    value => { value.answers[0].worldIdentity = 'ts-api7-world-v1:' + '0'.repeat(64); },
    value => { value.answers[0].symbol.declarations[0].text = 'forged'; },
    value => { value.answers[0].type.finiteString.graph.contextKey = 'other-world'; }, value => { value.extra = true; }]) {
    const result = structuredClone(original); mutate(result); assert.throws(() => captureTypeScriptApi7Result(result, state));
  }
  assert.throws(() => captureTypeScriptApi7Result(original, { ...state, toolIdentity: { ...toolIdentity, sdk: { ...toolIdentity.sdk, installId: 'e'.repeat(64) } } }));
}
console.log('TypeScript7.1 contract ' + mode + ' passed');
