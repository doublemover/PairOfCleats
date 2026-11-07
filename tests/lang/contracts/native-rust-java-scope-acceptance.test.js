import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { checkNativeDeclarations } from '../../helpers/native-declaration-acceptance.js';
import { buildRustChunks } from '../../../src/lang/rust.js';
import { buildJavaChunks } from '../../../src/lang/java.js';
import { buildCLikeChunks } from '../../../src/lang/clike.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { buildPythonChunksFromAst, getPythonAst, shutdownPythonAstPool } from '../../../src/lang/python.js';
applyTestEnv();
const entry = (name, kind, source) => ({ name, kind, ...(source ? { source } : {}) });
const rust = [
  'mod api {', ' pub fn ping() {}', ' fn outer() { fn helper() {} helper(); }',
  ' mod nested { pub fn deep() {} }', '}',
  'struct S;', 'impl S { fn run(&self) { fn helper() {} helper(); } }',
  'trait Service {', ' fn required(&self, value: i32) -> i32;', ' fn normal(&self) -> i32 { 1 }', '}',
  'extern "C" {', ' pub fn external(value: i32) -> i32;', ' fn another();', '}', 'fn ordinary() {}', ''
].join('\n');
const rr = await checkNativeDeclarations({ languageId: 'rust', ext: '.rs', text: rust, build: buildRustChunks, preparedKey: 'rustChunks', expected: [
  entry('api.ping', 'FunctionDeclaration'), entry('api.outer', 'FunctionDeclaration'), entry('api.outer.helper', 'FunctionDeclaration'),
  entry('api.nested.deep', 'FunctionDeclaration'), entry('S.run', 'MethodDeclaration'), entry('S.run.helper', 'FunctionDeclaration'),
  entry('Service.required', 'MethodDeclaration', 'fn required(&self, value: i32) -> i32;'),
  entry('Service.normal', 'MethodDeclaration'), entry('external', 'FunctionDeclaration', 'pub fn external(value: i32) -> i32;'),
  entry('another', 'FunctionDeclaration', 'fn another();'), entry('ordinary', 'FunctionDeclaration')
], absent: ['api.helper','S.helper'] });
assert.equal(rr.built.find(chunk => chunk.name === 'external').meta.bodyless, true);
assert.ok(rr.payloads.find(chunk => chunk.name === 'external').fieldTokens.signature.includes('value'));
const java = [
  'class First { class Inner { void same() {} } }', 'class Second { class Inner { void same() {} } }',
  'record Point(int x) { Point { if (x < 0) throw new IllegalArgumentException(); } }',
  'record Other(int x) { Other(int x) { this.x = x; } }',
  '@interface Label { String value(); int count() default 1; }', 'interface Face { int run(); }',
  'class Classic { Classic() {} void ordinary() {} }', ''
].join('\n');
await checkNativeDeclarations({ languageId: 'java', ext: '.java', text: java, build: buildJavaChunks, preparedKey: 'javaChunks', expected: [
  entry('First.Inner.same', 'MethodDeclaration'), entry('Second.Inner.same', 'MethodDeclaration'),
  entry('Point.Point', 'ConstructorDeclaration', 'Point { if (x < 0) throw new IllegalArgumentException(); }'),
  entry('Other.Other', 'ConstructorDeclaration'), entry('Label', 'AnnotationDeclaration'),
  entry('Label.value', 'MethodDeclaration', 'String value();'), entry('Label.count', 'MethodDeclaration', 'int count() default 1;'),
  entry('Face.run', 'MethodDeclaration'), entry('Classic.Classic', 'ConstructorDeclaration'), entry('Classic.ordinary', 'MethodDeclaration')
], absent: ['Inner.same','Point.x','Label.String'] });
const annotation = '@interface Standalone { String one() default "value"; int two(); }\n';
await checkNativeDeclarations({ languageId: 'java', ext: '.java', text: annotation, build: buildJavaChunks, preparedKey: 'javaChunks', expected: [
  entry('Standalone', 'AnnotationDeclaration', annotation.trim()),
  entry('Standalone.one', 'MethodDeclaration', 'String one() default "value";'),
  entry('Standalone.two', 'MethodDeclaration', 'int two();')
] });
for (const newline of ['\n', '\r\n']) {
  const declarations = [
    'template <typename T>\nT identity(T value) { return value; }',
    'template <typename T>\nstruct PrefixBox { T field; };',
    'template <>\nstruct PrefixBox<int> { int field; };',
    'template <typename T>\nclass ClassBox { public: T field; };'
  ].map(value => value.replaceAll('\n', newline));
  const source = declarations.join(newline + newline) + newline;
  const result = await checkNativeDeclarations({ languageId: 'cpp', ext: '.cpp', text: source,
    build: (value, options) => buildCLikeChunks(value, '.cpp', options), preparedKey: 'clikeChunks', expected: [
      entry('identity', 'FunctionDeclaration', declarations[0]), entry('PrefixBox', 'StructDeclaration', declarations[1]),
      entry('PrefixBox<int>', 'StructDeclaration', declarations[2]), entry('ClassBox', 'ClassDeclaration', declarations[3])
    ] });
  for (const chunk of result.built) {
    assert.ok(source.slice(chunk.start, chunk.end).startsWith('template'));
    assert.ok(chunk.meta.definitionStartLine > chunk.meta.startLine);
  }
  assert.ok(result.payloads.find(row => row.name === 'PrefixBox<int>').tokens.includes('int'));
}
const python = 'class C:\n def method(self):\n  def helper():\n   return 1\n  return helper()\n';
const nativeOptions = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false } };
const native = buildTreeSitterChunks({ text: python, languageId: 'python', options: nativeOptions });
let parsed;
try { parsed = await getPythonAst(python, null, { pythonAst: { workerCount: 1, maxWorkers: 1, taskTimeoutMs: 5000 },
  dataflow: false, controlFlow: false }); }
finally { await shutdownPythonAstPool(); }
const ast = parsed?.ast;
assert.ok(ast, 'real CPython AST control is required');
const cpython = buildPythonChunksFromAst(python, ast);
for (const chunks of [native, cpython]) {
  assert.equal(chunks.filter(chunk => chunk.name === 'C.method.helper' && chunk.kind === 'FunctionDeclaration').length, 1);
  assert.equal(chunks.some(chunk => chunk.name === 'C.helper'), false);
}
console.log('Native bodyless Rust callables, Java annotation/constructor declarations and lexical scope identities passed.');
