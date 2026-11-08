import assert from 'node:assert/strict';
import { collectLanguageImports, buildLanguageContext } from '../../../src/index/language-registry.js';
import { collectCmakeImports } from '../../../src/index/language-registry/import-collectors/cmake.js';
import { collectMakefileImports } from '../../../src/index/language-registry/import-collectors/makefile.js';
import { collectStarlarkImports } from '../../../src/index/language-registry/import-collectors/starlark.js';
import { collectRImports } from '../../../src/index/language-registry/import-collectors/r.js';
import { collectShellImports } from '../../../src/lang/shell.js';
import { parseJinjaTemplateStructure } from '../../../src/shared/jinja-template-structure.js';
for(const [ext,text] of [['.hbs','{{> "thing,"}}{{> thing}}'],['.mustache','{{>thing,}}{{>thing}}'],['.j2','{% include "thing," %}{% include "thing" %}']]) {
  const input={ext,text,relPath:`fixture${ext}`,mode:'code',options:{}};
  assert.deepEqual(collectLanguageImports(input),['thing','thing,']);
  const {lang,context}=await buildLanguageContext(input);
  assert.deepEqual(lang.buildRelations({...input,context}).imports.slice().sort(),['thing','thing,']);
}
for(const ext of ['.j2','.djhtml']) for(const name of ['cafe','café','名字']) {
  const text=`{% block ${name} %}{{ ${name} }}{% endblock ${name} %}`;
  const model=parseJinjaTemplateStructure(text,{ext});
  assert.equal(model.reason,null);assert.ok(model.definitions.some(row=>row.name === name));
  assert.ok(model.referenceEntries.every(row=>row.value === name));
}
for(const filter of ['replace("=", "")','replace(old="a", new="b")']) {
  const text=`{% macro visible() %}ok{% endmacro %}{% set body | ${filter} %}hello{% endset %}{% include "real.html" %}`;
  const model=parseJinjaTemplateStructure(text,{ext:'.j2'});
  assert.equal(model.reason,null);assert.ok(model.definitions.some(row=>row.name === 'visible'));
  assert.deepEqual(model.importEntries.map(row=>row.value),['real.html']);
}
assert.deepEqual(collectShellImports('source "./lib util.sh" value\n. \'./other lib.sh\'\nsource "$dynamic"\n'),['./lib util.sh','./other lib.sh']);
assert.deepEqual(collectCmakeImports('#[[\ninclude(ghost.cmake)\n]]\ninclude(\n "cmake/my helper.cmake"\n)\ntarget_link_libraries(app\n PRIVATE core util\n)\n'),['cmake/my helper.cmake','core','util']);
assert.deepEqual(collectMakefileImports('build: source.c \\\n more.c\n\techo label: ghost.c\nbuild: CFLAGS = -O2\ninclude one.mk \\\n two.mk\nbuild:: order.c\n'),['source.c','more.c','one.mk','two.mk','order.c']);
assert.deepEqual(collectStarlarkImports('load(\n # comment\n ":helpers.bzl", "build_helper")\nbazel_dep(\n # name="wrong"\n name="right")\nlocal_path_override(module_name="dep",\n # path="wrong"\n path="../right")\n').sort(),['../right',':helpers.bzl','@right'].sort());
assert.deepEqual(collectRImports('library(dplyr, quietly=TRUE)\nlibrary(package="tidyr")\nrequire(dynamic,character.only=TRUE)\nprint("library(fake)")\nsource("real.R",local=TRUE)\n'),['dplyr','tidyr','real.R']);
console.log('literal template and logical build import identities passed');