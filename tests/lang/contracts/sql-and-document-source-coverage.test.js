import assert from 'node:assert/strict';
import { buildSqlChunks, buildSqlRelations, collectSqlImports } from '../../../src/lang/sql.js';
import { splitSqlStatements } from '../../../src/lang/sql/scanner.js';
import { chunkXml } from '../../../src/index/chunking/formats/xml.js';
import { chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { chunkStarlark } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
for(const enabled of [false,true]) {
  const text='SELECT 1;\nCREATE TABLE IF NOT EXISTS "order items" (id INTEGER);\nCREATE TABLE IF NOT EXISTS beta (id INTEGER);';
  const chunks=buildSqlChunks(text,{dialect:'postgresql',treeSitter:{enabled,strict:enabled,chunkCache:false}});
  assert.ok(chunks.some(chunk=>chunk.name === 'order items'));assert.ok(chunks.some(chunk=>chunk.name === 'beta'));
  assert.ok(chunks.some(chunk=>text.slice(chunk.start,chunk.end).includes('SELECT 1')));
  const relations=buildSqlRelations(text,chunks,{dialect:'postgresql'});
  assert.ok(relations.exports.includes('order items'));assert.ok(relations.exports.includes('beta'));
}
for(const [dialect,text] of [['mysql','CREATE TABLE `part;one` (id INTEGER); CREATE TABLE beta (id INTEGER);'],
  ['postgresql','/* outer /* inner */ ; still outer */ CREATE TABLE alpha(id INTEGER); CREATE TABLE beta(id INTEGER);'],
  ['postgresql',"SELECT 'C:\\'; CREATE TABLE beta(id INTEGER);"]]) assert.equal(splitSqlStatements(text,{dialect}).length,2);
assert.deepEqual(collectSqlImports("SELECT $$\n\\i phantom.sql\n$$;\n\\i 'schema files/base.sql'\n\\i actual.sql\n"),['schema files/base.sql','actual.sql']);
const xml='<root marker="PREAMBLE">before<a>alpha</a><b>beta</b></root>';
const xmlChunks=chunkXml(xml,{});assert.equal(xmlChunks.map(chunk=>xml.slice(chunk.start,chunk.end)).join(''),xml);
const yaml='first: alpha\n---\n- orphan-before\n- orphan-after\n---\nsecond: beta\n';
const yamlChunks=chunkYaml(yaml,'fixture.yml',{yamlChunking:{mode:'top-level'}});
assert.ok(yamlChunks.some(chunk=>chunk.meta.documentIndex === 1 && yaml.slice(chunk.start,chunk.end).includes('orphan-before')));
assert.ok(yamlChunks.filter(chunk=>chunk.meta.documentIndex !== 1).every(chunk=>!yaml.slice(chunk.start,chunk.end).includes('orphan-before')));
assert.equal(yamlChunks.map(chunk=>yaml.slice(chunk.start,chunk.end)).join(''),yaml);
const star='def one():\n    red()\ndef two():\n    """\ndef ghost():\n    innocent()\n    """\n    blue()\nrule(name="real")\n';
const starChunks=chunkStarlark(star,{});
assert.deepEqual(starChunks.filter(chunk=>chunk.name !== 'preamble').map(chunk=>chunk.name),['def one','def two','rule']);
assert.ok(star.slice(starChunks.find(chunk=>chunk.name==='def one').start,starChunks.find(chunk=>chunk.name==='def one').end).includes('red()'));
console.log('SQL and document source ownership coverage passed');