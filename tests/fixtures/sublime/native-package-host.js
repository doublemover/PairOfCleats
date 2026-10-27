import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildDeterministicZip } from '../../../tools/tooling/archive-determinism.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { analyzeLiteralText } from '../../../src/shared/text-analyzer.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';

assert.equal(process.platform, 'win32', 'This owner qualifies an actual isolated Windows Sublime host.');
const args = process.argv.slice(2);
assert.ok(args.length === 4 && args[0] === '--case' && args[2] === '--host-dir',
  'Explicit native UI qualification: --case packed|unpacked|legacy-and-shadow --host-dir <runtime>. This opens editor windows.');
const selected = args[1];
assert.ok(['packed', 'unpacked', 'legacy-and-shadow'].includes(selected));
const originalHost = path.resolve(args[3]);
await fs.access(path.join(originalHost, 'sublime_text.exe'));
const { dir } = await prepareIsolatedTestCacheDir(`sublime-native-${selected}`), root = process.cwd();
console.log(`Actual Sublime fixture: ${dir}`);
const host = path.join(dir, 'host'), data = path.join(host, 'Data'), packages = path.join(data, 'Packages');
const user = path.join(packages, 'User'), installed = path.join(data, 'Installed Packages');
const probe = path.join(packages, 'PoCNativeQualification');
const repo = path.join(dir, 'fixture repository'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fs.mkdir(user, { recursive: true }); await fs.mkdir(probe); await fs.mkdir(installed); await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: cache, syncProcess: false, extraEnv: {
  PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null,
  APPDATA: path.join(dir, 'appdata'), LOCALAPPDATA: path.join(dir, 'local-appdata') } });
const run = (command, values, options = {}) => spawnSubprocess(command, values, { cwd: root, env,
  stdio: 'pipe', maxOutputBytes: 65536, timeoutMs: 10000, rejectOnNonZeroExit: false, ...options });
