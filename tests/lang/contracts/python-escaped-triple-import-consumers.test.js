import assert from 'node:assert/strict';
import { collectLanguageImportEntries,buildLanguageContext } from '../../../src/index/language-registry.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';
import { assertEscapedImportReplay } from './escaped-import-replay-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const sources = [];
for (const quote of ['"',"'"]) for (const prefix of ['', 'r', 'u', 'b', 'f', 'fr', 'rf']) for (const newline of ['\n','\r\n']) {
  const triple = quote.repeat(3);
  const odd = ['text = '+prefix+triple+'prefix \\'+triple,'import phantom',triple,'import actual',
    'text2 = '+quote+'import ordinary_phantom'+quote+'; import after_semicolon','# import comment_phantom',''].join(newline);
  const even = ['text = '+prefix+triple+'prefix \\\\'+triple,'import actual',''].join(newline);
  for (const [source,expected] of [[odd,['actual','after_semicolon']],[even,['actual']]]) {
    const entries = collectLanguageImportEntries({text:source,ext:'.py',relPath:'fixture.py',mode:'code'});
    assert.deepEqual(entries.map(row=>row.specifier),expected.toSorted());
    assert.equal(getImportExtraction(entries).reusePolicy,'refresh-required');
  }
  if (!prefix && newline === '\n') sources.push(odd);
}
const source = sources.join('\n');
try {
  const input = {text:source,ext:'.py',relPath:'fixture.py',mode:'code',options:{pythonAst:{enabled:true,
    workerCount:1,maxWorkers:1,maxRetries:0,taskTimeoutMs:5000}}};
  const {lang,context} = await buildLanguageContext(input); assert.ok(context.pythonAst,'actual prepared CPython route');
  assert.deepEqual(lang.buildRelations({...input,context}).imports.toSorted(),['actual','after_semicolon']);
  await assertEscapedImportReplay({name:'python-escaped-triple-import-consumers',file:'fixture.py',source,
    expected:['actual','after_semicolon']});
} finally { await shutdownPythonAstPool(); }
console.log('Escaped Python triple delimiters retain exact registered/CPython/import-scan and durable refresh semantics.');
