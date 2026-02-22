#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { buildCLikeChunks } from '../../../src/lang/clike.js';
import { buildJavaChunks } from '../../../src/lang/java.js';
import { buildCSharpChunks } from '../../../src/lang/csharp.js';
import { buildKotlinChunks } from '../../../src/lang/kotlin.js';
import { buildSwiftChunks } from '../../../src/lang/swift.js';

applyTestEnv();

const root = process.cwd();
const fixture = (...parts) => path.join(root, 'tests', 'fixtures', 'languages', 'src', ...parts);

const hasChunk = (chunks, name, kind = null) => chunks.some((chunk) => (
  chunk?.name === name && (kind ? chunk?.kind === kind : true)
));

const cpp = await fs.readFile(fixture('cpp_advanced.cpp'), 'utf8');
const cppChunks = buildCLikeChunks(cpp, '.cpp');
assert.ok(hasChunk(cppChunks, 'Counter', 'ClassDeclaration'), 'missing C++ class boundary for Counter');
assert.ok(hasChunk(cppChunks, 'Counter.next', 'MethodDeclaration'), 'missing C++ method boundary for Counter.next');
assert.ok(hasChunk(cppChunks, 'addValues', 'FunctionDeclaration'), 'missing C++ function boundary for addValues');

const java = await fs.readFile(fixture('java_advanced.java'), 'utf8');
const javaChunks = buildJavaChunks(java);
assert.ok(hasChunk(javaChunks, 'Box', 'ClassDeclaration'), 'missing Java class boundary for Box');
assert.ok(hasChunk(javaChunks, 'Box.add', 'MethodDeclaration'), 'missing Java method boundary for Box.add');
assert.ok(hasChunk(javaChunks, 'Greeter', 'InterfaceDeclaration'), 'missing Java interface boundary for Greeter');

const csharp = await fs.readFile(fixture('csharp_advanced.cs'), 'utf8');
const csharpChunks = buildCSharpChunks(csharp);
assert.ok(hasChunk(csharpChunks, 'IRenderer', 'InterfaceDeclaration'), 'missing C# interface boundary for IRenderer');
assert.ok(hasChunk(csharpChunks, 'Widget', 'ClassDeclaration'), 'missing C# class boundary for Widget');
assert.ok(hasChunk(csharpChunks, 'Widget.Render', 'MethodDeclaration'), 'missing C# method boundary for Widget.Render');

const kotlin = await fs.readFile(fixture('kotlin_advanced.kt'), 'utf8');
const kotlinChunks = buildKotlinChunks(kotlin);
assert.ok(hasChunk(kotlinChunks, 'Widget', 'ClassDeclaration'), 'missing Kotlin class boundary for Widget');
assert.ok(hasChunk(kotlinChunks, 'Widget.render', 'MethodDeclaration'), 'missing Kotlin method boundary for Widget.render');
assert.ok(hasChunk(kotlinChunks, 'makeWidget', 'FunctionDeclaration'), 'missing Kotlin function boundary for makeWidget');

const swift = await fs.readFile(fixture('swift_advanced.swift'), 'utf8');
const swiftChunks = buildSwiftChunks(swift);
assert.ok(hasChunk(swiftChunks, 'Box', 'StructDeclaration'), 'missing Swift struct boundary for Box');
assert.ok(hasChunk(swiftChunks, 'Greeter', 'ProtocolDeclaration'), 'missing Swift protocol boundary for Greeter');
assert.ok(hasChunk(swiftChunks, 'SwiftGreeter.greet', 'MethodDeclaration'), 'missing Swift method boundary for SwiftGreeter.greet');

console.log('C-family/Java/C#/Kotlin/Swift chunk boundaries test passed');
