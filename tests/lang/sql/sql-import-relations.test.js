#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports } from '../../../src/lang/sql.js';

applyTestEnv();

const sqlText = [
  '\\i schema/base.sql',
  '\\ir patches/upgrade.sql',
  'SOURCE migrations/seed.sql;',
  '@@reports/common.sql',
  'CREATE TABLE users(id INT PRIMARY KEY);'
].join('\n');

const imports = collectSqlImports(sqlText).sort();
assert.deepEqual(
  imports,
  ['migrations/seed.sql', 'patches/upgrade.sql', 'reports/common.sql', 'schema/base.sql'],
  'expected SQL include/source directives to be collected as imports'
);

const chunks = buildSqlChunks(sqlText) || [];
const relations = buildSqlRelations(sqlText, chunks, { dialect: 'postgres' });
assert.deepEqual(
  (relations.imports || []).slice().sort(),
  imports,
  'expected SQL relations imports to include collected SQL directives'
);
assert.deepEqual(
  (relations.importLinks || []).slice().sort(),
  imports,
  'expected SQL relations importLinks to mirror SQL directive imports'
);

console.log('sql import relations test passed');
