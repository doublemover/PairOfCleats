import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { checkNativeDeclarations } from '../../helpers/native-declaration-acceptance.js';
import { buildCLikeChunks } from '../../../src/lang/clike.js';
applyTestEnv();
const entry = (name, kind, source, count) => ({ name, kind, ...(source ? { source } : {}), ...(count ? { count } : {}) });
const c = [
  'typedef int Count;', 'struct Item { int x; };', 'union Choice { int x; float y; };', 'enum Mode { FIRST, SECOND };',
  'struct Future;', 'union FutureChoice;', 'enum FutureMode;',
  'typedef struct { int x; } Anonymous;',
  'struct Container { struct Item member; union Choice choice; };',
  'Count getCount(void) { return 1; }', 'Count otherCount(void) { return 2; }',
  'struct Item *pointer(struct Item *item) { struct Item local; local.x = item->x; return item; }',
  'int plain(void) { return 1; }', 'int (*nested(void))(int) { return 0; }', ''
].join('\n');
const cr = await checkNativeDeclarations({ languageId: 'clike', ext: '.c', text: c,
  build: (text, options) => buildCLikeChunks(text, '.c', options), preparedKey: 'clikeChunks', expected: [
    ...[['Item','StructDeclaration','struct Item { int x; };'], ['Choice','UnionDeclaration','union Choice { int x; float y; };'],
      ['Mode','EnumDeclaration','enum Mode { FIRST, SECOND };'], ['Future','StructDeclaration','struct Future;'],
      ['FutureChoice','UnionDeclaration','union FutureChoice;'], ['FutureMode','EnumDeclaration','enum FutureMode;'],
      ['Anonymous','StructDeclaration','typedef struct { int x; } Anonymous;']].map(row => entry(...row)),
    ...['getCount','otherCount','pointer','plain','nested'].map(name => entry(name, 'FunctionDeclaration'))
  ], absent: ['Count','pointer.Item','Container.Item','callback'] });
assert.equal(cr.built.filter(chunk => chunk.name === 'Item').length, 1);
assert.ok(cr.built.find(chunk => chunk.name === 'nested').meta.signature.startsWith('int (*nested(void))'));
const objc = [
  '@protocol Face', '- (int)add:(int)x to:(int)y;', '- (int)plain;', '@end',
  '@interface Box <Face>', '- (int)add:(int)x to:(int)y;', '- (int)add:(int)x from:(int)y;', '+ (int)plain;', '@end',
  '@implementation Box', '- (int)add:(int)x to:(int)y { return x+y; }', '- (int)add:(int)x from:(int)y { return x-y; }',
  '+ (int)plain { return 1; }', '@end',
  '@interface Box (Extra)', '- (int)unary;', '@end', '@implementation Box (Extra)', '- (int)unary { return 2; }', '@end',
  '@implementation Other', '- (int)add:(int)x to:(int)y { return x+y; }', '@end', 'int ordinary(void) { return 1; }', ''
].join('\n');
const or = await checkNativeDeclarations({ languageId: 'objc', ext: '.m', text: objc,
  build: (text, options) => buildCLikeChunks(text, '.m', options), preparedKey: 'clikeChunks', expected: [
    entry('Face.-add:to:', 'MethodDeclaration'), entry('Face.-plain', 'MethodDeclaration'),
    entry('Box.-add:to:', 'MethodDeclaration', null, 2), entry('Box.-add:from:', 'MethodDeclaration', null, 2),
    entry('Box.+plain', 'MethodDeclaration', null, 2), entry('Box(Extra).-unary', 'MethodDeclaration', null, 2),
    entry('Other.-add:to:', 'MethodDeclaration'), entry('ordinary', 'FunctionDeclaration')
  ], absent: ['Box.add','add','Box.x','Box.y','Box.int'] });
assert.notEqual(or.built.find(chunk => chunk.name === 'Box.-add:to:').meta.signature,
  or.built.find(chunk => chunk.name === 'Box.-add:from:').meta.signature);
const cpp = [
  'namespace outer { namespace inner { class A { public: int same(); }; class B { public: int same(); };',
  'int A::same() { return 1; }', 'int B::same() { return 2; }', 'int free_function() { return 3; }', '}}',
  'class Box { public:', ' Box() {}', ' ~Box() {}', ' int operator()() const { return 1; }',
  ' int operator()(int value) const { return value; }',
  ' int operator[](int i) const { return i; }', ' operator bool() const { return true; }',
  ' bool operator==(const Box &other) const { return true; }', ' int plain() { return 1; }', '};',
  'template <typename T> class Holder { public: T get(); };',
  'template <typename T> T Holder<T>::get() { return T(); }',
  'int *pointer() { return 0; }', 'int (*factory())(int) { return 0; }', ''
].join('\n');
await checkNativeDeclarations({ languageId: 'cpp', ext: '.cpp', text: cpp,
  build: (text, options) => buildCLikeChunks(text, '.cpp', options), preparedKey: 'clikeChunks', expected: [
    entry('outer.inner.A.same', 'MethodDeclaration'), entry('outer.inner.B.same', 'MethodDeclaration'),
    entry('outer.inner.A.same', 'FunctionDeclaration'), entry('outer.inner.B.same', 'FunctionDeclaration'),
    entry('outer.inner.free_function', 'FunctionDeclaration'), ...['Box','~Box','operator()','operator[]','operator bool','operator==','plain']
      .map(name => entry('Box.' + name, 'MethodDeclaration', null, name === 'operator()' ? 2 : 1)),
    entry('Holder<T>.get', 'FunctionDeclaration'), entry('pointer', 'FunctionDeclaration'), entry('factory', 'FunctionDeclaration')
  ], absent: ['same','Box.operator','Box.bool','inner.deep'] });
console.log('C declaration owners, Objective-C selector/category owners and complete C++ qualified/operator names passed.');
