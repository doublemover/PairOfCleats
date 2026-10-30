import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImportEntries,buildLanguageContext } from '../../../src/index/language-registry.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { PYTHON_IDENTIFIER_PROFILE,pythonIdentifier } from '../../../src/lang/python/identifiers.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
assert.equal(PYTHON_IDENTIFIER_PROFILE.available,true,'the named Python3.15/UCD17 profile must be present');
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.importResolution,'27');
const source=['import café','import 包.模块','from 包 import 模块','from .包 import 模块 as 别名',
  'from ..包 import 模块','from pkg import 模块 as 别名','import K as K别名','import e\u0301 as e\u0301别名',
  'from pkg import (',' 模块,',' other as alias,',')','# import comment_名字',
  'text = "import literal_名字"',''].join('\r\n');
const expected=['café','包.模块','包','.包','..包','pkg','K','é'].toSorted();
const usages=['模块','别名','K别名','é别名','other','alias'].toSorted();
const lexical=collectPythonImports(source);
assert.deepEqual(lexical.imports.toSorted(),expected); assert.deepEqual(lexical.usages.toSorted(),usages);
const entries=collectLanguageImportEntries({text:source,ext:'.py',relPath:'package/main.py',mode:'code'});
assert.deepEqual(entries.map(row=>row.specifier),expected);
for(const [raw,semantic] of [['K','K'],['e\u0301','é'],['K别名','K别名']]) {
  const occurrence=entries.occurrences.find(row=>row.raw===raw);
  assert.equal(occurrence?.semantic,semantic,'raw language spelling remains separate from NFKC identity');
  assert.ok(source.slice(occurrence.source.start,occurrence.source.end).includes(raw));
}
for(const name of ['😀','\u0301bad','a/b','a-b','a..b','class','a\u200db']) {
  assert.equal(pythonIdentifier(name),null,name);
  assert.deepEqual(collectLanguageImportEntries({text:'import '+name+'\n',ext:'.py',relPath:'bad.py',mode:'code'}).map(row=>row.specifier),[]);
}
assert.deepEqual(collectLanguageImportEntries({text:'import café AS alias\n',ext:'.py',relPath:'bad.py',mode:'code'}).map(row=>row.specifier),[],
  'Python keyword spelling remains case sensitive');
try {
  const input={text:source,ext:'.py',relPath:'package/main.py',mode:'code',options:{pythonAst:{enabled:true,
    workerCount:1,maxWorkers:1,maxRetries:0,taskTimeoutMs:5000}}};
  const {lang,context}=await buildLanguageContext(input); assert.ok(context.pythonAst);
  const relations=lang.buildRelations({...input,context});
  assert.deepEqual(relations.imports.toSorted(),expected); assert.deepEqual(relations.usages.toSorted(),usages);
  const {root,abs,stat}=await assertEscapedImportReplay({name:'python-unicode-import-consumers',file:'package/main.py',source,expected});
  const localSource='import café\nfrom .包 import 模块\nimport K\n';
  const files=[{abs,rel:'package/main.py',stat}];
  for(const rel of ['café.py','K.py','package/包.py']) {
    const target=path.join(root,rel); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,'');
    files.push({abs:target,rel,stat:await fs.stat(target)});
  }
  const imports=collectPythonImports(localSource).imports;
  const mapped=new Map([['package/main.py',{imports}]]);
  resolveImportLinks({root,entries:files,importsByFile:{'package/main.py':imports},fileRelations:mapped,enableGraph:true});
  assert.deepEqual(mapped.get('package/main.py').importLinks.toSorted(),['K.py','café.py','package/包.py'].toSorted());
} finally { await shutdownPythonAstPool(); }
console.log('Python Unicode identifiers retain raw/NFKC provenance through CPython, registered scans, local resolution and persisted refresh.');
