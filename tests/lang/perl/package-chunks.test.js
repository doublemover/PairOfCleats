#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildPerlRelations } from '../../../src/lang/perl.js';
import { buildLanguageContext } from '../../../src/index/language-registry.js';

applyTestEnv();

const perlText = [
  'package App::Worker;',
  'use strict;',
  'require Foo::Bar;',
  '',
  'sub run {',
  '  Foo::Bar::execute();',
  "  die 'boom';",
  '}',
  '',
  '1;'
].join('\n');

const { context } = await buildLanguageContext({ ext: '.pl', relPath: 'worker.pl', mode: 'code', text: perlText,
  options: { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false } } });
const chunks = context.perlChunks || [];
assert.equal(
  chunks.some((chunk) => chunk.kind === 'PackageDeclaration' && chunk.name === 'App::Worker'),
  true,
  'expected package declaration chunk'
);
assert.equal(
  chunks.some((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'run'),
  true,
  'expected sub declaration chunk'
);

const relations = buildPerlRelations(perlText, chunks);
assert.equal(relations.imports.includes('strict'), true, 'expected use import relation');
assert.equal(relations.imports.includes('Foo::Bar'), true, 'expected require import relation');
assert.equal(relations.exports.includes('run'), true, 'expected function export relation');
assert.equal(
  relations.calls.some(([caller, callee]) => caller === 'run' && callee === 'Foo.Bar.execute'),
  true,
  'expected relation call for required module invocation'
);

console.log('perl package/sub relation wiring test passed');
