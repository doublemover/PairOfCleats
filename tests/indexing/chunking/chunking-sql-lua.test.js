#!/usr/bin/env node
import { buildLuaChunks } from '../../../src/lang/lua.js';
import { buildSqlChunks } from '../../../src/lang/sql.js';

const luaText = "local function foo(a)\n  return a\nend -- done\n";
const luaChunks = buildLuaChunks(luaText) || [];
if (!luaChunks.some((chunk) => chunk.name === 'foo')) {
  console.error('Expected Lua chunk for foo when end has a trailing comment.');
  process.exit(1);
}

const mysqlSql = "DELIMITER $$\nCREATE FUNCTION add_one(x INT)\nRETURNS INT\nBEGIN\nSELECT x + 1;\nEND $$\nDELIMITER ;\nSELECT 1;";
const mysqlChunks = buildSqlChunks(mysqlSql, { dialect: 'mysql' }) || [];
if (mysqlChunks.length !== 2) {
  console.error(`Expected 2 MySQL statements, got ${mysqlChunks.length}.`);
  process.exit(1);
}
if (mysqlChunks[0].kind !== 'FunctionDeclaration') {
  console.error('Expected first MySQL chunk to be a FunctionDeclaration.');
  process.exit(1);
}

const pgSql = "CREATE FUNCTION test_fn() RETURNS text AS $$\nSELECT ';';\n$$ LANGUAGE sql;\nSELECT 2;";
const pgChunks = buildSqlChunks(pgSql, { dialect: 'postgres' }) || [];
if (pgChunks.length !== 2) {
  console.error(`Expected 2 Postgres statements, got ${pgChunks.length}.`);
  process.exit(1);
}

const standardSql = "SELECT 'It''s; fine' AS msg; SELECT 2;";
const standardChunks = buildSqlChunks(standardSql, { dialect: 'generic' }) || [];
if (standardChunks.length !== 2) {
  console.error(`Expected 2 statements with standard SQL escaping, got ${standardChunks.length}.`);
  process.exit(1);
}

const standardDoubleQuotes = "SELECT \"A\"\"B;C\" AS ident; SELECT 3;";
const doubleChunks = buildSqlChunks(standardDoubleQuotes, { dialect: 'generic' }) || [];
if (doubleChunks.length !== 2) {
  console.error(`Expected 2 statements with doubled identifier quotes, got ${doubleChunks.length}.`);
  process.exit(1);
}

console.log('sql/lua chunking test passed');
