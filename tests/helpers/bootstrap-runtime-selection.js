import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { BOOTSTRAP_RECEIPT, requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { CHECKOUT_JOURNAL_STATUS } from '../../tools/setup/checkout-stage-journal.js';
import { makeBootstrapDiagnosisFixture } from './bootstrap-diagnosis-fixture.js';

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Explicit installed-runtime qualification. Both executables and npm must
 * already exist: this helper never provisions a runtime or alters the checkout.
 * The receipt belongs only to an isolated metadata fixture, not an application.
 */
export const qualifyBootstrapRuntimeSelection = async ({ alternateNode, npmCli, unsupportedNodes = [] }) => {
  await requireBootstrap();
  for (const file of [alternateNode, npmCli]) assert.equal(path.isAbsolute(file), true);
  alternateNode = fs.realpathSync(alternateNode); npmCli = fs.realpathSync(npmCli);
  const currentNode = fs.realpathSync(process.execPath), cases = [];
  const run = async (command, args, cwd, env = process.env) => spawnResolvedSubprocess(command, args, {
    cwd, env, timeoutMs: 10000, maxOutputBytes: 256 * 1024, outputMode: 'string', rejectOnNonZeroExit: false,
    windowsHide: true, killTree: true
  });
  const identify = async executable => {
    const result = await run(executable, ['-p', 'JSON.stringify({node:process.version,abi:process.versions.modules,executable:process.execPath})'], process.cwd());
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
    return { ...JSON.parse(result.stdout), sha256: digest(executable) };
  };
  const current = await identify(currentNode), alternate = await identify(alternateNode);
  assert.notEqual(alternate.node, current.node, 'qualification needs two actual different full Node versions');
  assert.equal(alternate.abi, current.abi, 'the same-ABI case must not be explained by ABI drift');
  assert.match(alternate.node, /^v26\./); assert.match(current.node, /^v26\./);
  const fixture = await makeBootstrapDiagnosisFixture(), { root, packages } = fixture;
  try {
    const watched = [BOOTSTRAP_RECEIPT, CHECKOUT_JOURNAL_STATUS, 'package.json', 'package-lock.json',
      ...packages.flatMap(name => [`node_modules/${name}/package.json`, `node_modules/${name}/index.cjs`])];
    const before = watched.map(relative => [relative, digest(path.join(root, relative))]);
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
    const directEnv = { ...process.env };
    delete directEnv.npm_node_execpath; delete directEnv.npm_execpath;
    const emptyConfig = path.join(root, '.npmrc-empty'); fs.writeFileSync(emptyConfig, '');
    const execute = async ({ name, executable = alternateNode, ordinary = false, npm = false, correct = false }) => {
      const env = { ...directEnv, [pathKey]: path.dirname(correct ? currentNode : alternateNode) + path.delimiter + (directEnv[pathKey] || '') };
      const args = npm ? [npmCli, '--silent', '--offline', '--no-update-notifier', '--userconfig', emptyConfig,
        '--cache', path.join(root, '.tmp', 'npm-cache'), 'run', 'diagnosis-probe', '--', ...(ordinary ? ['ordinary'] : [])]
        : [path.join(root, 'diagnosis-probe.js'), ...(ordinary ? ['ordinary'] : [])];
      const result = await run(npm ? currentNode : executable, args, root, env);
      assert.equal(result.exitCode, correct ? 0 : 1, `${name}: ${result.stderr}`);
      assert.equal(result.stderr, '', `${name}: unexpected diagnostics`);
      const report = JSON.parse(result.stdout);
      assert.equal(report.runtime.actual, correct ? current.node : alternate.node);
      assert.equal(fs.realpathSync(report.runtime.executable), correct ? currentNode : alternateNode);
      assert.equal(report.runtime.abi, current.abi);
      if (npm) {
        assert.equal(fs.realpathSync(report.runtime.npmNodeExecutable), currentNode);
        assert.equal(fs.realpathSync(report.runtime.npmExecutable), npmCli);
      } else {
        assert.equal(report.runtime.npmNodeExecutable, null); assert.equal(report.runtime.npmExecutable, null);
      }
      if (correct) {
        assert.equal(report.bootstrap.ready, true);
        assert.equal(report.bootstrap.nativeProbes, 'not-run');
        assert.equal(report.operationalReadiness, 'not-probed');
      } else {
        assert.equal(report.bootstrap.ready, false);
        assert.equal(report.bootstrap.code, 'ERR_BOOTSTRAP_IDENTITY_MISMATCH');
        assert.deepEqual(report.bootstrap.mismatches, [{ field: 'runtime.node', expected: alternate.node, observed: current.node }]);
        assert.equal(report.recovery.action, 'verify');
        assert.equal(report.recovery.command, 'npm run bootstrap:ci -- --verify');
        if (ordinary) {
          assert.equal(report.code, 'ERR_BOOTSTRAP_REQUIRED');
          assert.match(report.message, /runtime.node: expected/);
          assert.match(report.message, /Next action: verify/);
        } else {
          assert.equal(report.operationalReadiness, 'not-probed');
          assert.deepEqual(report.nextCommands, [report.recovery.command]);
        }
      }
      cases.push({ name, command: npm ? currentNode : executable, args, cwd: root,
        selection: { path: env[pathKey], npmNodeExecutable: report.runtime.npmNodeExecutable },
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, report });
      return report;
    };
    await execute({ name: 'selected-runtime-metadata-control', executable: currentNode, correct: true });
    const explicit = await execute({ name: 'same-abi-runtime-explicit' });
    const ordinary = await execute({ name: 'same-abi-runtime-ordinary', ordinary: true });
    const npmExplicit = await execute({ name: 'npm-versus-shell-explicit', npm: true });
    const npmOrdinary = await execute({ name: 'npm-versus-shell-ordinary', npm: true, ordinary: true });
    await execute({ name: 'npm-aligned-metadata-control', npm: true, correct: true });
    for (const [a, b] of [[explicit, ordinary], [npmExplicit, npmOrdinary]]) {
      for (const field of ['code', 'reason', 'mismatches', 'nextAction']) assert.deepEqual(a.bootstrap[field], b.bootstrap[field]);
      assert.deepEqual(a.recovery, b.recovery); assert.deepEqual(a.runtime, b.runtime);
    }
    const unsupported = [];
    for (const candidate of unsupportedNodes) {
      assert.equal(path.isAbsolute(candidate), true);
      const executable = fs.realpathSync(candidate), identity = await identify(executable);
      unsupported.push(identity);
      const reports = [];
      for (const ordinary of [false, true]) {
        const args = [path.join(root, 'diagnosis-probe.js'), ...(ordinary ? ['ordinary'] : [])];
        const result = await run(executable, args, root, directEnv);
        assert.equal(result.exitCode, 1); assert.equal(result.stderr, '');
        const report = JSON.parse(result.stdout); reports.push(report);
        assert.equal(report.bootstrap.ready, false);
        assert.equal(report.bootstrap.code, 'ERR_BOOTSTRAP_RUNTIME_UNSUPPORTED');
        assert.equal(report.runtime.actual, identity.node);
        assert.equal(fs.realpathSync(report.runtime.executable), executable);
        assert.equal(report.recovery.action, 'select-runtime');
        assert.equal(report.recovery.command, null);
        if (ordinary) {
          assert.equal(report.code, 'ERR_BOOTSTRAP_REQUIRED');
          assert.doesNotMatch(report.message, /npm run bootstrap/);
        } else {
          assert.equal(report.operationalReadiness, 'not-probed');
          assert.deepEqual(report.nextCommands, []);
        }
        cases.push({ name: `unsupported-${identity.node}-${ordinary ? 'ordinary' : 'explicit'}`, command: executable,
          args, cwd: root, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, report });
      }
      for (const field of ['code', 'reason', 'mismatches', 'nextAction']) assert.deepEqual(reports[0].bootstrap[field], reports[1].bootstrap[field]);
      assert.deepEqual(reports[0].recovery, reports[1].recovery);
      assert.deepEqual(reports[0].runtime, reports[1].runtime);
    }
    assert.deepEqual(watched.map(relative => [relative, digest(path.join(root, relative))]), before,
      'diagnosis and denied work never install, repair or refresh the original receipt');
    return { schemaVersion: 1, kind: 'actual-bootstrap-runtime-selection', ok: true,
      qualification: 'isolated-metadata-diagnosis-not-application-readiness', current, alternate, unsupported,
      npm: { cli: npmCli, sha256: digest(npmCli), version: JSON.parse(fs.readFileSync(path.resolve(npmCli, '../../package.json'))).version },
      watched: before, cases };
  } finally { await fixture.dispose(); }
};
