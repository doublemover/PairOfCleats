#!/usr/bin/env node
// Authored actual installer consumer fixture. The detected command is a named
// trusted fixture; the capability adapter explicitly selects fixture evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const temporary = await makeTempDir('poc-installed-operational-capability-');
try {
  const repo = path.join(temporary, 'repo'), bin = path.join(temporary, 'trusted-fixtures'), tools = path.join(temporary, 'tools');
  await fs.mkdir(repo); await fs.mkdir(bin);
  const body = "console.error('dot - graphviz version 16.1.0');\n";
  const script = path.join(bin, 'explicit-trusted-dot-fixture.mjs'); await fs.writeFile(script, body);
  const command = path.join(bin, process.platform === 'win32' ? 'dot.cmd' : 'dot');
  await fs.writeFile(command, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n` : `#!${process.execPath}\n${body}`, { mode: 0o755 });
  const trace = path.join(temporary, 'trace.jsonl'), preload = path.join(temporary, 'fixture-preload.mjs');
  const adapter = `import fs from 'node:fs/promises'; export async function withOperationalTool(id, selection, execute) {
    if(id!=='graphviz'||selection.commandOverride!==${JSON.stringify(command)}) throw new Error('Only the explicitly selected trusted Graphviz fixture is authorized');
    await fs.appendFile(${JSON.stringify(trace)},JSON.stringify({id,command:selection.commandOverride})+'\\n');
    if(process.env.TEST_RENDERER_CAPABILITY!=='qualified') throw Object.assign(new Error('Selected renderer has no SVG plugin'),{code:'ERR_OPERATIONAL_TOOL_UNAVAILABLE'});
    return execute({capability:{ok:true,identity:{family:'graphviz',version:'16.1.0'},level:'explicit-fixture-svg-operation'}});
  }`;
  await fs.writeFile(preload, `import { registerHooks } from 'node:module'; registerHooks({load(url,context,next){
    if(!url.endsWith('/tools/tooling/operational-execution.js')) return next(url,context);
    return {format:'module',shortCircuit:true,source:${JSON.stringify(adapter)}};}});`);
  const env = applyTestEnv({ syncProcess: false, testConfig: { tooling: { dir: tools } }, extraEnv: {
    PAIROFCLEATS_HOME: path.join(temporary, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]), PAIROFCLEATS_TRUSTED_CONFIG: null,
    PATH: bin, Path: bin, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
  const run = qualified => runNode(['tools/tooling/install.js', '--repo', repo, '--tools', 'graphviz', '--scope', 'cache', '--no-fallback', '--json'],
    'installed Graphviz fixture capability reuse', process.cwd(), { ...env, TEST_RENDERER_CAPABILITY: qualified ? 'qualified' : 'missing' },
    { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  const failed = run(false); assert.equal(failed.status, 1, failed.stderr);
  const blocked = JSON.parse(failed.stdout);
  assert.equal(blocked.results[0].status, 'verification-failed');
  assert.equal(blocked.results[0].code, 'ERR_OPERATIONAL_TOOL_UNAVAILABLE');
  assert.equal(blocked.actions.length, 0, 'missing selected renderer capability does not silently download a replacement');
  assert.equal(blocked.readiness.ready, false);
  const succeeded = run(true); assert.equal(succeeded.status, 0, succeeded.stderr);
  const ready = JSON.parse(succeeded.stdout);
  assert.equal(ready.results[0].status, 'already-installed');
  assert.equal(ready.results[0].probe.capability.level, 'explicit-fixture-svg-operation');
  assert.equal(ready.actions.length, 0);
  const invocations = (await fs.readFile(trace, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(invocations, [{ id: 'graphviz', command }, { id: 'graphviz', command }]);
} finally { await rmDirRecursive(temporary); }
console.log('Already-installed operational tools must pass their selected capability before installer readiness.');
