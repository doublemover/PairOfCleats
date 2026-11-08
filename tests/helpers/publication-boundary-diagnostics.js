import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';

/** Observe original operations; never supply a receipt, change a bound, reuse a
 * payload or release an owner. Used only by the original deadline fixtures.
 * Operation durations overlap: their sum is occupancy, not exclusive wall time,
 * disk latency, RSS, or a claim about the number of retained file descriptors.
 * Ordinary fixtures retain boundary timing without replacing filesystem APIs.
 * Private --publication-io-diagnostics reproduces the detailed operation trace;
 * its observer cost is not part of an uninstrumented performance claim.
 */
export const installPublicationBoundaryDiagnostics = ({
  instrumentIo = process.argv.includes('--publication-io-diagnostics')
} = {}) => {
  const started = performance.now(), counters = new Map();
  let sequence = 0, active = 0, peak = 0;
  const emit = value => console.log(JSON.stringify(value));
  const record = (group, operation, elapsedMs, failed) => {
    const key = group + ':' + operation;
    const value = counters.get(key) || { group, operation, calls: 0, failures: 0, elapsedMs: 0, maxMs: 0 };
    value.calls++; value.failures += Number(failed); value.elapsedMs += elapsedMs; value.maxMs = Math.max(value.maxMs, elapsedMs);
    counters.set(key, value);
  };
  const groupFor = filename => typeof filename === 'string'
    ? /[/\\]completed[/\\]/.test(filename) ? 'completed' : /[/\\]builds[/\\]/.test(filename) ? 'source-build' : 'other'
    : 'other';
  const observe = async (group, operation, actual, receiver, args) => {
    const start = performance.now(); let failed = true;
    active++; peak = Math.max(peak, active);
    try { const value = await actual.apply(receiver, args); failed = false; return value; }
    finally { active--; record(group, operation, performance.now() - start, failed); }
  };
  const originalOpen = fsPromises.open, originalStatSync = fs.statSync, originalLstatSync = fs.lstatSync, originalFstatSync = fs.fstatSync;
  const promiseMethods = new Map(['readFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rename'].map(name => [name, fsPromises[name]]));
  if (instrumentIo) {
    for (const [name, actual] of promiseMethods) fsPromises[name] = function(...args) {
      return observe(groupFor(args[0]), name, actual, this, args);
    };
    fsPromises.open = async function(...args) {
      const group = groupFor(args[0]);
      const handle = await observe(group, 'open', originalOpen, this, args);
      try {
        for (const name of ['read', 'write', 'sync', 'stat', 'close']) {
          const actual = handle[name];
          if (typeof actual === 'function') handle[name] = function(...methodArgs) {
            return observe(group, name, actual, this, methodArgs);
          };
        }
        return handle;
      } catch (error) {
      // Instrumentation failure still belongs to the actual newly opened
      // descriptor; the normal owner retains any failed close prerequisite.
        const owner = createContainedFileResource({ handle, sync: false });
        return owner.run(() => { throw error; });
      }
    };
    const observeSync = (name, actual) => function(...args) {
      const start = performance.now(); let failed = true;
      try { const value = actual.apply(this, args); failed = false; return value; }
      finally { record(groupFor(args[0]), name, performance.now() - start, failed); }
    };
    fs.statSync = observeSync('statSync', originalStatSync); fs.lstatSync = observeSync('lstatSync', originalLstatSync);
    fs.fstatSync = observeSync('fstatSync', originalFstatSync);
    syncBuiltinESMExports();
  }
  const owners = new Map([
    ['src/index/build/stage-provenance.js', ['observeStageProducer']],
    ['src/index/build/artifact-publication.js', ['validateArtifactPublicationGeneration', 'writeArtifactPublicationValidationReport',
      'writeArtifactPublicationRecord', 'assertArtifactPublicationReady']],
    ['src/index/build/stage-output.js', ['inventoryStageOutput', 'inventoryStageOutputForCopy', 'readBuildMetadata',
      'copyStageMembers', 'copyUnpublishedStageMembers']],
    ['src/index/build/stage-snapshot.js', ['snapshotStageOutput']],
    ['src/index/build/completed-stage.js', ['sealCompletedStage']]
  ].map(([relative, names]) => [new URL('../../' + relative, import.meta.url).href, names]));
  const urls = [...owners.keys()], key = Symbol.for('test.publication-boundary-diagnostics');
  globalThis[key] = async (name, actual, args) => {
    const id = ++sequence, start = performance.now();
    emit({ phase: 'publication-boundary-start', name, sequence: id, atMs: start - started });
    let failed = true;
    try { const value = await actual(...args); failed = false; return value; }
    finally {
      emit({ phase: 'publication-boundary-settled', name, sequence: id, atMs: performance.now() - started,
        elapsedMs: performance.now() - start, failed });
      // Snapshot current aggregate counters even when the runner subsequently
      // reaches its original deadline inside another boundary.
      if (instrumentIo) emit({ phase: 'publication-io-observed', name, sequence: id, activeIoOperations: active, peakIoOperations: peak,
        counters: [...counters.values()].sort((a, b) => (a.group + a.operation).localeCompare(b.group + b.operation)) });
    }
  };
  const hook = registerHooks({ resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const index = urls.indexOf(resolved.url);
    return index >= 0 && !context.parentURL?.startsWith('publication-diagnostic:')
      ? { url: 'publication-diagnostic:' + index, shortCircuit: true } : resolved;
  }, load(url, context, next) {
    if (!url.startsWith('publication-diagnostic:')) return next(url, context);
    const original = urls[Number(url.slice('publication-diagnostic:'.length))], names = owners.get(original);
    const source = 'export * from ' + JSON.stringify(original) + ';import {'
      + names.map(name => name + ' as original_' + name).join(',') + '} from ' + JSON.stringify(original) + ';'
      + 'const observe=globalThis[Symbol.for("test.publication-boundary-diagnostics")];'
      + names.map(name => 'export const ' + name + '=(...args)=>observe('
        + JSON.stringify(name) + ',original_' + name + ',args);').join('');
    return { format: 'module', shortCircuit: true, source };
  } });
  let finished = false;
  let observedSignal = null, onAbort = null;
  return { observeSignal(signal) {
    if (observedSignal) throw new Error('Deadline diagnostics already has its original signal.');
    observedSignal = signal;
    onAbort = () => emit({ phase: 'publication-diagnostic-abort-observed', atMs: performance.now() - started });
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  }, finish() {
    if (finished) return; finished = true;
    emit({ phase: 'publication-diagnostics-finished', atMs: performance.now() - started, instrumentedIo: instrumentIo,
      activeIoOperations: instrumentIo ? active : null, peakIoOperations: instrumentIo ? peak : null,
      counters: instrumentIo ? [...counters.values()] : null });
    hook.deregister(); delete globalThis[key];
    observedSignal?.removeEventListener('abort', onAbort);
    if (instrumentIo) {
      fsPromises.open = originalOpen; fs.statSync = originalStatSync; fs.lstatSync = originalLstatSync; fs.fstatSync = originalFstatSync;
      for (const [name, actual] of promiseMethods) fsPromises[name] = actual;
      syncBuiltinESMExports();
    }
  } };
};
