import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { toRealPathSync } from '../../../../src/workspace/identity.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-gtags-command-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const frame = path.join(root, 'frame.json'), preload = path.join(root, 'preload.mjs');
const command = path.join(root, 'explicit-fixture-global');
const repo = toRealPathSync(path.resolve('tests/fixtures/sample'));
const coreArgs = ['-x', '--result=ctags-x', '--encode-path= \t%', '--color=never'];
// This is an argv/producer contract fixture, with an explicit fixture command;
// separate task receipts execute checksum-verified native GNU Global itself.
await fs.writeFile(preload, `import { registerHooks } from 'node:module';
  registerHooks({ load(url, context, next) {
    if (!url.endsWith('/tools/tooling/operational-execution.js')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ${JSON.stringify(`
      import fs from 'node:fs/promises';
      async function runLineStreamingCommand(input) {
        if (input.command !== ${JSON.stringify(command)}) throw new Error('Explicit fixture command required');
        await fs.writeFile(${JSON.stringify(frame)}, JSON.stringify({ command: input.command, args: input.args, cwd: input.cwd }));
        const boundary = input.args.indexOf('--');
        const options = boundary < 0 ? input.args : input.args.slice(0, boundary);
        if (boundary >= 0) return { exitCode: 0 };
        const filename = options.includes('-r') ? 'native-reference-cxref.txt' : 'native-cxref.txt';
        const lines = (await fs.readFile(${JSON.stringify(path.resolve('tests/fixtures/gtags') + '/') } + filename, 'utf8')).split(/\\r?\\n/).filter(Boolean);
        for (const line of lines) await input.onStdoutLine(line);
        return { exitCode: 0 };
      }
      export async function withOperationalTool(id, selection, execute) {
        if (id !== 'gnu-global' || selection.commandOverride !== ${JSON.stringify(command)}) throw new Error('Explicit trusted GNU Global fixture selection required');
        return execute({ stream: (_runner, args, options) => runLineStreamingCommand({ ...options, command: selection.commandOverride, args }) });
      }`)} };
  } });`);
const run = async (name, args, status = 0) => {
  await fs.rm(frame, { force: true });
  const output = path.join(root, `${name}.jsonl`);
  await fs.writeFile(output, 'prior output');
  await fs.writeFile(`${output}.meta.json`, 'prior summary');
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() };
  const result = runNode([path.resolve('bin/pairofcleats.js'), 'ingest', 'gtags', '--repo', repo,
    '--run', '--global', command, ...args, '--out', output, '--json'], name, process.cwd(), env,
  { stdio: 'pipe', allowFailure: true });
  assert.equal(result.status, status, result.stderr || result.stdout);
  if (status) {
    assert.match(result.stderr, /GTAGS ingest/);
    await assert.rejects(fs.stat(frame), { code: 'ENOENT' }, 'invalid command shapes cannot start a producer');
    assert.equal(await fs.readFile(output, 'utf8'), 'prior output');
    assert.equal(await fs.readFile(`${output}.meta.json`, 'utf8'), 'prior summary');
    assert.equal(result.stdout.trim(), '');
    return null;
  }
  return { invocation: JSON.parse(await fs.readFile(frame, 'utf8')),
    rows: (await fs.readFile(output, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse) };
};
try {
  const baseline = await run('default', []);
  assert.deepEqual(baseline.invocation, { command, args: [...coreArgs, '.'], cwd: repo });
  assert.equal(baseline.rows.length, 2);
  assert.ok(baseline.rows.every(row => row.role === 'definition'));
  const reference = await run('reference', ['--args=-r alpha']);
  assert.deepEqual(reference.invocation.args, [...coreArgs, '-r', 'alpha']);
  assert.deepEqual(reference.rows.map(row => [row.file, row.name, row.role]), [['src/caller.c', 'alpha', 'reference']]);
  const literal = await run('literal', ['--args=-- --result=path']);
  assert.deepEqual(literal.invocation.args, [...coreArgs, '--', '--result=path']);
  for (const [index, args] of ['--result=path .', '-C elsewhere .', '--from-here=1:src/main.c alpha', '-P .'].entries()) {
    await run(`invalid-${index}`, [`--args=${args}`], 1);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('GTAGS command ownership pins cxref/encoding/color, supplies a real default pattern, preserves reference roles and fails incompatible producer shapes before publication.');
