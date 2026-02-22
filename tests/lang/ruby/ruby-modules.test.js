#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports } from '../../../src/lang/ruby.js';

applyTestEnv();

const rubyText = [
  "require 'json'",
  "require_relative 'support/helper'",
  '',
  'module Core',
  '  class Runner',
  '    def execute(task)',
  '      Helper.run(task)',
  '    end',
  '  end',
  'end'
].join('\n');

const chunks = buildRubyChunks(rubyText) || [];
assert.equal(chunks.some((chunk) => chunk.kind === 'ModuleDeclaration' && chunk.name === 'Core'), true, 'expected module declaration chunk');
assert.equal(chunks.some((chunk) => chunk.kind === 'ClassDeclaration' && chunk.name === 'Runner'), true, 'expected class declaration chunk');
assert.equal(chunks.some((chunk) => chunk.kind === 'MethodDeclaration' && chunk.name === 'Runner.execute'), true, 'expected class-scoped method declaration chunk');

const imports = collectRubyImports(rubyText).slice().sort();
assert.deepEqual(imports, ['./support/helper', 'json'], 'expected require + require_relative imports');

const relations = buildRubyRelations(rubyText, chunks);
assert.equal(relations.exports.includes('Core'), true, 'expected module export relation');
assert.equal(relations.exports.includes('Runner'), true, 'expected class export relation');
assert.equal(
  relations.calls.some(([caller, callee]) => caller === 'Runner.execute' && (callee === 'Helper.run' || callee === 'run')),
  true,
  'expected relation call from class method to helper invocation'
);

console.log('ruby module/class relation wiring test passed');
