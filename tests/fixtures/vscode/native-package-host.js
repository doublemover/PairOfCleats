import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { analyzeLiteralText } from '../../../src/shared/text-analyzer.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';
import { validateVsixContainer } from '../../../tools/tooling/vsix-container.js';

assert.equal(process.platform, 'win32', 'Explicit actual Windows VS Code qualification.');
const args = process.argv.slice(2);
assert.ok(args.length === 4 && args[0] === '--host-dir' && args[2] === '--cli',
  'Explicit qualification requires --host-dir <verified portable editor> --cli <prepared installed CLI entrypoint>.');
const root = process.cwd(), code = path.join(path.resolve(args[1]), 'Code.exe'), cli = path.resolve(args[3]);
assert.notEqual(cli, path.join(root, 'bin/pairofcleats.js'), 'do not qualify a checkout-local CLI as a separate installation');
await fs.access(code); await fs.access(cli);
// Use the verified distribution's own launcher selection. Newer Windows
// releases place application code beneath a commit-named version directory.
const vendorLauncher = await fs.readFile(path.join(path.dirname(code), 'bin/code.cmd'), 'utf8');
const cliSelection = vendorLauncher.match(/"%~dp0\.\.\\Code\.exe"\s+"%~dp0\.\.\\([^"\r\n]+)"\s+%\*/i);
assert.ok(cliSelection, 'the official Windows launcher must identify its actual CLI module');
const editorCliModule = path.resolve(path.dirname(code), cliSelection[1]);
const cliRelative = path.relative(path.dirname(code), editorCliModule);
assert.ok(cliRelative && !path.isAbsolute(cliRelative) && cliRelative.split(path.sep)[0] !== '..');
await fs.access(editorCliModule);
const { dir } = await prepareIsolatedTestCacheDir('vscode-native-vsix');
console.log(`Actual VS Code fixture: ${dir}`);
const repo = path.join(dir, 'project'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
const profile = path.join(dir, 'profile'), extensions = path.join(dir, 'extensions'), probe = path.join(dir, 'probe');
await fs.mkdir(repo); await fs.mkdir(path.join(profile, 'User'), { recursive: true }); await fs.mkdir(extensions); await fs.mkdir(probe);
const env = applyTestEnv({ cacheRoot: cache, syncProcess: false, extraEnv: { PAIROFCLEATS_HOME: home,
  PAIROFCLEATS_TRUSTED_CONFIG: null, ELECTRON_RUN_AS_NODE: null } });
const run = async (command, values, name, options = {}) => {
  const result = await spawnSubprocess(command, values, { cwd: root, env, stdio: 'pipe', maxOutputBytes: 262144,
    timeoutMs: 8000, rejectOnNonZeroExit: false, ...options });
  await fs.writeFile(path.join(dir, name + '.json'), JSON.stringify(result, null, 2));
  assert.equal(result.exitCode, 0, result.stderr); return result;
};
const node = (values, name) => run(process.execPath, values, name);
const editorCli = (values, name) => run(code, [editorCliModule,
  '--user-data-dir', profile, '--extensions-dir', extensions, ...values], name,
{ env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2));
const query = 'qualificationneedle', sourceText = 'export function qualificationneedle(phasechange) { return phasechange; }\n';
const userConfig = { cache: { root: cache }, search: { annDefault: false }, indexing: { scm: { provider: 'none' } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } };
await write(path.join(repo, '.pairofcleats.json'), userConfig); await fs.writeFile(path.join(repo, 'needle.js'), sourceText);
await write(path.join(repo, 'jsconfig.json'), { compilerOptions: { noLib: true, types: [] },
  typeAcquisition: { enable: false }, files: ['needle.js'] });
const repoCacheRoot = resolveRepoCacheRootPath(repo, userConfig), buildId = 'native-vsix-fixture';
const { indexRoot, indexDir, manifest } = await createBaseIndex({ rootDir: path.join(repoCacheRoot, 'builds', buildId),
  semantic: true, manifestOverrides: { buildId, mode: 'code', stage: 'stage2' },
  chunkMeta: [{ id: 0, file: 'needle.js', start: 0, end: sourceText.length, startLine: 1, endLine: 1,
    kind: 'function', name: query, tokens: analyzeLiteralText(sourceText), phraseTokens: analyzeLiteralText(sourceText, { caseSensitive: true }) }],
  tokenPostings: { vocab: ['phasechange', query], postings: [[[0, 1]], [[0, 1]]], docLengths: [2], avgDocLen: 2, totalDocs: 1 },
  indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code', generatedAt: new Date().toISOString(),
    embeddings: { enabled: false, ready: false, pending: false } } });
const validation = await writeArtifactPublicationValidationReport({ buildRoot: indexRoot, outDir: indexDir, mode: 'code', buildId,
  pieceEntries: manifest.pieces, manifestPath: path.join(indexDir, 'pieces', 'manifest.json') });
await writeArtifactPublicationRecord({ buildRoot: indexRoot, outDir: indexDir, mode: 'code', buildId, stage: 'stage2',
  pieceEntries: manifest.pieces, manifestPath: path.join(indexDir, 'pieces', 'manifest.json'), publicationValidation: validation });
