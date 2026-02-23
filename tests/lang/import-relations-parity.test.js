#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildPhpRelations, collectPhpImports } from '../../src/lang/php.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports } from '../../src/lang/sql.js';

applyTestEnv();

const cases = [
  {
    name: 'php include/require import extraction',
    text: [
      '<?php',
      'use App\\Util\\Helper;',
      'UsE App\\Util\\Logger as LogAlias;',
      "include_once './bootstrap.php';",
      "INCLUDE './legacy.php';",
      "require 'lib/runtime.php';",
      "REQUIRE '../legacy/runtime2.php';",
      "require_once('../vendor/autoload.php');",
      'final class Service {',
      '  public function run(): void {',
      '    Helper::exec();',
      '  }',
      '}'
    ].join('\n'),
    expectedImports: [
      '../legacy/runtime2.php',
      '../vendor/autoload.php',
      './bootstrap.php',
      './legacy.php',
      'App\\Util\\Helper',
      'App\\Util\\Logger',
      'lib/runtime.php'
    ],
    collect: (text) => collectPhpImports(text).slice().sort(),
    buildRelations: (text) => buildPhpRelations(text, null),
    verifyExtra: () => {}
  },
  {
    name: 'sql import directives parity',
    text: [
      '\\i schema/base.sql',
      '\\ir patches/upgrade.sql',
      'SOURCE migrations/seed.sql;',
      '@@reports/common.sql',
      '/*',
      '\\i ignored/commented.sql',
      'SOURCE ignored/commented-source.sql;',
      '*/',
      'CREATE TABLE users(id INT PRIMARY KEY);'
    ].join('\n'),
    expectedImports: ['migrations/seed.sql', 'patches/upgrade.sql', 'reports/common.sql', 'schema/base.sql'],
    collect: (text) => collectSqlImports(text).sort(),
    buildRelations: (text) => {
      const chunks = buildSqlChunks(text) || [];
      return buildSqlRelations(text, chunks, { dialect: 'postgres' });
    },
    verifyExtra: (relations, expectedImports) => {
      assert.deepEqual(
        (relations.importLinks || []).slice().sort(),
        expectedImports,
        'expected SQL relations importLinks to mirror SQL directive imports'
      );
    }
  }
];

for (const testCase of cases) {
  const expectedImports = testCase.expectedImports.slice().sort();
  const imports = testCase.collect(testCase.text);
  assert.deepEqual(
    imports,
    expectedImports,
    `expected collected imports for ${testCase.name}`
  );

  const relations = testCase.buildRelations(testCase.text);
  assert.deepEqual(
    (relations.imports || []).slice().sort(),
    imports,
    `expected relation imports to mirror collector output for ${testCase.name}`
  );
  testCase.verifyExtra(relations, expectedImports);
}

console.log('lang import relations parity test passed');
