import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { checkNativeDeclarations } from '../../helpers/native-declaration-acceptance.js';
import { buildGoChunks } from '../../../src/lang/go.js';
import { buildSwiftChunks } from '../../../src/lang/swift.js';
import { buildKotlinChunks } from '../../../src/lang/kotlin.js';
applyTestEnv();
const entry = (name, kind, contains, count) => ({ name, kind, contains, ...(count ? { count } : {}) });
for (const kinds of [
  ['First struct { X int }', 'Second interface { Run() }'],
  ['First interface { Run() struct { X int } }', 'Second struct { X int }']
]) {
  const text = 'package p\n// Group documentation.\ntype (\n ' + kinds.join('\n ') + '\n Alias = First\n Collection []struct { X int }\n)\n'
    + '// Standalone documentation.\ntype Single struct { X int }\ntype Renamed = Single\nfunc Run() {}\n';
  const result = await checkNativeDeclarations({ languageId: 'go', ext: '.go', text, build: buildGoChunks, preparedKey: 'goChunks', expected: [
    entry('First', kinds[0].includes('interface') ? 'InterfaceDeclaration' : 'StructDeclaration'),
    entry('Second', kinds[1].includes('interface') ? 'InterfaceDeclaration' : 'StructDeclaration'),
    entry('Alias', 'TypeAlias'), entry('Collection', 'TypeDeclaration'), entry('Single', 'StructDeclaration', 'type Single'),
    entry('Renamed', 'TypeAlias', 'type Renamed = Single'), entry('Run', 'FunctionDeclaration')
  ] });
  assert.equal(result.built.filter(chunk => chunk.name === 'First').length, 1);
  assert.equal(result.built.filter(chunk => chunk.name === 'Single').length, 1);
  for (const declaration of kinds) {
    const chunk = result.built.find(row => row.name === declaration.split(' ')[0]);
    assert.equal(chunk.end, text.indexOf(declaration) + declaration.length, 'each group member stops at its own body');
  }
  const single = result.built.find(chunk => chunk.name === 'Single');
  assert.equal(text.slice(single.start, single.end), 'type Single struct { X int }');
  assert.ok(result.built.find(chunk => chunk.name === 'Single').meta.docstring.includes('Standalone documentation'));
  assert.ok(!result.built.some(chunk => chunk.meta.groupName || chunk.name === 'type'));
}
const swiftLines = [
  'struct Plain {}', 'public struct Public {}',
  '@available(*, deprecated, message: "' + 'long attribute '.repeat(12) + '") public struct Attributed {}',
  'enum Mode { case one }', 'public enum PublicMode { case two }', '@available(*, deprecated) enum AttributedMode { case one }',
  'actor Worker {}', 'public actor PublicWorker {}', '@available(*, deprecated) actor AttributedWorker {}',
  'class Box {}', 'public class PublicBox {}', '@available(*, deprecated) class AttributedBox {}',
  'protocol Face {}', 'public protocol PublicFace {}', '@available(*, deprecated) protocol AttributedFace {}',
  'extension Box {}', 'extension Array where Element: Equatable {}', '@available(*, deprecated) extension AttributedBox {}', ''
];
const swift = swiftLines.join('\n');
const swiftResult = await checkNativeDeclarations({ languageId: 'swift', ext: '.swift', text: swift, build: buildSwiftChunks, preparedKey: 'swiftChunks', expected: [
  ...['Plain','Public','Attributed'].map(name => entry(name, 'StructDeclaration')),
  ...['Mode','PublicMode','AttributedMode'].map(name => entry(name, 'EnumDeclaration')),
  ...['Worker','PublicWorker','AttributedWorker'].map(name => entry(name, 'ActorDeclaration')),
  ...['Box','PublicBox','AttributedBox'].map(name => entry(name, 'ClassDeclaration')),
  ...['Face','PublicFace','AttributedFace'].map(name => entry(name, 'ProtocolDeclaration')),
  entry('Box', 'ExtensionDeclaration'), entry('Array', 'ExtensionDeclaration', 'where Element: Equatable'), entry('AttributedBox', 'ExtensionDeclaration')
] });
assert.deepEqual(swiftResult.built.map(chunk => swift.slice(chunk.start,chunk.end)), swiftLines.filter(Boolean),
  'modified/attributed native Swift declarations own exactly their complete source spellings');
const kotlin = [
  'annotation class Mark', '@Mark public enum class Color { RED, BLUE;', ' fun member(): Int { return 1 }', '}',
  'enum class Empty {}', 'interface Face {', ' fun required(): String', '}',
  'open class Base {', ' constructor() {}', '}', 'class Box : Base {',
  ' constructor() : super() {}', ' constructor(value: Int) : this() { println(value) }',
  ' constructor(renamed: Int, other: String) : this(renamed) { println(other) }',
  ' fun normal() {}', '}', ''
].join('\n');
const kt = await checkNativeDeclarations({ languageId: 'kotlin', ext: '.kt', text: kotlin, build: buildKotlinChunks, preparedKey: 'kotlinChunks', expected: [
  entry('Color', 'EnumDeclaration', '@Mark'), entry('Color.member', 'MethodDeclaration'), entry('Empty', 'EnumDeclaration'),
  entry('Face', 'InterfaceDeclaration'), entry('Face.required', 'MethodDeclaration'), entry('Box', 'ClassDeclaration'),
  entry('Box.constructor', 'ConstructorDeclaration', 'constructor', 3), entry('Box.normal', 'MethodDeclaration')
], absent: ['RED','BLUE','Box.value','Box.renamed','Box.other'] });
assert.equal(new Set(kt.built.filter(chunk => chunk.name === 'Box.constructor').map(chunk => chunk.meta.signature)).size, 3);
assert.deepEqual(kt.built.filter(chunk => chunk.name === 'Box.constructor').map(chunk => kotlin.slice(chunk.start,chunk.end)), [
  'constructor() : super() {}', 'constructor(value: Int) : this() { println(value) }',
  'constructor(renamed: Int, other: String) : this(renamed) { println(other) }'
]);
console.log('Native grouped Go, Swift grammar-token kinds and Kotlin enum/constructor identities passed.');
