import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { registerHooks } from 'node:module';
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = Symbol.for('poc.python-shutdown-admission');
const state = { children: [], registered: 0, kills: 0, release: null, block: false };
globalThis[key] = state;
const access = 'const state=globalThis[Symbol.for("poc.python-shutdown-admission")];';
state.spawn = (_command, _args, options) => {
  assert.equal(options.windowsHide, true);
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  child.stdin.on('data', value => { child.request = JSON.parse(String(value)); }); state.children.push(child); return child;
};
state.close = child => { child.emit('close', 0, null); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); };
state.kill = async child => { state.kills++; if (state.block) await new Promise(resolve => { state.release = resolve; }); state.close(child); return { terminated: true }; };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lang/python/pool.js')) {
      const names = { 'node:child_process': 'spawn', './executable.js': 'executable', '../../shared/kill-tree.js': 'kill', '../../shared/subprocess/tracking-register.js': 'tracking' };
      if (names[specifier]) return { url: 'python-shutdown:' + names[specifier], shortCircuit: true };
    } return next(specifier, context);
  },
  load(url, context, next) {
    const sources = { 'python-shutdown:spawn': access + 'export const spawn=(...args)=>state.spawn(...args);',
      'python-shutdown:executable': 'export const findPythonExecutable=async()=>"fixture-python";',
      'python-shutdown:kill': access + 'export const killChildProcessTree=child=>state.kill(child);',
      'python-shutdown:tracking': access + 'export const registerChildProcessForCleanup=()=>{state.registered++;return()=>state.registered--;};' };
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
  }
});
try {
  const { getPythonAstPool: get, shutdownPythonAstPool: shutdown } = await import('../../../src/lang/python/pool.js');
  const config = { workerCount: 1, maxWorkers: 1, maxRetries: 0, maxQueued: 4 }, args = { dataflow: false, controlFlow: false, path: null };
  const pool = await get(null, config), settled = [];
  const submit = () => pool.request('def sentinel(): pass', args).then(value => { settled.push('resolved'); return value; }, error => { settled.push('rejected'); return error; });
  const active = submit(), queued = submit(); await tick();
  state.block = true; const stopping = shutdown();
  while (!state.release) await tick();
  assert.equal(await get(null, config), null); assert.equal(await pool.request('def late(): pass', args), null);
  assert.equal(settled.length, 2, 'active and queued jobs settle exactly once before awaited worker retirement');
  const secondStop = shutdown(); state.block = false; state.release(); await Promise.all([stopping, secondStop, active, queued]);
  assert.equal(state.kills, 1); assert.equal(state.registered, 0);
  assert.equal(await pool.request('def after(): pass', args), null);
  const [one, two] = await Promise.all([get(null, config), get(null, config)]); assert.equal(one, two); assert.notEqual(one, pool);
  const response = one.request('def sentinel(): pass', args); await tick();
  state.children.at(-1).stdout.write(JSON.stringify({ id: state.children.at(-1).request.id, result: { defs: [{ name: 'sentinel' }] } }) + '\n');
  assert.equal((await response).defs[0].name, 'sentinel');
  const replacement = await get(null, { ...config, maxQueued: 5 }); assert.notEqual(replacement, one);
  await shutdown(); await shutdown();
  assert.equal(state.registered, 0); assert.equal(state.kills, state.children.length);
  assert.equal(settled.length, 2);
} finally { state.release?.(); hooks.deregister(); delete globalThis[key]; }
console.log('Python active/queued/stale admission and concurrent get/reconfigure retain one exact retirement owner.');
