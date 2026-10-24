import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { buildSearchRequestArgs } from '../../src/shared/search-request.js';
import { loadUserConfig } from '../../src/shared/dict-utils.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { freezeSnapshot } from '../../src/index/snapshots/freeze.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tui/native-index-workflows/')[1];
assert.ok(['build-search', 'validate-search', 'watch-cancel', 'build-cancel', 'preview-cancel', 'workspace', 'snapshot',
  'snapshot-create', 'snapshot-show', 'snapshot-freeze', 'snapshot-remove', 'snapshot-prune', 'snapshot-gc',
  'report', 'stats', 'missing-model', 'invalid-provider', 'stale'].includes(mode));
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`native-index-${mode}`);
const repo = path.join(dir, 'selected repository'); await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'answer.js'), 'export function nativeWorkflowAnswer() { return 42; }\n');
const config = path.join(repo, '.pairofcleats.json');
const original = { threads: 1, quality: 'fast',
  ...(mode === 'missing-model' || mode === 'invalid-provider' ? {
    models: { dir: path.join(dir, 'absent-models'), id: 'fixture/absent-model' },
    indexing: { embeddings: { mode: 'inline', provider: mode === 'invalid-provider' ? 'unavailable-fixture-provider' : 'onnx' } }
  } : {}) };
await fs.writeFile(config, JSON.stringify(original));
const workspace = path.join(dir, 'workspace.jsonc');
if (mode === 'workspace') await fs.writeFile(workspace, JSON.stringify({ schemaVersion: 1,
  name: 'native index workspace', repos: [{ root: repo }] }));
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: true,
  embeddings: ['missing-model', 'invalid-provider'].includes(mode) ? null : 'stub',
  testConfig: { threads: 1, indexing: { typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false,
    scm: { provider: 'none' } }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]),
    PAIROFCLEATS_TUI_NODE: process.execPath,
    PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tests/fixtures/tui/native-workflow-supervisor.js'),
    PAIROFCLEATS_TUI_WORKSPACE_ROOT: repo, PAIROFCLEATS_TUI_RUN_ID: 'index-workflow-native',
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir, PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json') } });
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug', process.platform === 'win32' ? 'pairofcleats-tui.exe' : 'pairofcleats-tui');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
await fs.writeFile(path.join(dir, 'native-source-identity.json'), JSON.stringify({ binary, binarySha256,
  node: process.version, abi: process.versions.modules, platform: process.platform }, null, 2));
