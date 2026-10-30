import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSharedModuleLedger, sharedModuleScanCoverageErrors } from '../../../tools/docs/shared-module-ledger.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareTestCacheDir('shared-module-ledger-scope');
const files = {
  'src/shared/example.js': 'export const example = 1;',
  'tools/shared/another.js': 'export const another = 2;',
  'tests/shared/example.test.js': "import { example } from '../../src/shared/example.js';\nconsole.log(example);",
  'sublime/PairOfCleats/lib/navigation.py': 'def navigate():\n    return 1\n',
  'sublime/PairOfCleats/opaque.dat': 'inventory-only surface',
  'tests/.cache/unowned.js': 'excluded generated cache'
};
for (const [file, contents] of Object.entries(files)) {
  const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents);
}
const { report } = await buildSharedModuleLedger(root);
assert.ok(report.consumerMap.bySharedFile['src/shared/example.js'].importers.includes('tests/shared/example.test.js'));
assert.ok(report.consumerMap.byConsumer['tests/shared/example.test.js'].sharedImports.includes('src/shared/example.js'));
assert.equal(report.consumerMap.byConsumer['sublime/PairOfCleats/lib/navigation.py'], undefined, 'inventory coverage does not pretend to parse Python as JS');
const editor = report.scanLedger.h31.issues.find(issue => issue.issueId === '420');
for (const file of ['sublime/PairOfCleats/lib/navigation.py', 'sublime/PairOfCleats/opaque.dat']) {
  assert.ok(editor.matchedFiles.includes(file));
  assert.ok(report.scanLedger.h31.repoCoverage.expectedFiles.includes(file));
  assert.ok(report.scanLedger.h31.repoCoverage.scannedFiles.includes(file));
}
assert.ok(!report.scanLedger.h31.repoCoverage.expectedFiles.includes('tests/.cache/unowned.js'));
assert.ok(report.scanLedger.h31.repoCoverage.exclusions.prefixes.includes('tests/.cache'));
assert.deepEqual(sharedModuleScanCoverageErrors(report), []);
const unassigned = structuredClone(report);
unassigned.scanLedger.h31.repoCoverage.expectedFiles.push('sublime/PairOfCleats/unassigned.py');
assert.deepEqual(unassigned.gaps.unscannedH31Files, []);
assert.deepEqual(sharedModuleScanCoverageErrors(unassigned), ['unscanned H31 file: sublime/PairOfCleats/unassigned.py'],
  'the policy recomputes admission even if a generated gaps array claims no omissions');
console.log('Shared-module census includes test backlinks and accounts for every declared file independently of import applicability.');
