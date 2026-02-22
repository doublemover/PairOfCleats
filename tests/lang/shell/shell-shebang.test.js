#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildShellChunks, buildShellRelations, collectShellImports } from '../../../src/lang/shell.js';

applyTestEnv();

const cases = [
  { label: 'sh', shebang: '#!/bin/sh' },
  { label: 'bash', shebang: '#!/usr/bin/env bash' },
  { label: 'zsh', shebang: '#!/usr/bin/env zsh' }
];

for (const testCase of cases) {
  const shellText = [
    testCase.shebang,
    'source ./env.sh',
    '. "./lib.sh"',
    'function build() {',
    '  helper_run "$1"',
    '}',
    'deploy() {',
    '  build "$1"',
    '}'
  ].join('\n');

  const chunks = buildShellChunks(shellText) || [];
  assert.equal(
    chunks.some((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'build'),
    true,
    `expected build function chunk for ${testCase.label}`
  );
  assert.equal(
    chunks.some((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'deploy'),
    true,
    `expected deploy function chunk for ${testCase.label}`
  );

  const imports = collectShellImports(shellText).slice().sort();
  assert.deepEqual(imports, ['./env.sh', './lib.sh'], `expected source imports for ${testCase.label}`);

  const relations = buildShellRelations(shellText, chunks);
  assert.equal(
    relations.calls.some(([caller, callee]) => caller === 'build' && callee === 'helper_run'),
    true,
    `expected helper call relation for ${testCase.label}`
  );
  assert.equal(
    relations.calls.some(([caller, callee]) => caller === 'deploy' && callee === 'build'),
    true,
    `expected nested call relation for ${testCase.label}`
  );
}

console.log('shell shebang/import/call relation test passed');
