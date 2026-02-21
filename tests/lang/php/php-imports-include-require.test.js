#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildPhpRelations, collectPhpImports } from '../../../src/lang/php.js';

applyTestEnv();

const text = [
  '<?php',
  'use App\\Util\\Helper;',
  "include_once './bootstrap.php';",
  "require 'lib/runtime.php';",
  "require_once('../vendor/autoload.php');",
  'final class Service {',
  '  public function run(): void {',
  '    Helper::exec();',
  '  }',
  '}'
].join('\n');

const imports = collectPhpImports(text).slice().sort();
assert.deepEqual(
  imports,
  ['../vendor/autoload.php', './bootstrap.php', 'App\\Util\\Helper', 'lib/runtime.php'],
  'expected PHP collector to include use/include/require specifiers'
);

const relations = buildPhpRelations(text, null);
assert.deepEqual(
  relations.imports.slice().sort(),
  imports,
  'expected PHP relation imports to mirror collector output'
);

console.log('php include/require import extraction test passed');
