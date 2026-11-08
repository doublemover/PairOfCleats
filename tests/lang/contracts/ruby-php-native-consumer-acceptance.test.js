import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { writeIncrementalBundle,readCachedBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
applyTestEnv();
const ruby = await prepareRegisteredLanguage({ext:'.rb',text:[
  'class A', ' def same(value)', '  first()', ' end', ' def self.same(value)', '  second()', ' end',
  ' class << self', '  def group()', '   third()', '  end', ' end',
  ' def Other.explicit()', '  fourth()', ' end', 'end',
  'class First; end', 'class Second; end', 'def First.ping(); alpha(); end', 'def Second.ping(); beta(); end',
  'def idle(); 42; end', 'def recursive(); recursive(); end', 'def endless = actual()',
  'def defaults(value=header_call()); body_call(); end', ''
].join('\n')});
assert.deepEqual(ruby.relations.calls.map(edge=>edge.join(' -> ')).sort(),[
  'A.same -> first','A.self.same -> second','A.self.group -> third','Other.self.explicit -> fourth',
  'First.self.ping -> alpha','Second.self.ping -> beta','recursive -> recursive','endless -> actual',
  'defaults -> header_call','defaults -> body_call'
].sort());
for(const [index,chunk] of ruby.chunks.entries()) {
  if(chunk.name==='A.same') assert.deepEqual(ruby.projected[index].calls,[['A.same','first']]);
  if(chunk.name==='A.self.same') assert.deepEqual(ruby.projected[index].calls,[['A.self.same','second']]);
}
const source = ['<?php','enum Unit { case Ready; public function label(): string { return alpha(); } }',
  'enum Backed: string { case Ready = "ready-marker"; }','interface Face { public function required(): int; }',
  'abstract class Base { abstract protected function abstracted(): int; }',
  'class C {',' /** Useful metadata docs. */',
  ' public function typed(int $__proto__ = 2, string $name = "guest", array $items = ["nested" => [1,2]], ?int &$reference = null, string ...$rest): int { return beta(); }',
  ' private function hidden(string $secret): string { return $secret; }',
  ' function implicit(): int { return 1; }','}','function empty_parameters() {}','function normal() {}',''].join('\n');
const php=await prepareRegisteredLanguage({text:source,ext:'.php'});
assert.ok(php.chunks.some(row=>row.name==='Unit' && row.kind==='EnumDeclaration'));
assert.ok(php.chunks.some(row=>row.name==='Backed' && row.kind==='EnumDeclaration'));
assert.deepEqual(php.relations.calls,[['Unit.label','alpha'],['C.typed','beta']]);
assert.ok(php.relations.exports.includes('Unit.label')); assert.ok(php.relations.exports.includes('C.implicit'));
assert.ok(!php.relations.exports.includes('C.hidden'));
const typed=php.chunks.find(row=>row.name==='C.typed');
const projected=php.lang.extractDocMeta({...php.input,context:php.context,chunk:typed});
assert.equal(Object.hasOwn(typed.meta.paramTypes,'__proto__'),true);
assert.equal(projected.paramTypes.__proto__,'int'); assert.equal(projected.paramDefaults.__proto__,'2');
assert.equal(projected.paramTypes.reference,'?int'); assert.equal(projected.paramTypes.rest,'string');
assert.equal(projected.paramDefaults.items,'["nested" => [1,2]]');
assert.notEqual(projected.paramTypes,typed.meta.paramTypes);assert.notEqual(projected.paramDefaults,typed.meta.paramDefaults);
projected.paramTypes.__proto__='changed';assert.equal(typed.meta.paramTypes.__proto__,'int');
const payload=php.payloads.find(row=>row.name==='C.typed');
assert.equal(payload.docmeta.paramTypes.__proto__,'int');assert.equal(payload.docmeta.paramDefaults.__proto__,'2');
assert.match(payload.docmeta.doc,/Useful metadata docs/);assert.equal(payload.docmeta.visibility,'public');
assert.equal(JSON.parse(JSON.stringify(payload)).docmeta.paramTypes.__proto__,'int');
const empty=php.payloads.find(row=>row.name==='empty_parameters');
assert.deepEqual(empty.docmeta.paramTypes,{});assert.deepEqual(empty.docmeta.paramDefaults,{});
const {dir}=await prepareIsolatedTestCacheDir('php-owned-parameter-replay');
const absPath=path.join(dir,'fixture.php');await fs.writeFile(absPath,source);
const stat=await fs.stat(absPath),bundleDir=path.join(dir,'bundles');await fs.mkdir(bundleDir);
const manifest={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{}};
manifest.files['fixture.php']=await writeIncrementalBundle({enabled:true,bundleDir,manifest,relKey:'fixture.php',fileStat:stat,
  fileHash:sha1(source),fileChunks:php.payloads,bundleFormat:'json',fileRelations:php.relations});
const {cachedBundle}=await readCachedBundle({enabled:true,absPath,relKey:'fixture.php',fileStat:stat,manifest,bundleDir,bundleFormat:'json'});
const restored=cachedBundle.chunks.find(row=>row.name==='C.typed');
assert.deepEqual(restored.docmeta.paramTypes,payload.docmeta.paramTypes);
assert.deepEqual(restored.docmeta.paramDefaults,payload.docmeta.paramDefaults);
assert.equal(Object.hasOwn(restored.docmeta.paramTypes,'__proto__'),true);
const shell=await prepareRegisteredLanguage({ext:'.sh',text:'caller() { MODE=fast OTHER=value >out "callee"; $dynamic; echo "phantom()"; }\n'});
assert.deepEqual(shell.relations.calls,[['caller','callee'],['caller','echo']]);
assert.ok(shell.relations.callDetails.some(detail=>detail.callee===null && detail.calleeRaw==='$dynamic'
  && detail.reason==='dynamic-call-target'));
for(const ext of ['.zsh','.ksh']) {
  const unsupported=await prepareRegisteredLanguage({ext,text:'caller() { callee; }\n'});
  assert.ok(unsupported.chunks.every(chunk=>chunk.meta.shellSyntaxDialect==='bash'));
  assert.ok(unsupported.chunks.every(chunk=>chunk.meta.shellDialectCoverage==='unsupported-dialect-bash-syntax-subset'));
  assert.ok(unsupported.projected.every(row=>row.callCoverage.startsWith('partial-')));
}
const recovered=await prepareRegisteredLanguage({ext:'.sh',text:'caller() { target;\n'});
assert.ok(recovered.chunks.every(chunk=>chunk.kind==='File' && chunk.meta.wholeFile===true));
assert.deepEqual(recovered.relations.calls,[]);
assert.ok(recovered.projected.every(row=>row.callCoverage!=='complete-supported-call-roles'));
const partial=await prepareRegisteredLanguage({ext:'.sh',text:'caller() { target; }\nbroken() {\n'});
assert.deepEqual(partial.relations.calls,[['caller','target']]);
assert.ok(partial.projected.every(row=>row.callCoverage==='partial-parser-recovered'));
console.log('Ruby receiver-owned calls and PHP enum/bodyless/owned structured metadata survive registered consumers.');
