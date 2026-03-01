#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildPhpChunks, buildPhpRelations } from '../../../src/lang/php.js';

applyTestEnv();

const phpText = [
  '<?php',
  'namespace App\\Runtime;',
  '',
  'use App\\Util\\Helper;',
  "require_once '../vendor/autoload.php';",
  '',
  'final class Service {',
  '  public function run(): void {',
  '    Helper::exec();',
  '  }',
  '}',
  '',
  'function boot(): void {',
  '  (new Service())->run();',
  '}'
].join('\n');

const chunks = buildPhpChunks(phpText) || [];
assert.equal(
  chunks.some((chunk) => chunk.kind === 'NamespaceDeclaration' && chunk.name === 'App\\Runtime'),
  true,
  'expected namespace declaration chunk'
);
assert.equal(
  chunks.some((chunk) => chunk.kind === 'ClassDeclaration' && chunk.name === 'Service'),
  true,
  'expected class declaration chunk'
);
assert.equal(
  chunks.some((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'boot'),
  true,
  'expected top-level function declaration chunk'
);

const relations = buildPhpRelations(phpText, chunks);
assert.equal(relations.imports.includes('App\\Util\\Helper'), true, 'expected use import relation');
assert.equal(relations.imports.includes('../vendor/autoload.php'), true, 'expected require import relation');
assert.equal(relations.exports.includes('App\\Runtime'), true, 'expected namespace export relation');
assert.equal(relations.exports.includes('Service'), true, 'expected class export relation');
assert.equal(relations.exports.includes('boot'), true, 'expected function export relation');

console.log('php namespace/class/function relation wiring test passed');
