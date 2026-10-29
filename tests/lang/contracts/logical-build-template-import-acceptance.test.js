import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildLanguageContext,collectLanguageImportEntries } from '../../../src/index/language-registry.js';
import { collectCmakeImports } from '../../../src/index/language-registry/import-collectors/cmake.js';
import { collectMakefileImports } from '../../../src/index/language-registry/import-collectors/makefile.js';
import { collectStarlarkImportEntries } from '../../../src/index/language-registry/import-collectors/starlark.js';
import { collectShellImports } from '../../../src/lang/shell.js';
import { parseJinjaTemplateStructure } from '../../../src/shared/jinja-template-structure.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
applyTestEnv();
const registeredImports=async(text,ext,relPath='fixture'+ext) => {
  const input={text,ext,relPath,mode:'code',options:{collectorNow:()=>0}};
  const entries=collectLanguageImportEntries(input);
  const {lang,context}=await buildLanguageContext(input);
  return {entries,relations:lang.buildRelations({...input,context})};
};
for(const newline of ['\n','\r\n']) {
  const cmake=['#[==[','include(ghost.cmake)',']==]','InClUdE(', ' [=[', 'cmake/helper.cmake]=]',')',
    'include([[cmake/${literal}.cmake]])','include("cmake/my (helper).cmake")','include([[trailing)]])',
    'include("${dynamic}.cmake")','include(${dynamic}.cmake)',
    'include("$ENV{DYNAMIC}.cmake")','include($CACHE{DYNAMIC}.cmake)','include("cmake/\\${escaped}.cmake")',
    'target_link_libraries(app PRIVATE debug core_d optimized core general shared private)',
    'add_dependencies(app generated_target)','add_subdirectory("目录/sub dir")','find_package(Threads REQUIRED)',''].join(newline);
  const expected=['cmake/helper.cmake','cmake/${literal}.cmake','cmake/my (helper).cmake','trailing)',
    'cmake/${escaped}.cmake','core_d','core','shared','private','generated_target','目录/sub dir','Threads'];
  assert.deepEqual(collectCmakeImports(cmake,{collectorNow:()=>0}),expected);
  const admitted=await registeredImports(cmake,'.cmake');
  assert.deepEqual(admitted.entries.map(entry=>entry.specifier).sort(),expected.toSorted());
  assert.deepEqual(admitted.relations.imports,expected.toSorted());
  assert.ok(admitted.entries.every(entry=>entry.provenance==='parsed-literal'));
  const make=['build: source.c \\',' more.c','\techo label: ghost.c','build: CFLAGS = -O2',
    'include one.mk \\',' two.mk','build:: order.c ; echo inline: phantom.c',
    'other: escaped\\ space.c | generated.h','.RECIPEPREFIX := >','>echo label: prefixed-ghost.c',''].join(newline);
  const makeExpected=['source.c','more.c','one.mk','two.mk','order.c','escaped space.c','generated.h'];
  assert.deepEqual(collectMakefileImports(make,{collectorNow:()=>0}),makeExpected);
  assert.deepEqual((await registeredImports(make,'.makefile','Makefile')).relations.imports,makeExpected.toSorted());
  const starlark=['load(', '# before first positional', ' ":helper#tag.bzl", "symbol")',
    'use_extension( # comment', ' "//tools:extension.bzl", "ext")',
    'bazel_dep(name= # before actual binding', ' "real")',
    'local_path_override(module_name="dep", path= # before value', ' "../right dir")',
    'load(""":triple.bzl""", "triple")','load(":escaped\\\"quote.bzl", "x")',''].join(newline);
  const expectedStar=[':helper#tag.bzl','//tools:extension.bzl','@real','../right dir',':triple.bzl',':escaped"quote.bzl'];
  const entries=collectStarlarkImportEntries(starlark);
  assert.deepEqual(entries.map(entry=>entry.specifier).sort(),expectedStar.toSorted());
  assert.ok(entries.find(entry=>entry.specifier==='@real').collectorHint);
  assert.deepEqual((await registeredImports(starlark,'.bzl')).relations.imports,expectedStar.toSorted());
}
for(const ext of ['.j2','.djhtml']) for(const name of ['cafe','café','名字']) {
  const source=`{% block ${name} %}{{ ${name} }}{% endblock ${name} %}`;
  const model=parseJinjaTemplateStructure(source,{ext});assert.equal(model.reason,null);
  assert.deepEqual(model.definitions.map(row=>row.name),[name]);assert.ok(model.referenceEntries.every(row=>row.value===name));
  for(const entry of model.referenceEntries) assert.equal(source.slice(entry.start,entry.end),name);
  const registry=await registeredImports(source,ext);assert.ok(registry.relations.exports.includes(name));
  assert.ok(smartChunk({text:source,ext,mode:'code'}).some(chunk=>chunk.name.includes(name)));
}
for(const filter of ['replace("=", "")','replace(old="a", new="b")','replace(old=nested(value="a"),new="=")']) {
  const source=`{% macro before() %}one{% endmacro %}{% set body | ${filter} %}hello{% endset %}`
    +'{% include "real.html" %}{% macro after() %}two{% endmacro %}';
  const model=parseJinjaTemplateStructure(source,{ext:'.j2'});assert.equal(model.reason,null);
  const registry=await registeredImports(source,'.j2');
  assert.deepEqual(registry.relations.imports,['real.html']);assert.ok(registry.relations.exports.includes('before'));
  assert.ok(registry.relations.exports.includes('after'));
}
const shell='source "./lib util.sh" extra\n. \'./other lib.sh\' # comment\nsource ./lib.sh\nsource "$dynamic"\nsource "$(dynamic)"\n';
assert.deepEqual(collectShellImports(shell),['./lib util.sh','./other lib.sh','./lib.sh']);
const {dir:root}=await prepareIsolatedTestCacheDir('shell-literal-resolution-acceptance');
const files=['scripts/main.sh','scripts/lib util.sh','scripts/other lib.sh','scripts/lib.sh'];
const entries=[];
for(const rel of files) {const abs=path.join(root,rel);await fs.mkdir(path.dirname(abs),{recursive:true});await fs.writeFile(abs,rel.endsWith('main.sh')?shell:'');entries.push({abs,rel,stat:await fs.stat(abs)});}
const admitted=await registeredImports(shell,'.sh','scripts/main.sh');
const relations=new Map([['scripts/main.sh',{imports:admitted.relations.imports}]]);
resolveImportLinks({root,entries,importsByFile:{'scripts/main.sh':admitted.relations.imports},fileRelations:relations,enableGraph:true});
assert.deepEqual(relations.get('scripts/main.sh').importLinks.toSorted(),files.slice(1).toSorted());
console.log('Logical build arguments, literal template identities and Bash quoted local resolution passed without execution.');