const lines = async name => {
  try { const text = await fs.readFile(path.join(dir, name), 'utf8');
    return text.slice(0, text.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const phase = 'all';
let eventSignature = null, cachedEvents = [];
const events = async () => {
  let stat;
  try { stat = await fs.stat(path.join(dir, `index-workflow-native-${phase}.jsonl`), { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  if (signature === eventSignature) return cachedEvents;
  const rows = await lines(`index-workflow-native-${phase}.jsonl`), chunks = new Map();
  for (const row of [...rows]) {
    if (row.event !== 'event:chunk') continue;
    const parts = chunks.get(row.chunkId) || new Map(); parts.set(row.chunkIndex, row.chunk); chunks.set(row.chunkId, parts);
    if (parts.size === row.chunkCount) rows.push(JSON.parse(Array.from({ length: row.chunkCount }, (_, i) => parts.get(i)).join('')));
  }
  eventSignature = signature; cachedEvents = rows; return rows;
};
const columns = 220, rows = 48;
const cli = async (args, name) => {
  const result = await spawnSubprocess(process.execPath, [path.join(root, 'bin/pairofcleats.js'), ...args],
    { cwd: root, env, timeoutMs: 20000, maxOutputBytes: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(result, null, 2));
  assert.equal(result.exitCode, 0, result.stderr); return result;
};
const needsCompleteSeed = mode.startsWith('snapshot-') || ['validate-search', 'report', 'stats'].includes(mode);
if (['build-search', 'workspace'].includes(mode)) {
  await cli(['index', 'build', '--repo', repo, '--mode=code', '--stage=stage2', '--threads=1', '--stub-embeddings', '--progress=off'], 'seed-partial-build');
}
if (needsCompleteSeed) {
  await cli(['index', 'build', '--repo', repo, '--mode=code', '--threads=1', '--stub-embeddings', '--progress=off'], 'seed-complete-build');
}
// Setup calls the same canonical owners as the snapshot CLI. The operations
// under test still traverse the actual keyboard, supervisor and public CLI.
// Avoid spending multiple CLI startups merely preparing their input snapshots.
const seedSnapshot = async (snapshotId, name, metadata = {}) => {
  const input = { repoRoot: repo, userConfig: loadUserConfig(repo, { env }), snapshotId, modes: ['code'], ...metadata };
  const result = await createPointerSnapshot(input);
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ owner: 'createPointerSnapshot', input, result }, null, 2));
};
if (mode === 'snapshot-show') {
  await seedSnapshot('snap-native-created', 'seed-labeled-snapshot', { tags: ['native-test', 'operator'], label: 'native label' });
}
if (['snapshot-freeze', 'snapshot-remove', 'snapshot-prune', 'snapshot-gc'].includes(mode)) {
  await seedSnapshot('snap-native-kept', 'seed-snapshot');
}
if (mode === 'snapshot-remove') {
  const input = { repoRoot: repo, userConfig: loadUserConfig(repo, { env }), snapshotId: 'snap-native-kept', modes: ['code'] };
  const result = await freezeSnapshot(input);
  await fs.writeFile(path.join(dir, 'seed-frozen-snapshot.json'), JSON.stringify({ owner: 'freezeSnapshot', input, result }, null, 2));
}
if (['snapshot-prune', 'snapshot-gc'].includes(mode)) {
  await seedSnapshot('snap-native-new', 'seed-newer-snapshot');
}
const fixtureDeadline = Date.now() + 22000;
try {
  const launcher = process.platform === 'win32'
    ? { command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, mode] }
    : { command: 'python3', args: [path.join(root, 'tests/fixtures/tui/native-terminal.py'), binary, dir, mode] };
  const capture = await captureCommandTerminalRun({ ...launcher, rootDir: root, cwd: root, cols: columns, rows,
    label: `native-index-${mode}-${phase}`, logsRoot: path.join(dir, 'capture'), timeoutMs: 26000,
    env: { ...env, PAIROFCLEATS_TUI_RUN_ID: `index-workflow-native-${phase}` },
    onSpawn: async terminal => {
      let output = '', tail = '', frame = 0;
      const subscription = terminal.onData(data => {
        output = (output + data).slice(-2 * 1024 * 1024);
        if (process.platform !== 'win32') {
          const wire = tail + data;
          for (let count = wire.split('\x1b[6n').length - 1; count > 0; count--) terminal.write('\x1b[1;1R');
          tail = wire.slice(-3);
        }
      });
      const deadline = Math.min(Date.now() + 22000, fixtureDeadline);
      const wait = async (predicate, label) => {
        while (!await predicate()) { assert.ok(Date.now() < deadline, `Native index witness timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 20)); }
      };
      let paintedOutput = null, paintedScreen = '';
      const screen = () => {
        if (paintedOutput !== output) { paintedOutput = output; paintedScreen = reconstructTerminalScreen(output, { columns, rows }).text; }
        return paintedScreen;
      };
      const rendered = async label => { await wait(() => screen().includes(label), label); await fs.writeFile(path.join(dir, `screen-${frame++}.txt`), screen()); };
      const last = async prefix => Math.max(0, ...(await events()).filter(row => row.jobId?.startsWith(prefix)).map(row => Number(row.jobId.split('-').at(-1))));
      const settled = async (prefix, method, after) => {
        let end;
        await wait(async () => {
          end = (await events()).find(row => row.event === 'job:end' && row.jobId?.startsWith(prefix)
            && Number(row.jobId.split('-').at(-1)) > after && (row.result?.method === method || ['failed', 'cancelled'].includes(row.status)));
          return end;
        }, `${method} actual response`);
        assert.equal(end.status, 'done', JSON.stringify(end)); return end.result.data;
      };
      const operation = async (method, input) => { const after = await last('native-workflow-'); terminal.write(input); return settled('native-workflow-', method, after); };
      const currentStatus = async () => {
        const result = await operation('status', 't');
        await rendered('Published generation observation; independent of process success');
        return result;
      };
      let catalog;
      const choose = async id => {
        const commands = catalog.commands.filter(command => command.scopeKind === (mode === 'workspace' ? 'workspace' : 'repo'));
        const index = commands.findIndex(command => command.id === id); assert.ok(index >= 0);
        terminal.write('\x1b[A'.repeat(commands.length) + '\x1b[B'.repeat(index) + '\r');
        await rendered(`Typed form: ${id}`); return commands[index];
      };
      const edit = async (command, name, value) => {
        const index = command.fields.findIndex(field => field.name === name); assert.ok(index >= 0);
        terminal.write('\x1b[A'.repeat(command.fields.length) + '\x1b[B'.repeat(index) + '\r');
        await rendered(`Edit ${name} as JSON`); terminal.write(`\x15${JSON.stringify(value)}\r`);
        await rendered(`Typed form: ${command.id}`);
      };
      const run = async (id, values = {}) => {
        const command = await choose(id);
        for (const [key, value] of Object.entries(values)) await edit(command, key, value);
        const preview = await operation('preview', 'p'); assert.equal(preview.launchable, true, JSON.stringify(preview));
        await rendered('Launch preview ready; Enter confirms, Esc discards');
        const launch = await operation('launch', '\r'); assert.equal(launch.launched, true);
        assert.equal(launch.jobId, preview.plannedJobId);
        assert.deepEqual(launch.canonicalArgv, preview.canonicalArgv);
        await wait(() => screen().includes('Owned job admitted; c cancels.')
          || screen().includes('Process ended; inspect publication evidence separately'), 'actual launch response rendered');
        return { launch, preview };
      };
      const finish = async jobId => {
        let end; await wait(async () => { end = (await events()).find(row => row.event === 'job:end' && row.jobId === jobId); return end; }, 'actual owned job end'); return end;
      };
      const backToCatalog = async () => { terminal.write('\x1b'); await rendered('Arrows select | Enter opens typed form'); };
      const closeCatalog = async () => { terminal.write('\x1b'); await rendered('Tab focus'); };
      try {
        await rendered('Tab focus');
        terminal.write('b'); await rendered('Workflow scope: repository directory');
        const after = await last('native-workflow-');
        terminal.write(`${mode === 'workspace' ? '\t' : ''}\x15${mode === 'workspace' ? workspace : repo}\r`);
        catalog = await settled('native-workflow-', 'describe', after); await rendered('Canonical index/workspace catalog loaded');
        if (mode === 'validate-search') {
          const status = await currentStatus(); assert.equal(status.publications[0].ready, true);
          await backToCatalog(); const validation = await run('index.validate', { mode: 'code' });
          const validated = await finish(validation.launch.jobId); assert.equal(validated.status, 'done', JSON.stringify(validated)); assert.equal(validated.result.ok, true);
          await rendered('Process ended; inspect publication evidence separately'); await backToCatalog(); await closeCatalog();
          terminal.write('R'); await rendered('Ready; Enter runs a canonical search');
          const searchAfter = await last('native-search-');
          terminal.write('nativeWorkflowAnswer\t\x15code\t\x15memory\t\x155\t\t\t\x15{"ann":false}\r');
          const search = await settled('native-search-', 'query', searchAfter);
          assert.ok(search.hits.some(hit => hit.file === 'answer.js'), JSON.stringify(search));
          await rendered('answer.js'); terminal.write('\x1b'); await rendered('Tab focus'); terminal.write('q');
        } else if (['missing-model', 'invalid-provider'].includes(mode)) {
          await choose('index.build'); const preview = await operation('preview', 'p');
          assert.equal(preview.launchable, false); assert.equal(preview.previewId, undefined);
          assert.match(JSON.stringify(preview.errors), mode === 'missing-model' ? /missing or unreadable/ : /Unknown provider/);
          await rendered('Launch blocked'); terminal.write('\r');
          assert.equal((await events()).some(row => row.event === 'job:start' && row.jobId?.startsWith('workflow-')), false);
          terminal.write('\x1b'); await rendered('Typed form: index.build'); await backToCatalog(); await closeCatalog(); terminal.write('q');
        } else if (mode === 'snapshot') {
          const { launch } = await run('index.snapshot.list'); const end = await finish(launch.jobId);
          assert.equal(end.status, 'done', JSON.stringify(end)); assert.deepEqual(end.result.snapshots, []);
          await rendered('Process ended; inspect publication evidence separately'); await backToCatalog(); await closeCatalog(); terminal.write('q');
        } else if (mode.startsWith('snapshot-') || ['report', 'stats'].includes(mode)) {
          const completed = async (id, values) => {
            const { launch } = await run(id, values), end = await finish(launch.jobId);
            assert.equal(end.status, 'done', JSON.stringify(end)); assert.equal(end.resultState, 'complete');
            assert.equal(end.workflow.publications[0].ready, null, 'read/maintenance process success cannot claim index readiness');
            await rendered('Process ended; inspect publication evidence separately'); await backToCatalog(); return end.result;
          };
          if (mode === 'snapshot-create') {
            const created = await completed('index.snapshot.create', { id: 'snap-native-created', modes: 'code', tag: ['native-test', 'operator'], label: 'native label' });
            assert.equal(created.ok, true); assert.equal(created.snapshot.snapshotId, 'snap-native-created');
            const listed = await completed('index.snapshot.list', {}); assert.ok(listed.snapshots.some(row => row.snapshotId === 'snap-native-created'));
          } else if (mode === 'snapshot-show') {
            const shown = await completed('index.snapshot.show', { snapshotId: 'snap-native-created' });
            assert.equal(shown.snapshot.label, 'native label'); assert.deepEqual(shown.snapshot.tags, ['native-test', 'operator']);
          } else if (mode === 'snapshot-freeze') {
            const frozen = await completed('index.snapshot.freeze', { snapshotId: 'snap-native-kept', modes: 'code' });
            assert.equal(frozen.ok, true); assert.equal(frozen.freeze.snapshotId, 'snap-native-kept');
            const listed = await completed('index.snapshot.list', {});
            assert.equal(listed.snapshots.find(row => row.snapshotId === 'snap-native-kept').hasFrozen, true);
          } else if (mode === 'snapshot-remove') {
            const removed = await completed('index.snapshot.remove', { snapshotId: 'snap-native-kept', force: true });
            assert.equal(removed.removed, 'snap-native-kept');
            const listed = await completed('index.snapshot.list', {}); assert.deepEqual(listed.snapshots, []);
          } else if (['snapshot-prune', 'snapshot-gc'].includes(mode)) {
            if (mode === 'snapshot-prune') {
              const pruned = await completed('index.snapshot.prune', { 'dry-run': true, 'max-pointer-snapshots': 1 });
              assert.equal(pruned.dryRun, true); assert.ok(pruned.removed.includes('snap-native-kept'));
              assert.ok(!pruned.removed.includes('snap-native-new'));
            } else {
              const gc = await completed('index.snapshot.gc', { 'dry-run': true, 'keep-pointer': 1, 'keep-frozen': 0, 'max-age-days': 0 });
              assert.equal(gc.gc.dryRun, true); assert.ok(gc.gc.removed.includes('snap-native-kept'));
              assert.ok(!gc.gc.removed.includes('snap-native-new'));
            }
            const listed = await completed('index.snapshot.list', {});
            assert.deepEqual(listed.snapshots.map(row => row.snapshotId).sort(), ['snap-native-kept', 'snap-native-new']);
          } else if (mode === 'stats') {
            const stats = await completed('index.stats', { mode: 'code', verify: true });
            assert.equal(stats.verify.ok, true); assert.ok(stats.modes.code.chunkMeta.rows > 0);
            assert.deepEqual(stats.verify.warnings, [], 'a valid full index must not emit checksum warnings');
          } else {
            const report = await completed('index.report', {});
            assert.ok(report.repo.artifacts.indexCode > 0); assert.equal(report.corruption.modes.code.ok, true);
          }
          await closeCatalog(); terminal.write('q');
        } else if (mode === 'preview-cancel') {
          await choose('index.build'); const preview = await operation('preview', 'p'); assert.equal(preview.launchable, true);
          await rendered('Launch preview ready; Enter confirms, Esc discards');
          const discarded = await operation('discard', '\x1b'); assert.equal(discarded.discarded, true);
          assert.equal((await events()).some(row => row.event === 'job:start' && row.jobId?.startsWith('workflow-')), false);
          await backToCatalog(); await closeCatalog(); terminal.write('q');
        } else {
          const id = mode === 'workspace' ? 'workspace.build' : mode === 'watch-cancel' ? 'index.watch' : 'index.build';
          if (['build-search', 'workspace'].includes(mode)) {
            const partial = await currentStatus();
            assert.equal(partial.publications[0].published, true); assert.equal(partial.publications[0].ready, false);
            assert.ok(partial.publications[0].currentValidation.issues.some(issue => issue.includes('db missing')));
            await backToCatalog();
          }
          const values = { mode: 'code', threads: 1, 'stub-embeddings': true,
            ...(['build-search', 'workspace'].includes(mode) ? { stage: 'stage4' } : {}),
            ...(mode === 'workspace' ? { concurrency: 1 } : {}) };
          if (mode === 'stale') {
            const command = await choose(id); for (const [key, value] of Object.entries(values)) await edit(command, key, value);
            const preview = await operation('preview', 'p'); assert.equal(preview.launchable, true);
            await rendered('Launch preview ready; Enter confirms, Esc discards');
            await fs.writeFile(config, JSON.stringify({ ...original, threads: 3 }));
            const launch = await operation('launch', '\r'), end = await finish(launch.jobId);
            assert.equal(end.status, 'failed'); assert.equal(end.error.code, 'ERR_TUI_WORKFLOW_STALE');
            assert.equal((await events()).some(row => row.jobId === launch.jobId && row.event === 'job:spawn'), false);
            assert.equal(end.workflow.publications[0].producedReadyGeneration, false);
          } else {
            const { launch } = await run(id, values);
            if (['watch-cancel', 'build-cancel'].includes(mode)) {
              await wait(async () => (await events()).some(row => row.jobId === launch.jobId
                && (mode === 'watch-cancel' ? row.event === 'log' && row.message?.includes('[watch] Monitoring') : row.event === 'task:start')), 'real owned work started');
              terminal.write('c'); const end = await finish(launch.jobId); assert.equal(end.status, 'cancelled');
              assert.equal(end.workflow.publications[0].producedReadyGeneration, false);
            } else {
              const end = await finish(launch.jobId); assert.equal(end.status, 'done', JSON.stringify(end));
              assert.equal(end.workflow.publications[0].producerContractValid, true, JSON.stringify(end.workflow));
              assert.equal(end.workflow.publications[0].producedReadyGeneration, true, JSON.stringify(end.workflow));
              assert.ok(end.workflow.publications[0].generation.generationKey);
            }
          }
          await rendered('Process ended; inspect publication evidence separately'); await backToCatalog(); await closeCatalog(); terminal.write('q');
        }
      } finally { subscription.dispose(); await fs.writeFile(path.join(dir, `terminal-output-${phase}.ansi.log`), output); }
    } });
  assert.equal(capture.timedOut, false); assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0); assert.equal(receipt.stderr, ''); assert.equal(receipt.terminalRestored, true);
  await fs.writeFile(path.join(dir, `terminal-receipt-${phase}.json`), JSON.stringify(receipt));
  const recorded = await lines('pids.jsonl');
  const owned = [...new Set(recorded.flatMap(row => ['native', 'proxy', 'supervisor', 'job'].map(key => row[key]).filter(Number.isInteger)))];
  assert.deepEqual(owned.filter(isProcessAlive), []);
  assert.ok(recorded.some(row => row.request?.op === 'workflow:run' && row.request.method === 'preview'));
  assert.deepEqual((await events()).filter(event => event.event === 'log' && ['warn', 'error'].includes(event.level)), []);
  console.log(JSON.stringify({ mode, binarySha256, node: process.version, platform: process.platform, owned, receipt, capture: capture.outputDir }));
  if (mode === 'build-search') {
    const validation = JSON.parse((await cli(['index', 'validate', '--repo', repo, '--mode=code', '--json'], 'produced-validation')).stdout);
    assert.equal(validation.ok, true);
    const built = buildSearchRequestArgs({ query: 'nativeWorkflowAnswer', backend: 'memory', mode: 'code', ann: false },
      { includeRepo: true, repoPath: repo, defaultOutput: 'compact', allowedOutputs: ['compact'] });
    assert.equal(built.ok, true);
    const queried = JSON.parse((await cli(['search', ...built.args, '--', built.query], 'produced-search')).stdout);
    assert.ok(queried.code.some(hit => hit.file === 'answer.js'), JSON.stringify(queried));
  }
} finally {
  for (const row of await lines('pids.jsonl')) if (row.proxy && isProcessAlive(row.proxy)) await killProcessTree(row.proxy);
}
