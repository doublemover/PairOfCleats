#!/usr/bin/env node
// Authored actual entry-point fixture. The operational boundary explicitly
// selects named trusted fixture commands; no external producer is executed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = await makeTempDir('poc-operational-ingest-');
try {
  const repo = path.join(root, 'repo'), trace = path.join(root, 'trace.jsonl'), preload = path.join(root, 'preload.mjs');
  await fs.mkdir(repo); await fs.mkdir(path.join(repo, 'src'));
  await fs.writeFile(path.join(repo, 'src', 'probe.js'), 'function probe() {}\n');
  const producer = path.join(root, 'explicit-trusted-fixture-producer');
  const ctagsRow = { _type: 'tag', name: 'probe', path: 'src/probe.js', line: 1, kind: 'function' };
  const scipIndex = { documents: [{ relativePath: 'src/probe.js', occurrences: [{ symbol: 'probe', symbolRoles: 1, range: [0, 0, 5] }] }] };
  const adapter = `import fs from 'node:fs/promises';
    export async function withOperationalTool(id, selected, execute) {
      if (selected.commandOverride !== ${JSON.stringify(producer)} && selected.commandOverride !== null) throw new Error('Named trusted fixture command required');
      return execute({ stream: async (_runner, args, options) => {
        await fs.appendFile(${JSON.stringify(trace)}, JSON.stringify({ id, commandOverride: selected.commandOverride, args, cwd: options.cwd })+'\\n');
        if (id === 'universal-ctags') await options.onStdoutLine(${JSON.stringify(JSON.stringify(ctagsRow))});
        else if (id === 'scip') await options.onStdoutLine(${JSON.stringify(JSON.stringify(scipIndex))});
        else throw new Error('Unexpected producer fixture');
        return { exitCode: 0 };
      } });
    }`;
  await fs.writeFile(preload, `import { registerHooks } from 'node:module'; registerHooks({ load(url, context, next) {
    if (!url.endsWith('/tools/tooling/operational-execution.js')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ${JSON.stringify(adapter)} }; } });`);
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
  const run = (kind, args, name) => runNode([`tools/ingest/${kind}.js`, '--repo', repo, '--out', path.join(root, `${name}.jsonl`), '--json', ...args],
    name, process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  const ctags = run('ctags', ['--run', '--ctags', producer], 'trusted-ctags');
  assert.equal(ctags.status, 0, ctags.stderr);
  const ctagsTrace = JSON.parse((await fs.readFile(trace, 'utf8')).trim());
  assert.equal(ctagsTrace.id, 'universal-ctags');
  assert.deepEqual(ctagsTrace.args.slice(0, 6), ['--options=NONE', '--output-format=json', '--tag-relative=yes', '--recurse=yes', '-f', '-']);
  assert.ok(ctagsTrace.args.includes('--fields=+n'));
  assert.equal(JSON.parse((await fs.readFile(path.join(root, 'trusted-ctags.jsonl'), 'utf8')).trim()).startLine, 1);
  await fs.rm(trace);
  const binary = path.join(root, 'input.scip'); await fs.writeFile(binary, Buffer.alloc(0));
  const scip = run('scip', ['--run', '--input', binary, '--scip', producer], 'trusted-scip');
  assert.equal(scip.status, 0, scip.stderr);
  assert.deepEqual(JSON.parse((await fs.readFile(trace, 'utf8')).trim()).args, ['print', '--json', binary]);
  assert.equal(JSON.parse((await fs.readFile(path.join(root, 'trusted-scip.jsonl'), 'utf8')).trim()).role, 'definition');
  await fs.rm(trace);
  const defaultScip = run('scip', ['--run', '--input', binary], 'managed-selection');
  assert.equal(defaultScip.status, 0, defaultScip.stderr);
  assert.equal(JSON.parse((await fs.readFile(trace, 'utf8')).trim()).commandOverride, null, 'default producer selection preserves the canonical managed installation');
  await fs.rm(trace);
  const input = path.join(root, 'input.jsonl'); await fs.writeFile(input, JSON.stringify(ctagsRow));
  const fileOnly = run('ctags', ['--input', input, '--ctags', path.join(root, 'absent-producer')], 'file-only');
  assert.equal(fileOnly.status, 0, fileOnly.stderr);
  await assert.rejects(fs.stat(trace), { code: 'ENOENT' }, 'reading report bytes never needs a producer');
  for (const [kind, args] of [['ctags', ['--run', '--ctags', producer, '--args=-f elsewhere']],
    ['scip', ['--run', '--input', binary, '--scip', producer, '--args=--json=false']]]) {
    const failed = run(kind, args, `invalid-${kind}`);
    assert.equal(failed.status, 1);
    await assert.rejects(fs.stat(trace), { code: 'ENOENT' }, 'producer-owned output/input overrides fail before launch admission');
  }
} finally { await rmDirRecursive(root); }
console.log('Actual ingest entry points bind selected producers, official SCIP argv, owned stdout, and producer-free file reads.');
