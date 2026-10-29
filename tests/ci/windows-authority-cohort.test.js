import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import {
  findWindowsLinkFixtures, validateAuthorityManifest, authorityRunnerArgs,
  assertAuthorityReport, probeFileSymlink
} from '../../tools/ci/run-windows-authority.js';

const root = process.cwd();
const listed = await spawnSubprocess(process.execPath, ['tests/run.js', '--lane', 'all-with-destructive', '--list', '--json'],
  { cwd: root, stdio: 'pipe', timeoutMs: 10000, maxOutputBytes: 10 * 1024 * 1024 });
const tests = JSON.parse(listed.stdout).tests;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/ci/windows-authority-fixtures.json'), 'utf8'));
const required = findWindowsLinkFixtures(root, tests);
const available = tests.map(test => test.id);
const ids = validateAuthorityManifest(manifest, available, required);
assert.ok(available.includes('workspace/config-contract-matrix'), 'ordinary CI owns portable workspace identity and actual Windows case aliases');
assert.equal(ids.includes('workspace/config-contract-matrix'), false,
  'workspace identity creates no links and must not require symlink privilege');
assert.ok(available.includes('tooling/ci/lsp-runtime-artifact-admission'), 'the ordinary cohort still owns stock runtime admission');
assert.equal(ids.includes('tooling/ci/lsp-runtime-artifact-admission'), false,
  'POSIX PHAR symlinks cannot be counted as native Windows link coverage; its Windows branch asserts unsupported');
assert.ok(available.includes('tooling/install/postinstall-patch-enforcement'), 'ordinary CI retains the complete patch contract');
assert.equal(ids.includes('tooling/install/postinstall-patch-enforcement'), false,
  'controlled linked-directory admission belongs to portable CI and creates no file symlink');
assert.ok(ids.includes('security/repository-authority') && ids.includes('storage/semantic/runtime-opened-byte-integrity'));
assert.ok(ids.includes('tui/operator-search-file-authority'), 'source previews and editor PATH aliases need actual file-link coverage');
assert.ok(ids.includes('tui/operator-artifact-file-authority'), 'artifact reads and export destinations need actual link authority coverage');
assert.throws(() => validateAuthorityManifest({ ...manifest, ids: ids.slice(1) }, available, required), /inventory drift/);
assert.throws(() => validateAuthorityManifest({ ...manifest, ids: [...ids, ids[0]] }, available, required), /duplicate/);
assert.throws(() => validateAuthorityManifest({ ...manifest, ids: ['does-not-exist'] }, available, required), /unknown/);
assert.throws(() => validateAuthorityManifest({ ...manifest, retry: true }, available, required), /unknown/);

const args = authorityRunnerArgs(['synthetic/a.b'], 'report.json', 'logs');
for (const [flag, value] of [['--jobs', '1'], ['--timeout-ms', '30000'], ['--retries', '0']]) {
  assert.equal(args[args.indexOf(flag) + 1], value);
}
assert.ok(args.includes('--native-status-redo=false'));
assert.equal(args.includes('--fail-fast'), false, 'isolated authority fixtures must all run so failures do not hide the remaining inventory');
assert.equal(args.at(-1), '/^synthetic/a\\.b$/', 'each ID is an exact escaped selector');
const report = { tests: ids.map(id => ({ id, status: 'passed', timedOut: false, skipReason: null,
  attempts: 1, exitCode: 0, signal: null, durationMs: 1 })) };
assertAuthorityReport(report, ids);
assert.throws(() => assertAuthorityReport({ tests: [] }, ids), /incomplete/);
const duplicated = structuredClone(report);
duplicated.tests[0].id = duplicated.tests[1].id;
assert.throws(() => assertAuthorityReport(duplicated, ids), /duplicate/);
for (const change of [
  { status: 'skipped' }, { timedOut: true }, { skipReason: 'unavailable' }, { attempts: 2 },
  { exitCode: 1 }, { signal: 'SIGTERM' }, { durationMs: 30001 }, { durationMs: -1 }, { id: 'wrong-generation-case' }
]) {
  const invalid = structuredClone(report);
  Object.assign(invalid.tests[0], change);
  assert.throws(() => assertAuthorityReport(invalid, ids), 'a degraded result must never qualify');
}
let ownedDirectory;
const blockedFileSystem = { ...fs,
  mkdtempSync: prefix => (ownedDirectory = fs.mkdtempSync(prefix)),
  symlinkSync: () => { throw Object.assign(new Error('injected capability denial'), { code: 'EPERM' }); }
};
assert.throws(() => probeFileSymlink(blockedFileSystem), error => error.code === 'EPERM');
assert.equal(fs.existsSync(ownedDirectory), false, 'a denied capability probe cleans its owned entries');

const workflow = parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
const job = workflow.jobs['windows-authority'];
assert.equal(job['runs-on'], 'windows-latest');
assert.equal(job.needs, 'gate');
assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 30);
const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}', 'qualify the exact head, not an inferred merge tree');
const setup = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
assert.equal(setup.with['node-version'], fs.readFileSync('.nvmrc', 'utf8').trim());
assert.ok(job.steps.some(step => step.run?.includes('git rev-parse HEAD') && step.run.includes('Expected checkout')));
assert.ok(job.steps.some(step => step.run?.includes('node tools/ci/run-windows-authority.js')));
const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
assert.equal(upload.if, 'always()');
assert.equal(upload.with['include-hidden-files'], true);
assert.equal(upload.with['if-no-files-found'], 'error');
assert.match(upload.with.path, /\.diagnostics\/windows-authority/);
assert.match(upload.with.path, /\.testLogs\/windows-authority/);
console.log(`Windows authority guard contracts passed for ${ids.length} explicitly selected fixtures`);