const node = async values => { const result = await run(process.execPath, values); assert.equal(result.exitCode, 0, result.stderr); return result; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value));
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const deadline = Date.now() + 27000;
const wait = async (predicate, label) => {
  while (!await predicate()) { assert.ok(Date.now() < deadline, `${selected}: ${label}`); await new Promise(resolve => setTimeout(resolve, 25)); }
};
let launching = null, finished = false;
try {
  const userConfig = { cache: { root: cache }, search: { annDefault: false },
    indexing: { typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
      postings: { enablePhraseNgrams: false, enableChargrams: false, fielded: false },
      embeddings: { hnsw: { enabled: false }, lancedb: { enabled: false } },
      scm: { provider: 'none' } }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } };
  await writeJson(path.join(repo, '.pairofcleats.json'), userConfig);
  const sourceText = 'export function qualificationneedle(phasechange) { return phasechange; }\n';
  await fs.writeFile(path.join(repo, 'needle.js'), sourceText);
  const repoCacheRoot = resolveRepoCacheRootPath(repo, userConfig), buildId = 'native-editor-fixture';
  const { indexRoot, indexDir, manifest } = await createBaseIndex({ rootDir: path.join(repoCacheRoot, 'builds', buildId),
    semantic: true, manifestOverrides: { buildId, mode: 'code', stage: 'stage2' },
    chunkMeta: [{ id: 0, file: 'needle.js', start: 0, end: sourceText.length, startLine: 1, endLine: 1, kind: 'function', name: 'qualificationneedle',
      tokens: analyzeLiteralText(sourceText), phraseTokens: analyzeLiteralText(sourceText, { caseSensitive: true }) }],
    tokenPostings: { vocab: ['phasechange', 'qualificationneedle'], postings: [[[0, 1]], [[0, 1]]], docLengths: [2], avgDocLen: 2, totalDocs: 1 },
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code', generatedAt: new Date().toISOString(),
      embeddings: { enabled: false, ready: false, pending: false } } });
  const validation = await writeArtifactPublicationValidationReport({ buildRoot: indexRoot, outDir: indexDir, mode: 'code', buildId,
    pieceEntries: manifest.pieces, manifestPath: path.join(indexDir, 'pieces', 'manifest.json') });
  await writeArtifactPublicationRecord({ buildRoot: indexRoot, outDir: indexDir, mode: 'code', buildId, stage: 'stage2',
    pieceEntries: manifest.pieces, manifestPath: path.join(indexDir, 'pieces', 'manifest.json'), publicationValidation: validation });
  const lock = await acquireIndexLock({ repoCacheRoot, storageContext: { repoRoot: repo, userConfig } }); assert.ok(lock);
  try { await promoteBuild({ repoRoot: repo, userConfig, buildId, buildRoot: indexRoot, stage: 'stage2', modes: ['code'] }); }
  finally { await lock.release(); }
  for (const query of ['qualificationneedle', 'qualificationneedle phasechange']) {
    const indexed = await node(['bin/pairofcleats.js', 'search', query, '--repo', repo, '--mode', 'code', '--backend', 'memory', '--no-ann', '--json']);
    assert.match(indexed.stdout, /needle\.js/, 'the same actual CLI queries must work before editor qualification');
  }
  const out = path.join(dir, 'distribution');
  const packed = JSON.parse((await node(['tools/package-sublime.js', '--out-dir', out, '--smoke'])).stdout);
  const archive = path.resolve(root, packed.archive), originalBytes = await fs.readFile(archive);
  assert.equal(hash(originalBytes), packed.checksum);
  const zip = new AdmZip(originalBytes), entries = zip.getEntries().map(entry => entry.entryName);
  assert.ok(entries.includes('plugin.py') && entries.includes('editor-config-contract.json'));
  assert.ok(!entries.some(name => path.posix.isAbsolute(name) || name.split('/').includes('..') || name.startsWith('PairOfCleats/')));
  const contractHash = hash(zip.readFile('editor-config-contract.json'));
  const source = path.join(dir, 'source'); await fs.mkdir(source); zip.extractAllTo(source);
  const installedArchive = path.join(installed, 'PairOfCleats.sublime-package'), loose = path.join(packages, 'PairOfCleats');
  if (selected === 'packed') await fs.copyFile(archive, installedArchive);
  else {
    await fs.cp(source, loose, { recursive: true });
    if (selected === 'legacy-and-shadow') await buildDeterministicZip({ sourceDir: source,
      archivePath: path.join(installed, 'pairofcleats.sublime-package'), rootPrefix: 'PairOfCleats' });
  }
  for (const entry of await fs.readdir(originalHost, { withFileTypes: true })) {
    if (entry.isDirectory() && ['Lib', 'Packages'].includes(entry.name)
      || entry.isFile() && (/\.dll$/i.test(entry.name) || ['sublime_text.exe', 'plugin_host-3.3.exe', 'plugin_host-3.8.exe', 'crash_handler.exe'].includes(entry.name))) {
      await fs.cp(path.join(originalHost, entry.name), path.join(host, entry.name), { recursive: entry.isDirectory() });
    }
  }
  const executable = path.join(host, 'sublime_text.exe');
  assert.equal(hash(await fs.readFile(executable)), hash(await fs.readFile(path.join(originalHost, 'sublime_text.exe'))));
  const project = path.join(dir, 'qualification.sublime-project'); await writeJson(project, { folders: [{ path: repo }] });
  await writeJson(path.join(user, 'Preferences.sublime-settings'), { update_check: false, index_files: false, hot_exit: false, telemetry_enabled: false });
  await writeJson(path.join(user, 'PairOfCleats.sublime-settings'), { pairofcleats_path: path.join(root, 'bin', 'pairofcleats.js'), node_path: process.execPath,
    index_mode_default: 'code', search_backend_default: 'memory', search_ann_default: false, search_prompt_options: false,
    open_results_in: 'output_panel', progress_panel_on_start: false,
    env: { PAIROFCLEATS_CACHE_ROOT: cache, PAIROFCLEATS_HOME: home, PAIROFCLEATS_TESTING: '1' } });
  await fs.copyFile(path.join(root, 'tests/helpers/sublime/native_host_probe.py'), path.join(probe, 'native_probe.py'));
  await writeJson(path.join(probe, 'native-qualification.json'), { fixture: dir, packages, project });
  const rpc = async (action, fields = {}) => {
    const id = randomUUID(), target = path.join(dir, 'request.json'), temporary = target + '.tmp';
    await writeJson(temporary, { id, action, ...fields }); await fs.rename(temporary, target);
    let response;
    await wait(async () => {
      try { const value = await readJson(path.join(dir, 'response.json')); if (value.id === id) { response = value; return true; } return false; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }, `native ${action} response`);
    assert.equal(response.ok, true, response.error); return response.result;
  };
  launching = run('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/helpers/sublime/native-host.ps1'),
    executable, project, dir], { timeoutMs: 28000 }); launching.catch(() => {});
  const inspectUntil = async predicate => {
    let observation;
    await wait(async () => { observation = await rpc('inspect'); return predicate(observation); }, 'native package state');
    return observation;
  };
  const initial = await inspectUntil(value => value.windowReady);
  await writeJson(path.join(dir, 'initial-host.json'), initial);
  assert.ok(initial.pluginFile, JSON.stringify(initial));
  assert.equal(initial.contractSha256, contractHash);
  const expectedCommands = JSON.parse(zip.readAsText('Default.sublime-commands')).map(entry => entry.command);
  for (const command of expectedCommands) assert.ok(initial.commands.includes(command), `native command not registered: ${command}`);
  assert.equal(new Set(initial.commands).size, initial.commands.length, 'one package revision registers each command once');
  if (selected === 'legacy-and-shadow') {
    assert.ok(initial.diagnostics.some(message => message.includes('Legacy package identity')));
    assert.ok(initial.diagnostics.some(message => message.includes('archive root')));
    assert.ok(initial.diagnostics.some(message => message.includes('Loose files')));
  } else assert.deepEqual(initial.diagnostics, []);
  const search = async query => {
    await rpc('search', { query });
    const observation = await inspectUntil(value => value.results?.query === query);
    assert.ok(observation.results.hits?.some(hit => hit.file?.endsWith('needle.js')), JSON.stringify(observation.results));
    return observation.results;
  };
  const firstSearch = await search('qualificationneedle');
  const captured = await rpc('capture'); assert.equal(captured.oldScopeCurrent, true);
  await rpc('disable'); const disabled = await inspectUntil(value => value.commands.length === 0);
  assert.equal(disabled.oldScopeCurrent, false, 'actual plugin_unloaded revokes its original operation scope');
  const changedPlugin = Buffer.concat([zip.readFile('plugin.py'), Buffer.from('\n# Native qualification update witness.\n')]);
  await fs.writeFile(path.join(source, 'plugin.py'), changedPlugin);
  if (selected === 'packed') {
    const updated = path.join(dir, 'updated.sublime-package');
    await buildDeterministicZip({ sourceDir: source, archivePath: updated, rootPrefix: '' });
    await fs.copyFile(updated, installedArchive);
  } else await fs.writeFile(path.join(loose, 'plugin.py'), changedPlugin);
  await rpc('enable'); const reloaded = await inspectUntil(value => value.rootReloaded && value.commands.includes('pair_of_cleats_search'));
  assert.equal(reloaded.active, true); assert.equal(reloaded.contractSha256, contractHash);
  assert.equal(new Set(reloaded.commands).size, reloaded.commands.length);
  const secondSearch = await search('qualificationneedle phasechange');
  await rpc('capture'); await rpc('disable'); const removed = await inspectUntil(value => value.commands.length === 0);
  assert.equal(removed.oldScopeCurrent, false);
  if (selected === 'packed') await fs.unlink(installedArchive);
  else await fs.rm(loose, { recursive: true });
  const uninstalled = await rpc('inspect'); assert.deepEqual(uninstalled.commands, []);
  await rpc('quit'); const exit = await launching; finished = true; assert.equal(exit.exitCode, 0, exit.stderr);
  const lifetime = await readJson(path.join(dir, 'host-exit.json'));
  await wait(() => !isProcessAlive(lifetime.pid) && lifetime.children.every(child => !isProcessAlive(child.pid)), 'native host process reaping');
  await writeJson(path.join(dir, 'qualification-receipt.json'), { selected, archiveSha256: packed.checksum,
    hostBuild: initial.hostBuild, python: initial.python, hostExecutableSha256: hash(await fs.readFile(executable)),
    initial, reloaded, uninstalled, firstSearch, secondSearch, lifetime });
  console.log(`Actual Sublime package qualification passed: ${JSON.stringify({ selected, hostBuild: initial.hostBuild, archiveSha256: packed.checksum,
    commandCount: initial.commands.length, receipt: path.join(dir, 'qualification-receipt.json') })}`);
} finally {
  if (launching && !finished) {
    await writeJson(path.join(dir, 'request.json'), { id: randomUUID(), action: 'quit' });
    await launching.catch(() => {});
  }
}
