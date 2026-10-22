import assert from 'node:assert/strict';
import { buildSqlChunks, buildSqlRelations, collectSqlImports } from '../../../src/lang/sql.js';
import { splitSqlStatements, stripSqlComments } from '../../../src/lang/sql/scanner.js';

const fallback = { treeSitter: { enabled: false }, dialect: 'postgresql' };
for (const newline of ['\n', '\r\n', '\r']) {
  const text = '-- first comment' + newline + 'CREATE TABLE alpha(id INTEGER);' + newline
    + '-- second comment' + newline + 'CREATE TABLE beta(id INTEGER);';
  const statements = splitSqlStatements(text, fallback);
  assert.equal(statements.length, 2, `${JSON.stringify(newline)} terminates SQL line comments`);
  const chunks = buildSqlChunks(text, fallback);
  assert.deepEqual(chunks.map(chunk => chunk.name), ['alpha', 'beta']);
  assert.equal(chunks.map(chunk => text.slice(chunk.start, chunk.end)).join(''), text);
  assert.equal(chunks[0].meta.signature, 'CREATE TABLE alpha(id INTEGER);');
  assert.equal(chunks[1].meta.signature, 'CREATE TABLE beta(id INTEGER);');
  const relations = buildSqlRelations(text, chunks, fallback);
  assert.deepEqual(relations.exports, ['alpha', 'beta']);
  const imports = '-- ignored include' + newline + "\\i 'schema files/one.sql'" + newline
    + 'SELECT $$' + newline + '\\i phantom.sql' + newline + '$$;' + newline + '\\ir two.sql';
  assert.deepEqual(collectSqlImports(imports, fallback), ['schema files/one.sql', 'two.sql']);
  assert.deepEqual(buildSqlRelations(imports, [], fallback).importLinks, ['schema files/one.sql', 'two.sql']);
  assert.equal(stripSqlComments('-- ignore' + newline + 'SELECT 1;', fallback), newline + 'SELECT 1;');

  const delimited = ['DELIMITER //', 'SELECT 1;//', 'SELECT 2;//', 'DELIMITER ;', 'SELECT 3;'].join(newline);
  assert.deepEqual(splitSqlStatements(delimited, { dialect: 'mysql' }).map(span => delimited.slice(span.start, span.end).trim()),
    ['SELECT 1;//', 'SELECT 2;//', 'SELECT 3;'], 'client delimiter lines stop at each physical line boundary');
}

// In escape-string mode the quote after a backslash belongs to the string.
// Its next physical line cannot impersonate an include directive.
const escaped = "SELECT 'prefix\\'\n\\i phantom.sql\n';\n\\i actual.sql";
assert.deepEqual(collectSqlImports(escaped, { dialect: 'mysql' }), ['actual.sql']);
assert.deepEqual(buildSqlRelations(escaped, [], { dialect: 'mysql' }).imports, ['actual.sql'],
  'relation admission passes the effective dialect to its shared scanner');
assert.deepEqual(buildSqlRelations(escaped, [], { dialect: 'postgresql', standardConformingStrings: false }).imports,
  ['actual.sql'], 'relation admission preserves the explicit legacy PostgreSQL lexical mode');
const legacy = "SELECT 'prefix\\'; still string'; CREATE TABLE after_escape(id INTEGER);";
const legacyOptions = { ...fallback, standardConformingStrings: false };
assert.equal(splitSqlStatements(legacy, legacyOptions).length, 2);
const legacyChunks = buildSqlChunks(legacy, legacyOptions);
assert.equal(legacyChunks.length, 2, 'chunk segmentation uses the same explicit string mode as the scanner');
assert.equal(legacyChunks[1].name, 'after_escape');
assert.equal(legacyChunks.map(chunk => legacy.slice(chunk.start, chunk.end)).join(''), legacy);

const commentMode = '/* outer /* inner */ CREATE TABLE visible_in_mysql(id INTEGER);';
assert.equal(buildSqlChunks(commentMode, { ...fallback, dialect: 'mysql' })[0].name, 'visible_in_mysql',
  'fallback classification agrees with the effective non-nesting comment scanner');
assert.notEqual(buildSqlChunks(commentMode, fallback)[0].name, 'visible_in_mysql',
  'an unfinished PostgreSQL nested comment cannot expose a contained declaration');
const quotedComment = "SELECT 'prefix\\' -- literal, not comment\nrest'; -- trailing\rSELECT 2;";
assert.equal(stripSqlComments(quotedComment, { dialect: 'mysql' }),
  "SELECT 'prefix\\' -- literal, not comment\nrest'; \rSELECT 2;",
  'comment removal shares lexical string ownership and CR termination');
console.log('SQL lexical option handoffs and physical line boundaries test passed');
