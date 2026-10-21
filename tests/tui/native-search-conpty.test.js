import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';

assert.equal(process.platform, 'win32', 'This owner requires actual Windows ConPTY; POSIX needs its own PTY owner');
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tui/native-search-conpty/')[1];
assert.ok(['query-source', 'pagination', 'cancel', 'empty-error', 'replace', 'scope', 'navigation', 'truncated', 'modes', 'incompatible', 'narrow', 'interrupt', 'handshake'].includes(mode));
const columns = mode === 'narrow' ? 60 : 170, terminalRows = mode === 'narrow' ? 18 : 46;
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`native-search-${mode}`);
const repo = path.join(dir, 'selected repository');
const alternate = path.join(dir, 'alternate repository');
await fs.mkdir(path.join(repo, 'src'), { recursive: true }); initGitRepo(repo);
const query = 'alphaNativeAnswer';
await fs.writeFile(path.join(repo, 'src/answer.js'), `export function ${query}() {\n  return 42;\n}\n`);
if (mode === 'pagination') {
  await fs.writeFile(path.join(repo, 'src/extra.js'), 'export function betaNativeAnswer() {\n  return 43;\n}\n');
}
if (mode === 'scope') {
  await fs.mkdir(path.join(alternate, 'src'), { recursive: true }); initGitRepo(alternate);
  await fs.writeFile(path.join(alternate, 'src/different.js'), 'export function zzzdifferentzzz() {\n  return 84;\n}\n');
}
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug/pairofcleats-tui.exe');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
await fs.writeFile(path.join(dir, 'native-source-identity.json'), JSON.stringify({ binary, binarySha256,
  node: process.version, abi: process.versions.modules, platform: process.platform,
  sources: Object.fromEntries(await Promise.all(['crates/pairofcleats-tui/src/main.rs',
    'crates/pairofcleats-tui/src/search.rs', 'tools/tui/operator/search.js', 'tools/tui/supervisor.js']
    .map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])) ) }, null, 2));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, indexing: { scm: { provider: 'none' }, typeInference: false,
    typeInferenceCrossFile: false, riskAnalysis: false }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } },
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TUI_NODE: process.execPath,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(mode === 'navigation' ? [repo] : []),
    PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, mode === 'handshake'
      ? 'tests/fixtures/tui/native-delayed-hello.js' : 'tools/tui/supervisor.js'),
    PAIROFCLEATS_TUI_RUN_ID: 'search-native', PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json'),
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir } });
const buildAt = async (target, name) => {
  const build = await spawnSubprocess(process.execPath, [path.join(root, 'build_index.js'), '--repo', target,
    '--mode', 'code', '--stage', 'stage1', '--stub-embeddings', '--threads', '1'], {
    cwd: root, env, timeoutMs: 10000, stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: 1024 * 1024,
    rejectOnNonZeroExit: false
  });
  await fs.writeFile(path.join(dir, name), JSON.stringify(build, null, 2));
  assert.equal(build.exitCode, 0);
};
if (['modes', 'incompatible'].includes(mode)) {
  const inputs = [['code', 'src/answer.js', 'FunctionDeclaration'], ['prose', 'README.md', 'paragraph'],
    ['extracted-prose', 'src/answer.js', 'comment'], ['records', 'records.json', 'record']];
  await fs.writeFile(path.join(repo, 'README.md'), 'Native prose source\n');
  await fs.writeFile(path.join(repo, 'records.json'), '{"answer":42}\n');
  for (const [kind, file, chunkKind] of inputs) {
    const index = await createCompatibilityIndex(repo, { mode: kind,
      compatibilityKey: mode === 'incompatible' ? `native-mode-${kind}` : 'native-modes-compatible', profileId: 'default', fileName: file });
    const body = await fs.readFile(path.join(repo, file));
    await fs.writeFile(path.join(index, 'chunk_meta.json'), JSON.stringify([{ id: 0, file, kind: chunkKind,
      name: `${kind} result`, chunkUid: `mode:${kind}`, start: 0, end: body.length, startLine: 1, endLine: 1,
      sourceHash: createHash('sha1').update(body).digest('hex') }]));
  }
} else if (mode === 'truncated') {
  // Explicit large artifact input exercises the real CLI/capture boundary;
  // the other cases independently qualify actual native index production.
  const index = await createCompatibilityIndex(repo, { compatibilityKey: 'native-capture-bound', profileId: 'default' });
  const rows = Array.from({ length: 100 }, (_, id) => ({ id, file: 'src/answer.js', kind: 'FunctionDeclaration',
    name: 'x'.repeat(10000) + id, chunkUid: `capture:${id}`, start: 0, end: 1 }));
  await fs.writeFile(path.join(index, 'chunk_meta.json'), JSON.stringify(rows));
  await fs.writeFile(path.join(index, 'token_postings.json'), JSON.stringify({ vocab: ['alpha'],
    postings: [rows.map(row => [row.id, 1])], docLengths: rows.map(() => 1), avgDocLen: 1, totalDocs: rows.length }));
} else await buildAt(repo, 'index-build.json');
if (mode === 'scope') await buildAt(alternate, 'index-build-alternate.json');
const editorMarker = path.join(dir, 'editor-invoked.json');
if (mode === 'navigation') {
  const bin = path.join(repo, 'explicit-editor'); await fs.mkdir(bin);
  const fixture = path.join(bin, 'record-editor.mjs');
  await fs.writeFile(fixture, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(editorMarker)},
    JSON.stringify({args:process.argv.slice(2),pid:process.pid}));\n`);
  const quote = value => `"${value.replace(/%/g, '%%')}"`;
  await fs.writeFile(path.join(bin, 'code.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quote(process.execPath)} ${quote(fixture)} %*\r\n`);
  env.PATH = `${bin}${path.delimiter}${env.PATH || process.env.PATH || ''}`;
}
const readEvents = async () => {
  let text;
  try { text = await fs.readFile(path.join(dir, 'search-native.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = text.slice(0, text.lastIndexOf('\n')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const chunks = new Map();
  for (const row of [...rows]) {
    if (row.event !== 'event:chunk') continue;
    const parts = chunks.get(row.chunkId) || new Map();
    parts.set(row.chunkIndex, row.chunk); chunks.set(row.chunkId, parts);
    if (parts.size === row.chunkCount) rows.push(JSON.parse(Array.from({ length: row.chunkCount }, (_, i) => parts.get(i)).join('')));
  }
  return rows;
};
try {
  const capture = await captureCommandTerminalRun({ command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile',
    '-NonInteractive', '-File', path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, 'search'],
  rootDir: root, cwd: repo, cols: columns, rows: terminalRows, label: `native-search-${mode}`,
  logsRoot: path.join(dir, 'capture'), timeoutMs: 19000, env,
  onSpawn: async terminal => {
    let output = '', screens = 0;
    const subscription = terminal.onData(data => { output = (output + data).slice(-1024 * 1024); });
    const deadline = Date.now() + 16000;
    const wait = async (predicate, witness) => {
      while (!await predicate()) {
        assert.ok(Date.now() < deadline, `Native search witness timed out: ${witness}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const screen = () => reconstructTerminalScreen(output, { columns, rows: terminalRows }).text;
    const rendered = async witness => {
      await wait(() => screen().includes(witness), witness);
      await fs.writeFile(path.join(dir, `screen-${screens++}.txt`), screen());
    };
    const lastJob = async () => Math.max(0, ...(await readEvents()).filter(row => row.jobId?.startsWith('native-search-'))
      .map(row => Number(row.jobId.split('-').at(-1))));
    const settled = async (method, after = 0) => {
      let end;
      await wait(async () => {
        end = (await readEvents()).find(row => row.event === 'job:end'
          && (row.result?.method === method || row.status === 'failed' || row.status === 'cancelled')
          && Number(row.jobId.split('-').at(-1)) > after);
        return end;
      }, `${method} result`);
      assert.equal(end.status, 'done', JSON.stringify(end));
      return end.result.data;
    };
    try {
      await wait(async () => (await readEvents()).some(row => row.event === 'hello'), 'actual supervisor hello');
      if (mode === 'handshake') {
        await rendered('Tab focus'); terminal.write('R');
        await rendered('Read only: repository search requires a controllable local supervisor');
        assert.equal((await readEvents()).some(row => row.internal && row.event === 'job:start'), false);
        await fs.writeFile(path.join(dir, 'release-hello'), 'explicit fixture handshake release\n');
      } else terminal.write('R');
      await rendered('Ready; Enter runs a canonical search');
      const requestedQuery = ['pagination', 'truncated', 'modes', 'incompatible'].includes(mode) ? '' : mode === 'empty-error' ? 'unfindableNativeTerm' : query;
      const filters = mode === 'pagination' ? { ann: false, lang: 'javascript' }
        : mode === 'truncated' ? { ann: false, type: 'FunctionDeclaration' }
          : ['modes', 'incompatible'].includes(mode) ? { ann: false, file: ['src/answer.js', 'README.md', 'records.json'] } : { ann: false };
      terminal.write(`${requestedQuery}\t\x15${['modes', 'incompatible'].includes(mode) ? 'all' : 'code'}\t\x15memory\t\x15${mode === 'pagination' ? 1 : mode === 'truncated' ? 100 : 5}\t\t\t\x15${JSON.stringify(filters)}\r`);
      if (mode === 'incompatible') {
        let end;
        await wait(async () => {
          end = (await readEvents()).find(row => row.event === 'job:end' && row.jobId === 'native-search-2');
          return end;
        }, 'incompatible index admission failure');
        assert.equal(end.status, 'failed'); assert.equal(end.error.code, 'SUBPROCESS_FAILED');
        assert.equal(end.result, null); await rendered('SUBPROCESS_FAILED');
      } else if (mode === 'modes') {
        const result = await settled('query');
        assert.deepEqual(result.hits.map(hit => hit.mode), ['code', 'prose', 'extracted-prose', 'records']);
        for (const kind of ['code', 'prose', 'extracted-prose', 'records']) await rendered(`${kind} #1`);
        terminal.write('\x1b[B\x1b[B\x1b[B\r');
        const source = await settled('source');
        assert.equal(source.file, 'records.json'); assert.match(source.excerpt, /"answer":42/);
        await rendered('"answer":42'); terminal.write('\x1b'); await rendered('indexed hits');
      } else if (mode === 'truncated') {
        let end;
        await wait(async () => {
          end = (await readEvents()).find(row => row.event === 'job:end' && row.jobId === 'native-search-2');
          return end;
        }, 'actual CLI capture bound');
        assert.equal(end.status, 'failed', JSON.stringify(end));
        assert.equal(end.error.code, 'ERR_TUI_SEARCH_OUTPUT'); assert.equal(end.result, null);
        await rendered('ERR_TUI_SEARCH_OUTPUT');
      } else if (['cancel', 'replace', 'scope', 'interrupt'].includes(mode)) {
        let spawn;
        await wait(async () => {
          spawn = (await readEvents()).find(row => row.event === 'job:spawn');
          return spawn;
        }, 'actual query child startup');
        assert.equal(isProcessAlive(spawn.pid), true, 'cancel must follow actual child startup');
        if (mode === 'cancel') terminal.write('\x1b');
        else if (mode === 'interrupt') terminal.write('\x03');
        else if (mode === 'replace') terminal.write('e\t\t\x15zzznevermatchzzz\r');
        else terminal.write(`e\t\x15${alternate}\t\x15zzzdifferentzzz\r`);
        let end;
        await wait(async () => {
          end = (await readEvents()).find(row => row.event === 'job:end' && row.jobId === spawn.jobId);
          return end;
        }, 'actual cancelled query outcome');
        assert.equal(end.status, 'cancelled', JSON.stringify(end));
        assert.equal(isProcessAlive(spawn.pid), false);
        if (!['cancel', 'interrupt'].includes(mode)) {
          const replacement = await settled('query', Number(spawn.jobId.split('-').at(-1)));
          assert.equal(replacement.queryGeneration, 2);
          if (mode === 'replace') {
            assert.equal(replacement.hits.length, 0); await rendered('No indexed hits');
          } else {
            assert.equal(replacement.repoPath, await fs.realpath(alternate));
            assert.ok(replacement.hits.some(hit => hit.file === 'src/different.js'));
            await rendered('src/different.js');
          }
        }
      } else if (mode === 'empty-error') {
        // The canonical identifier analyzer expands both names through
        // "native"; retain this original query as a positive lexical witness.
        const expanded = await settled('query');
        assert.ok(expanded.hits.some(hit => hit.file === 'src/answer.js'));
        const expandedAfter = await lastJob();
        terminal.write('e\t\t\x15zzznevermatchzzz\r');
        const empty = await settled('query', expandedAfter); assert.equal(empty.hits.length, 0);
        await rendered('No indexed hits');
        const after = await lastJob();
        terminal.write('e\t\t\x15invented\r');
        let rejected;
        await wait(async () => {
          rejected = (await readEvents()).find(row => row.event === 'job:end'
            && Number(row.jobId.split('-').at(-1)) > after);
          return rejected;
        }, 'canonical invalid backend rejection');
        assert.equal(rejected.status, 'failed'); assert.equal(rejected.error.code, 'ERR_TUI_SEARCH_REQUEST');
        await rendered('ERR_TUI_SEARCH_REQUEST');
        const failedAfter = await lastJob();
        terminal.write(`e\x15memory\t\t\t\t\t\t\x15${query}\r`);
        const recovered = await settled('query', failedAfter);
        assert.ok(recovered.hits.some(hit => hit.file === 'src/answer.js'));
        await rendered('indexed hits');
      } else {
        const result = await settled('query');
        assert.equal(result.repoPath, await fs.realpath(repo));
        assert.ok(result.hits.some(hit => hit.file === 'src/answer.js'), JSON.stringify(result));
        await rendered('indexed hits'); await rendered('src/answer.js');
        if (mode === 'pagination') {
          assert.equal(result.hits.length, 1); assert.ok(result.pagination.nextCursor);
          const after = await lastJob(); terminal.write('n');
          const next = await settled('continue', after);
          assert.equal(next.resultId, result.resultId);
          assert.equal(next.hits[0].rank, 2); assert.notEqual(next.hits[0].hitId, result.hits[0].hitId);
          await rendered('2 indexed hits'); await rendered('src/extra.js');
        } else {
          terminal.write('\r'); const source = await settled('source');
          assert.equal(source.available, true);
          assert.match(source.excerpt, /return 42/);
          assert.equal(source.hitId, result.hits[0].hitId);
          await rendered('Working-tree source preview'); await rendered('return 42');
          if (mode === 'navigation') {
            terminal.write('o'); await rendered('Open current source in VS Code?');
            await assert.rejects(fs.access(editorMarker), { code: 'ENOENT' }, 'opening the confirmation cannot execute a launcher');
            terminal.write('\x1b'); await rendered('Editor launch cancelled');
            await assert.rejects(fs.access(editorMarker), { code: 'ENOENT' });
            const after = await lastJob(); terminal.write('o\r');
            const opened = await settled('open', after); assert.equal(opened.opened, true);
            await rendered('Opened the selected source in VS Code');
            const editor = JSON.parse(await fs.readFile(editorMarker, 'utf8'));
            assert.deepEqual(editor.args, ['--reuse-window', '--goto', `${path.join(repo, 'src/answer.js')}:1:1`]);
            assert.equal(isProcessAlive(editor.pid), false);
          }
          terminal.write('\x1b'); await rendered('indexed hits');
        }
      }
      if (mode !== 'interrupt') {
        if (mode !== 'cancel') terminal.write('\x1b');
        await rendered('Tab focus'); terminal.write('q');
      }
    } finally {
      subscription.dispose();
      await fs.writeFile(path.join(dir, 'terminal-output.ansi.log'), output);
    }
  } });
  assert.equal(capture.timedOut, false, capture.outputDir); assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0, receipt.stderr); assert.equal(receipt.stderr, '');
  assert.equal(receipt.terminalRestored, true);
  const events = await readEvents(), spawns = events.filter(row => row.event === 'job:spawn');
  assert.ok(spawns.length >= 1, 'the actual query child must have a recorded startup');
  for (const row of spawns) assert.equal(isProcessAlive(row.pid), false, `Query child ${row.pid} survived`);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'search-native.meta.json'), 'utf8'));
  assert.ok(meta.endedAt); assert.equal(isProcessAlive(meta.pid), false);
  const snapshotText = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  assert.equal(snapshotText.includes(query), false, 'query/source drafts stay out of layout persistence');
  assert.deepEqual(JSON.parse(snapshotText).final_job_statuses, {});
  console.log(JSON.stringify({ mode, binary, binarySha256, receipt, supervisorReaped: true,
    queryChildren: spawns.map(row => row.pid), actualIndexBuild: !['truncated', 'modes', 'incompatible'].includes(mode), capture: capture.outputDir }));
} finally {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'search-native.meta.json'), 'utf8'));
    if (isProcessAlive(meta.pid)) await killProcessTree(meta.pid);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
