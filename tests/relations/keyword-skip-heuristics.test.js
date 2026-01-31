#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildCLikeChunks, buildCLikeRelations } from '../../src/lang/clike.js';
import { buildGoChunks, buildGoRelations } from '../../src/lang/go.js';
import { buildJavaChunks, buildJavaRelations } from '../../src/lang/java.js';
import { buildKotlinChunks, buildKotlinRelations } from '../../src/lang/kotlin.js';
import { buildCSharpChunks, buildCSharpRelations } from '../../src/lang/csharp.js';
import { buildPhpChunks, buildPhpRelations } from '../../src/lang/php.js';
import { buildRubyChunks, buildRubyRelations } from '../../src/lang/ruby.js';
import { buildLuaChunks, buildLuaRelations } from '../../src/lang/lua.js';
import { buildPerlChunks, buildPerlRelations } from '../../src/lang/perl.js';
import { buildShellChunks, buildShellRelations } from '../../src/lang/shell.js';
import { buildTypeScriptRelations } from '../../src/lang/typescript/relations.js';
import { buildTypeScriptChunksHeuristic } from '../../src/lang/typescript/chunks-heuristic.js';

const extractCallNames = (calls) => {
  const names = new Set();
  for (const entry of calls || []) {
    if (Array.isArray(entry)) {
      if (entry[1]) names.add(entry[1]);
      continue;
    }
    if (entry?.callee) names.add(entry.callee);
  }
  return names;
};

const cases = [
  {
    name: 'clike',
    text: [
      'void demo() {',
      '  if (ready) { foo(); obj.bar(); }',
      '  for (int i=0; i<1; i++) { baz(); }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildCLikeChunks(text, '.c'),
    buildRelations: (text, chunks) => buildCLikeRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'while', 'switch', 'return']
  },
  {
    name: 'go',
    text: [
      'package main',
      'func demo() {',
      '  if ready { foo(); obj.bar() }',
      '  for i := 0; i < 1; i++ { baz() }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildGoChunks(text),
    buildRelations: (text, chunks) => buildGoRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'java',
    text: [
      'class Demo {',
      '  void demo() {',
      '    if (ready) { foo(); obj.bar(); }',
      '    for (int i=0; i<1; i++) { baz(); }',
      '  }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildJavaChunks(text),
    buildRelations: (text, chunks) => buildJavaRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'kotlin',
    text: [
      'class Demo {',
      '  fun demo() {',
      '    if (ready) { foo(); obj.bar() }',
      '    for (i in 0..1) { baz() }',
      '  }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildKotlinChunks(text),
    buildRelations: (text, chunks) => buildKotlinRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'when', 'return']
  },
  {
    name: 'csharp',
    text: [
      'class Demo {',
      '  void demo() {',
      '    if (ready) { foo(); obj.bar(); }',
      '    for (int i=0; i<1; i++) { baz(); }',
      '  }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildCSharpChunks(text),
    buildRelations: (text, chunks) => buildCSharpRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'php',
    text: '<?php\nfunction demo() { if ($ready) { foo(); $obj->bar(); } foreach ($items as $item) { baz(); } }',
    buildChunks: (text) => buildPhpChunks(text),
    buildRelations: (text, chunks) => buildPhpRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'foreach', 'return']
  },
  {
    name: 'ruby',
    text: 'def demo\n  if ready\n    foo()\n    obj.bar()\n  end\n  for i in [1]\n    baz()\n  end\nend',
    buildChunks: (text) => buildRubyChunks(text),
    buildRelations: (text, chunks) => buildRubyRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'lua',
    text: 'local function demo()\n  if ready then\n    foo()\n    obj:bar()\n  end\n  for i=1,1 do\n    baz()\n  end\nend',
    buildChunks: (text) => buildLuaChunks(text),
    buildRelations: (text, chunks) => buildLuaRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'perl',
    text: 'sub demo { if ($ready) { foo(); $obj->bar(); } for (my $i=0; $i<1; $i++) { baz(); } }',
    buildChunks: (text) => buildPerlChunks(text),
    buildRelations: (text, chunks) => buildPerlRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'shell',
    text: 'demo() {\n  if true; then\n    foo\n    bar\n  fi\n  for i in 1; do\n    baz\n  done\n}',
    buildChunks: (text) => buildShellChunks(text),
    buildRelations: (text, chunks) => buildShellRelations(text, chunks),
    expectCalls: ['foo', 'bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  },
  {
    name: 'typescript',
    text: [
      'function demo() {',
      '  if (ready) { foo(); obj.bar(); }',
      '  for (let i = 0; i < 1; i++) { baz(); }',
      '}'
    ].join('\n'),
    buildChunks: (text) => buildTypeScriptChunksHeuristic(text),
    buildRelations: (text, chunks) => buildTypeScriptRelations(text, chunks),
    expectCalls: ['foo', 'obj.bar', 'baz'],
    skipCalls: ['if', 'for', 'return']
  }
];

for (const testCase of cases) {
  const chunks = testCase.buildChunks(testCase.text);
  assert.ok(Array.isArray(chunks) && chunks.length > 0, `${testCase.name}: expected chunks`);
  const relations = testCase.buildRelations(testCase.text, chunks);
  const callNames = extractCallNames(relations?.calls);
  for (const name of testCase.expectCalls) {
    assert.ok(callNames.has(name), `${testCase.name}: expected call ${name}`);
  }
  for (const name of testCase.skipCalls) {
    assert.ok(!callNames.has(name), `${testCase.name}: keyword ${name} should be skipped`);
  }
}

console.log('keyword skip heuristics ok');
