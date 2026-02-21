#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectRubyImports } from '../../../src/lang/ruby.js';
import { collectLuaImports } from '../../../src/lang/lua.js';
import { collectPerlImports } from '../../../src/lang/perl.js';
import { collectShellImports } from '../../../src/lang/shell.js';

applyTestEnv();

const python = collectPythonImports([
  'import requests',
  'from .pkg import loader as load',
  'from core.utils import parse'
].join('\n'));
assert.deepEqual(
  python.imports,
  ['.pkg', 'core.utils', 'requests'],
  'python import collector should preserve package-relative and absolute module imports'
);

const rubyImports = collectRubyImports([
  "require 'json'",
  "require_relative 'helpers/tooling'"
].join('\n')).sort();
assert.deepEqual(
  rubyImports,
  ['./helpers/tooling', 'json'],
  'ruby import collector should normalize require_relative paths'
);

const luaImports = collectLuaImports([
  "local util = require('app.util')",
  "require \"core.runtime\""
].join('\n')).sort();
assert.deepEqual(luaImports, ['app.util', 'core.runtime'], 'lua import collector should track require module specs');

const perlImports = collectPerlImports([
  'use App::Core::Util;',
  'require App::Core::Runtime;'
].join('\n')).sort();
assert.deepEqual(
  perlImports,
  ['App::Core::Runtime', 'App::Core::Util'],
  'perl import collector should support use/require package imports'
);

const shellImports = collectShellImports([
  'source ./lib/helpers.sh',
  '. ../shared/common.sh'
].join('\n')).sort();
assert.deepEqual(
  shellImports,
  ['../shared/common.sh', './lib/helpers.sh'],
  'shell import collector should track source and dot-include forms'
);

console.log('multi-language import collector contract test passed');
