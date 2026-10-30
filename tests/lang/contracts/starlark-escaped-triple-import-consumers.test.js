import assert from 'node:assert/strict';
import { collectLanguageImportEntries,buildLanguageContext } from '../../../src/index/language-registry.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const sources=[];
for (const quote of ['"',"'"]) for (const newline of ['\n','\r\n']) {
  const triple=quote.repeat(3);
  const odd=['text = '+triple+'前😀 \\'+triple,'load(":phantom.bzl", "symbol")',
    'use_extension("//ghost:extension.bzl", "x")','bazel_dep(name="ghost")',triple,
    'load( # original comment boundary', ' ":real.bzl", "symbol")',
    'use_extension("//tools:extension.bzl", "ext")','bazel_dep(name= # binding comment',' "actual")',
    'local_path_override(module_name="dep", path= # path comment',' "../actual")',
    '# load(":comment.bzl", "x")','value = "load(ordinary)"',''].join(newline);
  const even=['text = '+triple+'前 \\\\'+triple,'load(":real.bzl", "x")',''].join(newline);
  for (const [source,expected] of [[odd,[':real.bzl','//tools:extension.bzl','@actual','../actual']],[even,[':real.bzl']]]) {
    const input={text:source,ext:'.bzl',relPath:'rules.bzl',mode:'code',options:{collectorNow:()=>0}};
    const entries=collectLanguageImportEntries(input);
    assert.deepEqual(entries.map(row=>row.specifier),expected.toSorted());
    assert.ok(entries.filter(row=>row.specifier.startsWith(':')||row.specifier.startsWith('@')).every(row=>row.collectorHint));
    assert.equal(getImportExtraction(entries).reusePolicy,'refresh-required');
    const {lang,context}=await buildLanguageContext(input);
    assert.deepEqual(lang.buildRelations({...input,context}).imports,expected.toSorted());
    const cut=collectLanguageImportEntries({...input,options:{collectorNow:()=>0,collectorScanBudget:{maxChars:source.indexOf('load( #')}}});
    if(source.includes('load( #')) assert.deepEqual(cut.map(row=>row.specifier),[],'source budget cannot admit a string-contained phantom');
  }
  if(newline==='\n') sources.push(odd);
}
const literal='load(""":part\\""".bzl""", "symbol")';
assert.deepEqual(collectLanguageImportEntries({text:literal,ext:'.bzl',relPath:'rules.bzl',mode:'code'}).map(row=>row.specifier),[':part""".bzl']);
await assertEscapedImportReplay({name:'starlark-escaped-triple-import-consumers',file:'rules.bzl',source:sources.join('\n'),
  expected:[':real.bzl','//tools:extension.bzl','@actual','../actual']});
console.log('Starlark quote parity, comments, budgets and durable registered import refresh preserve only real dependencies.');
