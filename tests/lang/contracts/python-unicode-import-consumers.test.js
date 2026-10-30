import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImportEntries,buildLanguageContext } from '../../../src/index/language-registry.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { PYTHON_IDENTIFIER_PROFILE,pythonIdentifier } from '../../../src/lang/python/identifiers.js';
import { PYTHON_XID_START,PYTHON_XID_CONTINUE } from '../../../src/lang/python/identifier-tables.js';
import { findPythonExecutable } from '../../../src/lang/python/executable.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
assert.equal(PYTHON_IDENTIFIER_PROFILE.available,true,'the named Python3.15/UCD17 profile must be present');
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
for(const name of ['😀','\u0301bad','a/b','a-b','a..b','class','a\u200db','a\u200cb','\u200da','\u200ca']) {
  assert.equal(pythonIdentifier(name),null,name);
  assert.deepEqual(collectLanguageImportEntries({text:'import '+name+'\n',ext:'.py',relPath:'bad.py',mode:'code'}).map(row=>row.specifier),[]);
}
// A real independent CPython oracle checks both sides of every generated range,
// plus normalization, keywords and the join controls that exposed the ID/XID bug.
const boundaries=new Set(['K','e\u0301','class','ｃｌａｓｓ','a\u200db','a\u200cb']);
for(const [ranges,prefix]of [[PYTHON_XID_START,''],[PYTHON_XID_CONTINUE,'a']]) {
  let previous=-2;
  for(const [start,end]of ranges) {
    assert.ok(Number.isInteger(start)&&start>previous+1&&end>=start&&end<=0x10ffff);previous=end;
    for(const value of [start-1,start,end,end+1])if(value>=0&&value<=0x10ffff)boundaries.add(prefix+String.fromCodePoint(value));
  }
}
const {dir:oracleDir}=await prepareIsolatedTestCacheDir('python-xid-oracle'),names=[...boundaries],oracleInput=path.join(oracleDir,'names.json');
await fs.writeFile(oracleInput,JSON.stringify(names));
const python=await findPythonExecutable();assert.ok(python,'the actual named CPython oracle is required');
const oracle=await spawnSubprocess(python,['-c',
  'import json,keyword,sys,unicodedata; names=json.load(open(sys.argv[1],encoding="utf-8")); print(json.dumps({"python":list(sys.version_info[:2]),"unicode":unicodedata.unidata_version,"names":[unicodedata.normalize("NFKC",n) if n.isidentifier() and not keyword.iskeyword(n) else None for n in names]}))',oracleInput],
{timeoutMs:5000,maxOutputBytes:512*1024,captureStdout:true,captureStderr:true,rejectOnNonZeroExit:false});
assert.equal(oracle.exitCode,0,oracle.stderr);const independentlyObserved=JSON.parse(oracle.stdout);
assert.deepEqual(independentlyObserved.python,[3,15]);assert.equal(independentlyObserved.unicode,'17.0.0');
assert.deepEqual(names.map(name=>pythonIdentifier(name)?.semantic??null),independentlyObserved.names);
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
