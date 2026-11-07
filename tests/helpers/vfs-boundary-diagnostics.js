import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Explicit diagnostic preload for the unchanged VFS deadline fixture and its
// original child processes. This does not provide input, change a timer, replace
// a resource owner, or count instrumented timings as performance acceptance.
const directory = new URL(import.meta.url).searchParams.get('out');
if (process.env.PAIROFCLEATS_TESTING !== '1' || !directory || !path.isAbsolute(directory)) {
  throw new Error('VFS boundary diagnostics requires an explicit absolute test receipt directory.');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const relative = path.relative(path.join(root, '.testLogs'), path.resolve(directory));
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('VFS diagnostic receipts must be in a task directory beneath .testLogs.');
}
fs.mkdirSync(directory, { recursive: true });
const filename = path.join(directory, `vfs-boundaries-${process.pid}.jsonl`);
const started = performance.now(), counters = new Map();
const limit = 2 * 1024 * 1024;
let written = 0;
const emit = value => {
  const bytes = Buffer.from(JSON.stringify({ pid: process.pid, atMs: performance.now() - started, ...value }) + '\n');
  if (written + bytes.length > limit) throw new Error('VFS diagnostics exceeded its receipt byte bound.');
  fs.appendFileSync(filename, bytes); written += bytes.length;
};
emit({ phase: 'process-start', node: process.version, argv: process.argv });
const key = Symbol.for('test.vfs-boundary-diagnostics');
globalThis[key] = async (name, actual, args) => {
  let counter = counters.get(name);
  if (!counter) {
    counter = { name, calls: 0, settled: 0, failures: 0, active: 0, occupancyMs: 0, maxMs: 0 };
    counters.set(name, counter);
  }
  counter.calls++; counter.active++;
  const begin = performance.now();
  if (counter.calls === 1) emit({ phase: 'first-boundary-start', name });
  let failed = true;
  try { const value = await actual(...args); failed = false; return value; }
  finally {
    const elapsedMs = performance.now() - begin;
    counter.active--; counter.settled++; counter.failures += Number(failed);
    counter.occupancyMs += elapsedMs; counter.maxMs = Math.max(counter.maxMs, elapsedMs);
    if (counter.settled === 1) emit({ phase: 'first-boundary-settled', name, failed, elapsedMs });
  }
};
const owners = new Map([
  ['tools/bench/vfs/cold-start-cache.js', ['runVfsColdStartBench']],
  ['tools/bench/vfs/cold-start-sample.js', ['buildVfsColdStartPlan', 'runVfsColdStartSample']],
  ['src/index/tooling/vfs.js', ['createVfsColdStartCache', 'ensureVfsDiskDocument']],
  ['src/shared/contained-file.js', ['readVerifiedContainedFile']],
  ['src/shared/json-stream/jsonl-write.js', ['writeJsonLinesFile']],
  ['src/shared/json-stream/json-writers.js', ['writeJsonObjectFile']]
].map(([source, names]) => [new URL('../../' + source, import.meta.url).href, names]));
const urls = [...owners.keys()];
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context), index = urls.indexOf(result.url);
    return index >= 0 && !context.parentURL?.startsWith('vfs-diagnostic:')
      ? { url: 'vfs-diagnostic:' + index, shortCircuit: true } : result;
  },
  load(url, context, next) {
    if (!url.startsWith('vfs-diagnostic:')) return next(url, context);
    const original = urls[Number(url.slice('vfs-diagnostic:'.length))], names = owners.get(original);
    return { format: 'module', shortCircuit: true, source: 'export * from ' + JSON.stringify(original)
      + ';import {' + names.map(name => name + ' as original_' + name).join(',') + '} from ' + JSON.stringify(original) + ';'
      + 'const observe=globalThis[Symbol.for("test.vfs-boundary-diagnostics")];'
      + names.map(name => 'export const ' + name + '=(...args)=>observe(' + JSON.stringify(name) + ',original_' + name + ',args);').join('') };
  }
});
// An unref'ed observation cannot keep an otherwise completed child alive.
const snapshot = phase => emit({ phase, counters: [...counters.values()], activeResources: process.getActiveResourcesInfo() });
const interval = setInterval(() => snapshot('progress'), 2000); interval.unref();
process.once('beforeExit', () => snapshot('before-exit'));
process.once('exit', code => { clearInterval(interval); snapshot('exit'); emit({ phase: 'exit-code', code }); });
