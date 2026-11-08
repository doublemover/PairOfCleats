import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSqlChunks,buildSqlRelations,collectSqlImports } from '../../../src/lang/sql.js';
import { splitSqlStatements } from '../../../src/lang/sql/scanner.js';
import { chunkXml } from '../../../src/index/chunking/formats/xml.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { readChunkContent } from '../../../src/shared/embedded-content.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { createProcessChunksFixtureContext,processFixtureChunks } from '../../indexing/file-processor/process-chunks-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const qualified=[['public.users','public.users',['public','users']],['public . users','public.users',['public','users']],
  ['public. users','public.users',['public','users']],['public /*note*/ . "odd.name"','public."odd.name"',['public','odd.name']],
  ['"public.users"','"public.users"',['public.users']],['Public.Mixed','public.mixed',['public','mixed']],
  ['"Public"."Mixed"','Public.Mixed',['Public','Mixed']]];
for(const [sourceName,name,segments] of qualified) {
  const text='SELECT 1;\nCREATE TABLE '+sourceName+' (id integer);\n';
  const options={treeSitter:{enabled:false},dialect:'postgresql',sql:{dialect:'postgresql'}};
  const chunks=buildSqlChunks(text,options),decl=chunks.find(chunk=>chunk.kind==='TableDeclaration');
  assert.ok(decl,sourceName);assert.equal(decl.name,name);
  assert.deepEqual(decl.meta.sqlIdentifierSegments.map(segment=>segment.value),segments);
  for(const segment of decl.meta.sqlIdentifierSegments) assert.ok(text.slice(segment.start,segment.end).length>0);
  assert.equal(chunks.map(chunk=>readChunkContent(text,chunk)).join(''),text);
  assert.deepEqual(buildSqlRelations(text,chunks,options).exports,[name]);
  const registered=await prepareRegisteredLanguage({text,ext:'.sql',options});
  assert.ok(registered.relations.exports.includes(name),sourceName);
}
for(const [dialect,text,expected] of [
  ['mysql','CREATE TABLE `part;one` (id INTEGER); CREATE TABLE beta (id INTEGER);',['part;one','beta']],
  ['postgresql','/* outer /* inner */ ; still outer */ CREATE TABLE alpha(id INTEGER); CREATE TABLE beta(id INTEGER);',['alpha','beta']],
  ['postgresql',"SELECT 'C:\\'; CREATE TABLE beta(id INTEGER);",['beta']],
  ['postgresql',"SELECT E'C:\\\\;quote'; CREATE TABLE beta(id INTEGER);",['beta']],
  ['postgresql','SELECT $tag$ ; \\i phantom.sql $tag$; CREATE TABLE beta(id INTEGER);',['beta']]
]) {
  const options={dialect,treeSitter:{enabled:false}};
  const chunks=buildSqlChunks(text,options);
  assert.equal(chunks.map(chunk=>readChunkContent(text,chunk)).join(''),text);
  assert.deepEqual(buildSqlRelations(text,chunks,options).exports,expected);
}
for(const newline of ['\n','\r\n','\r']) {
  const text=['DELIMITER //','CREATE TABLE alpha(id INTEGER);//','CREATE TABLE beta(id INTEGER);//','DELIMITER ;','SELECT 1;',''].join(newline);
  assert.equal(splitSqlStatements(text,{dialect:'mysql'}).length,3);
  const chunks=buildSqlChunks(text,{dialect:'mysql',treeSitter:{enabled:false}});
  assert.equal(chunks.map(chunk=>readChunkContent(text,chunk)).join(''),text,'client source directives remain covered without becoming declarations');
}
const directives="SELECT $$\n\\i phantom.sql\n$$;\nSELECT 'line\n\\ir string-phantom.sql\n';\n"
  +"/* outer /* nested */ \\i comment-phantom.sql */\n"
  +"\\i 'schema files/base.sql'\n\\ir 'semi;colon.sql'\n@@'double''quote.sql'\nsource plain.sql;\n\\i :dynamic\n\\i `$command`\n";
const expected=['schema files/base.sql','semi;colon.sql',"double'quote.sql",'plain.sql'];
assert.deepEqual(collectSqlImports(directives,{dialect:'postgresql'}),expected);
assert.deepEqual(buildSqlRelations(directives,[],{dialect:'postgresql'}).importLinks,expected);
const {dir:root}=await prepareIsolatedTestCacheDir('sql-passive-local-includes');
const fileNames=['main.sql',...expected];
const entries=[];
for(const rel of fileNames) {const abs=path.join(root,rel);await fs.mkdir(path.dirname(abs),{recursive:true});await fs.writeFile(abs,'');entries.push({rel,abs,stat:await fs.stat(abs)});}
const relations=new Map([['main.sql',{imports:expected}]]);
resolveImportLinks({root,entries,importsByFile:{'main.sql':expected},fileRelations:relations,enableGraph:true});
assert.deepEqual(relations.get('main.sql').importLinks.toSorted(),expected.toSorted());
for(const text of ['<root/>','<root marker="rootmarker">before</root>',
  '<?xml version="1.0"?><!DOCTYPE root SYSTEM "file:///inert.dtd"><root xmlns="urn:inert" marker="rootmarker">before<a>alpha</a>between<b>beta</b>after</root>',
  '<root marker="rootmarker">😀 before<!-- comment --><![CDATA[opaque <x>]]><a>alpha</a></root>']) {
  const chunks=chunkXml(text,{});
  assert.equal(chunks.map(chunk=>readChunkContent(text,chunk)).join(''),text);
  for(const chunk of chunks) if(chunk.meta.lexicalElementRange) {
    const range=chunk.meta.lexicalElementRange;
    assert.ok(text.slice(range.start,range.end).startsWith('<'+chunk.name));
    assert.ok(chunk.meta.nameRange.start>=range.start);
  }
  const split=smartChunk({text,ext:'.xml',mode:'code',context:{chunking:{maxBytes:30}}});
  assert.equal(split.map(chunk=>readChunkContent(text,chunk)).join(''),text);
  if(text.includes('rootmarker')) {
    const {context}=createProcessChunksFixtureContext({text,ext:'.xml',languageId:'xml',rel:'fixture.xml',riskAnalysisEnabled:false,typeInferenceEnabled:false,
      overrides:{sc:chunks}});
    const indexed=await processFixtureChunks(context);
    assert.ok(indexed.chunks.some(chunk=>chunk.tokens.includes('rootmarker')),'root markers survive the real indexed token consumer');
  }
}
console.log('SQL segmented declarations, dialect source/include boundaries and XML root/mixed text survive passive consumers.');
