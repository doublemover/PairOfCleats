import assert from 'node:assert/strict';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectLanguageImportEntries,buildLanguageContext } from '../../../src/index/language-registry.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const pairs=[['if TYPE_CHECKING: import alpha; import delta','if TYPE_CHECKING:\n import alpha\n import delta',['alpha','delta']],
  ['def local(): import gamma','def local():\n import gamma',['gamma']],['class Local: import class_dep','class Local:\n import class_dep',['class_dep']],
  ['if flag: import a\nelif other: import b\nelse: from .包 import 模块 as 别名','if flag:\n import a\nelif other:\n import b\nelse:\n from .包 import 模块 as 别名',['a','b','.包']],
  ['try: import trial\nexcept Error: import handled\nfinally: import final','try:\n import trial\nexcept Error:\n import handled\nfinally:\n import final',['trial','handled','final']],
  ['with manager(): import managed','with manager():\n import managed',['managed']],['for x in values: import looped','for x in values:\n import looped',['looped']],
  ['while flag: import repeated','while flag:\n import repeated',['repeated']],['if (\n flag\n): from pkg import (\n Member,\n)','if flag:\n from pkg import Member',['pkg']],
  ['if lambda: True: import lambda_guard','if lambda: True:\n import lambda_guard',['lambda_guard']]];
for(const [inline,multiline,expected]of pairs)for(const text of [inline,multiline]) {
  assert.deepEqual(collectPythonImports(text).imports.toSorted(),expected.toSorted());
  const entries=collectLanguageImportEntries({text,ext:'.py',relPath:'suite.py',mode:'code'});
  assert.deepEqual(entries.map(row=>row.specifier),expected.toSorted());
  assert.ok(entries.occurrences.every(row=>row.source.start>=0&&row.source.end<=text.length));
}
const source=pairs.map(row=>row[0]).join('\n')+'\nvalue = {"import phantom": 1}\n'
  +'value = data[1:2]\nvalue: annotation = lambda: "import phantom"\n# if bad: import phantom\n';
const expected=[...new Set(pairs.flatMap(row=>row[2]))].toSorted();
try {
  const input={text:source,ext:'.py',relPath:'suite.py',mode:'code',options:{pythonAst:{enabled:true,workerCount:1,maxWorkers:1,maxRetries:0,taskTimeoutMs:5000}}};
  const {lang,context}=await buildLanguageContext(input);assert.ok(context.pythonAst);
  assert.deepEqual(lang.buildRelations({...input,context}).imports.toSorted(),expected);
  assert.ok(collectPythonImports(source).usages.includes('别名'));
  await assertEscapedImportReplay({name:'python-inline-suite-import-consumers',file:'suite.py',source,expected});
}finally{await shutdownPythonAstPool();}
console.log('Python inline/multiline suites preserve exact static imports without interpreting colon-bearing expressions.');