const lock = await acquireIndexLock({ repoCacheRoot, storageContext: { repoRoot: repo, userConfig } }); assert.ok(lock);
try { await promoteBuild({ repoRoot: repo, userConfig, buildId, buildRoot: indexRoot, stage: 'stage2', modes: ['code'] }); }
finally { await lock.release(); }
const indexed = await node([cli, 'search', query, '--repo', repo, '--mode', 'code', '--backend', 'memory', '--no-ann', '--json'], 'installed-cli-search');
assert.ok(JSON.parse(indexed.stdout).code.some(hit => hit.file === 'needle.js'));
const first = path.join(dir, 'package-a'), second = path.join(dir, 'package-b');
await node(['tools/package-vscode.js', '--out-dir', first], 'package-first');
await node(['tools/package-vscode.js', '--out-dir', second], 'package-second');
const archive = path.join(first, 'pairofcleats.vsix'), bytes = await fs.readFile(archive);
assert.deepEqual(await fs.readFile(path.join(second, 'pairofcleats.vsix')), bytes, 'actual packaging must remain deterministic');
const metadata = await validateVsixContainer(archive), extensionId = metadata.extensionId;
assert.equal(extensionId, 'pairofcleats.pairofcleats-search');
await write(path.join(profile, 'User/settings.json'), { 'update.mode': 'none', 'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true, 'git.openRepositoryInParentFolders': 'never',
  'workbench.startupEditor': 'none', 'pairofcleats.cliPath': cli,
  'pairofcleats.nodePath': process.execPath, 'pairofcleats.searchMode': 'code', 'pairofcleats.searchBackend': 'memory',
  'pairofcleats.searchAnn': false, 'pairofcleats.inlineHoverEnabled': false, 'pairofcleats.inlineDiagnosticsEnabled': false,
  'pairofcleats.inlineDecorationsEnabled': false });
await write(path.join(probe, 'package.json'), { name: 'poc-native-qualification', publisher: 'pairofcleats-tests',
  version: '0.0.1', engines: { vscode: '^1.86.0' }, main: 'extension.cjs' });
await fs.writeFile(path.join(probe, 'extension.cjs'), 'exports.activate = () => {};\n');
await fs.copyFile(path.join(root, 'tests/helpers/vscode/native-package-probe.cjs'), path.join(probe, 'native-package-probe.cjs'));
await write(path.join(dir, 'probe-input.json'), { extensionId, extensionsDirectory: extensions, repo, cli, node: process.execPath, query });
await write(path.join(dir, 'launch.json'), { executable: code, arguments: ['--new-window', '--disable-gpu', '--disable-workspace-trust',
  '--skip-welcome', '--skip-release-notes', '--user-data-dir', profile, '--extensions-dir', extensions,
  '--extensionDevelopmentPath=' + probe, '--extensionTestsPath=' + path.join(probe, 'native-package-probe.cjs'), repo] });
await editorCli(['--install-extension', archive], 'install-vsix');
let hostStarted = false, failed = false, primary, qualified;
try {
  const listed = await editorCli(['--list-extensions', '--show-versions'], 'installed-extensions');
  assert.ok(listed.stdout.split(/\r?\n/).includes(extensionId + '@' + metadata.version));
  hostStarted = true;
  await run('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/helpers/vscode/native-host.ps1'), dir],
    'native-host', { timeoutMs: 24000 });
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'host-receipt.json'), 'utf8'));
  assert.equal(receipt.forcedTermination, false); assert.equal(receipt.resourcesReaped, true);
  assert.equal(receipt.privateWindowObserved, true); assert.equal(receipt.inputDesktopWindowObserved, false);
  assert.equal(receipt.privateHandleClosed, true); assert.equal(receipt.originalThreadRestored, true);
  assert.ok(receipt.children.some(child => child.name === 'node' && child.exited), 'observe the actual external CLI child and its natural exit');
  const result = JSON.parse(await fs.readFile(path.join(dir, 'probe-result.json'), 'utf8'));
  assert.ok(result.hits.some(hit => hit.file === 'needle.js'));
  qualified = { candidate: { vsixSha256: hash(bytes), cliSha256: hash(await fs.readFile(cli)),
    externalNode: process.version, codeSha256: hash(await fs.readFile(code)) }, metadata, result, receipt };
} catch (error) { failed = true; primary = error; }
try {
  if (hostStarted) {
    const receipt = JSON.parse(await fs.readFile(path.join(dir, 'host-receipt.json'), 'utf8'));
    assert.equal(receipt.resourcesReaped, true, 'do not uninstall while native host closure is unknown');
  }
  await editorCli(['--uninstall-extension', extensionId], 'uninstall-vsix');
  const absent = await editorCli(['--list-extensions'], 'extensions-after-uninstall');
  assert.ok(!absent.stdout.split(/\r?\n/).includes(extensionId));
  if (!failed) {
    await write(path.join(dir, 'probe-input.json'), { extensionId, mode: 'absent', commands: qualified.result.registeredCommands });
    await run('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/helpers/vscode/native-host.ps1'), dir],
      'native-uninstalled-host', { timeoutMs: 24000 });
    const receipt = JSON.parse(await fs.readFile(path.join(dir, 'host-receipt.json'), 'utf8'));
    assert.equal(receipt.forcedTermination, false); assert.equal(receipt.resourcesReaped, true);
    assert.equal(receipt.privateWindowObserved, true); assert.equal(receipt.inputDesktopWindowObserved, false);
    assert.equal(receipt.privateHandleClosed, true); assert.equal(receipt.originalThreadRestored, true);
    const observation = JSON.parse(await fs.readFile(path.join(dir, 'probe-absent-result.json'), 'utf8'));
    assert.equal(observation.extensionAbsent, true); assert.equal(observation.registeredTargetCommands, 0);
    qualified.uninstall = { listAbsent: true, freshHost: observation, receipt };
    await write(path.join(dir, 'qualification.json'), qualified);
  }
} catch (cleanup) { throw failed ? new AggregateError([primary, cleanup], 'Native VS Code qualification and cleanup failed.', { cause: primary }) : cleanup; }
if (failed) throw primary;
console.log(JSON.stringify({ fixture: dir, vsixSha256: hash(bytes), extensionId, installedActivatedSearchedUninstalled: true }));
