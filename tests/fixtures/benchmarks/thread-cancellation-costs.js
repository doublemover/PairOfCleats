import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { projectFileAnalysisInput, decodeFileAnalysisResult } from '../../../src/index/build/workers/file-analysis-contract.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { applyTestEnv, withTemporaryEnv, syncProcessEnv } from '../../helpers/test-env.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Natural original exit and actual facade work; one pool lifetime, no imposed exit holds. */
export const runScenario = async ({ destination }) => {
  assert(path.isAbsolute(destination));
  const env = applyTestEnv({ cacheRoot: path.join(destination, 'cache'), embeddings: 'off', syncProcess: false,
    extraEnv: { PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_WORKER_POOL: '1' } });
  return withTemporaryEnv(env, async () => {
    const actual = pathToFileURL(createRequire(import.meta.url).resolve('piscina')).href;
    const worker = fileURLToPath(new URL('./thread-cancellation-cost-worker.js', import.meta.url));
    const nativePools = new Set(), live = new Set(), phases = [], cleanup = {};
    let facade, current = null, activeGate = null, peakLive = 0, parent = null, activeController = null, primaryFailure, hasPrimaryFailure = false;
    const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 8 * 1024 * 1024 });
    const began = performance.now(), delay = monitorEventLoopDelay({ resolution: 10 });
    const sample = phase => {
      for (const raw of nativePools) for (const thread of raw.threads) if (thread.threadId > 0) live.add(thread);
      peakLive = Math.max(peakLive, [...live].filter(thread => thread.threadId > 0).length);
      const stats = facade?.stats();
      const value = { phase, atMs: performance.now() - began, liveOriginalAndReplacement: [...live].filter(thread => thread.threadId > 0).length,
        cpu: scheduler.stats().tokens.cpu.used, memory: scheduler.stats().tokens.mem.used,
        bytes: scheduler.stats().activity.inFlightBytes, active: stats?.activeTasks ?? 0, dispatched: stats?.dispatchedTasks ?? 0,
        javascriptThrottle: stats?.memoryPressure?.languageThrottle?.activeByLanguage?.javascript ?? 0 };
      assert(phases.length < 256); phases.push(value); return value;
    };
    const watch = raw => {
      nativePools.add(raw);
      raw.on('workerCreate', () => sample('native-worker-create'));
      raw.on('workerDestroy', () => sample('native-worker-destroy-request;not-exit'));
    };
    globalThis.__threadCostGate = () => activeGate;
    globalThis.__threadCostNativePool = watch;
    globalThis.__threadCostDispatch = (raw, id, name) => {
      const original = raw.threads.find(thread => thread.threadId === id); assert(original); live.add(original);
      sample('actual-dispatch:' + name);
      if (!current || current.original) return;
      current.original = original; current.originalId = id;
      const own = current;
      original.once('exit', () => {
        live.delete(original); own.exitAtMs = performance.now() - began;
        own.exitState = { ...sample('actual-original-exit:' + own.kind), publicSettled: own.publicSettled, peerEntered: own.peerEntered };
        own.exited.resolve();
      });
    };
    const hooks = registerHooks({ resolve(specifier, context, next) {
      return specifier === 'piscina' && context.parentURL?.endsWith('/index/build/workers/pool.js')
        ? { url: 'task-cost:observed-piscina', shortCircuit: true } : next(specifier, context);
    }, load(url, context, next) {
      if (url !== 'task-cost:observed-piscina') return next(url, context);
      return { format: 'module', shortCircuit: true, source: `import Actual from ${JSON.stringify(actual)};
        export default class Observed extends Actual {
          constructor(options) { let instance;
            super({...options,filename:${JSON.stringify(worker)},loadBalancer(task,workers){const selected=options.loadBalancer(task,workers);
              if(selected)globalThis.__threadCostDispatch?.(instance,selected.id,task.name);return selected;}});
            instance=this;globalThis.__threadCostNativePool?.(this);
          }
          run(payload,options){const gate=globalThis.__threadCostGate?.();return super.run(gate?{...payload,__qualificationStarted:gate}:payload,options);}
        }` };
    } });
    try {
      const { createScmFileProcessorContext } = await import('../../indexing/file-processor/scm-file-processor-test-helper.js');
      // That existing fixture helper scopes its own test defaults at import.
      // Restore this capsule's declared cache/backend/one-thread environment.
      syncProcessEnv(env, Object.keys(env));
      const { createIndexerWorkerPool } = await import('../../../src/index/build/workers/pool.js');
      const input = path.join(destination, 'analysis.js');
      const makeAnalysis = async count => {
        const text = Array.from({ length: count }, (_, index) => `export function f${index}(value) { if (value) return value + ${index}; return 0; }`).join('\n');
        await fs.writeFile(input, text);
        const context = createScmFileProcessorContext({ abs: input, rel: path.relative(process.cwd(), input),
          relKey: path.relative(process.cwd(), input).replaceAll('\\', '/'), ext: '.js', text, fileStat: await fs.stat(input),
          fileHash: createHash('sha256').update(text).digest('hex'),
          scmProvider: null, scmProviderImpl: null, relationsEnabled: true, lintEnabled: true,
          tokenContext: createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} }) });
        const projected = projectFileAnalysisInput(context); assert(projected.payload); return projected.payload;
      };
      const item = text => ({ text, mode: 'code', ext: '.js', languageId: 'javascript' });
      const line = 'function compute(alpha, beta) { const result = alpha + beta; return result; }\n';
      const ordinary = { single: item(line.repeat(16)), batch: { items: Array.from({ length: 4 }, () => item(line.repeat(8))) },
        quantize: { vectors: Array.from({ length: 128 }, (_, row) => Array.from({ length: 128 }, (_, column) => ((row + column) % 31 - 15) / 16)) },
        analysis: await makeAnalysis(8) };
      const cancellation = { single: item(line.repeat(1024)),
        batch: { items: Array.from({ length: 8 }, () => item(line.repeat(160))) },
        quantize: { vectors: Array.from({ length: 4096 }, (_, row) => Array.from({ length: 256 }, (_, column) => ((row + column) % 31 - 15) / 16)) },
        analysis: await makeAnalysis(512) };
      const inputEvidence = Object.fromEntries(Object.keys(ordinary).map(kind => [kind, {
        ordinarySha256: digest(ordinary[kind]), cancellationSha256: digest(cancellation[kind])
      }]));
      const invoke = (kind, payload, signal) => kind === 'single' ? facade.tokenizeChunk(payload, { signal })
        : kind === 'batch' ? facade.tokenizeBatch(payload, { signal }) : kind === 'quantize' ? facade.runQuantize(payload, { signal })
          : facade.analyzeFile(payload, { signal });
      const canonical = (kind, payload, result) => {
        assert(result, 'actual facade must return work rather than inline/unavailable fallback');
        if (kind === 'analysis') { const value = decodeFileAnalysisResult(payload, result); assert.equal(value.status, 'completed');
          assert(value.result.chunks.length > 0); assert.equal(value.result.skip, null); return value.result; }
        if (kind === 'batch') { assert.equal(result.results.length, payload.items.length); return result.results.map(row => {
          const value = deserialize(Buffer.from(row)); assert.equal(value.ok, true); assert(value.value.tokens.length > 0); return value;
        }); }
        if (kind === 'single') assert(result.tokens.length > 0);
        if (kind === 'quantize') assert.deepEqual(result, payload.vectors.map(row => row.map(value => Math.round((value + 1) * 255 / 2))));
        return result;
      };
      const startupAt = performance.now();
      facade = await createIndexerWorkerPool({ config: { enabled: true, maxWorkers: 1, idleTimeoutMs: 60000 },
        dictWords: new Set(['alpha', 'beta']), dictConfig: {}, postingsConfig: {}, log() {} });
      assert(facade && facade.stats().backend === 'worker');
      assert.equal(nativePools.size, 1); const piscinaVersion = [...nativePools][0].constructor.version;
      assert.equal(piscinaVersion, '5.3.2');
      const facadeConstructionMs = performance.now() - startupAt, expected = {}, cold = [];
      for (const kind of Object.keys(ordinary)) {
        const at = performance.now(); expected[kind] = canonical(kind, ordinary[kind], await invoke(kind, ordinary[kind]));
        cold.push({ kind, elapsedMs: performance.now() - at, resultSha256: digest(expected[kind]),
          scope: kind === 'single' ? 'first task includes original Worker startup' : 'first task of this family; analysis includes lazy compiler loading' });
      }
      const utilization = performance.eventLoopUtilization(), cpu = process.cpuUsage(), cleanAt = performance.now(); delay.enable();
      const work = [];
      for (let round = 0; round < 4; round++) for (const kind of Object.keys(ordinary)) {
        const at = performance.now(), result = await invoke(kind, ordinary[kind]), wallMs = performance.now() - at;
        const value = canonical(kind, ordinary[kind], result); assert.deepEqual(value, expected[kind]);
        work.push({ kind, round, wallMs, resultSha256: digest(value) });
      }
      delay.disable();
      const ordinaryWallMs = performance.now() - cleanAt, ordinaryCpu = process.cpuUsage(cpu);
      const throughput = { tasks: work.length, wallMs: ordinaryWallMs, tasksPerSecond: work.length * 1000 / ordinaryWallMs,
        cpu: ordinaryCpu, eventLoopUtilization: performance.eventLoopUtilization(utilization),
        eventLoopDelay: { count: delay.count, meanNs: delay.count ? delay.mean : null, maxNs: delay.count ? delay.max : null },
        samples: work, input: { tokenSingleBytes: Buffer.byteLength(ordinary.single.text), tokenBatchBytes: ordinary.batch.items.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0),
          quantizedElements: 128 * 128, analysisInputBytes: ordinary.analysis.body.byteLength },
        scope: '16 serial nonempty production facade tasks; exact canonical result parity; loop wall includes verification/hash overhead, per-task walls exclude it' };
      const aborts = [];
      for (const kind of Object.keys(cancellation)) {
        const control = new AbortController(), flags = new Int32Array(new SharedArrayBuffer(8));
        activeController = control;
        const reservedBytes = kind === 'quantize' ? 4096 * 256 * 4 : kind === 'analysis' ? cancellation.analysis.body.byteLength
          : kind === 'batch' ? cancellation.batch.items.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0) : Buffer.byteLength(cancellation.single.text);
        const record = { kind, reservedBytes, exited: deferred(), publicSettled: false, peerEntered: false };
        current = record; activeGate = flags.buffer;
        parent = scheduler.schedule('natural-cancel-' + kind, { cpu: 1, mem: 1, bytes: reservedBytes },
          () => invoke(kind, cancellation[kind], control.signal)).finally(() => { record.publicSettled = true; record.publicAtMs = performance.now() - began; });
        const rejected = assert.rejects(parent, error => error.name === 'AbortError');
        rejected.catch(() => {});
        if (Atomics.load(flags, 0) === 0) assert.notEqual(await Atomics.waitAsync(flags, 0, 0, 5000).value, 'timed-out');
        assert(record.original, 'the original public dispatch must identify the Worker before entry');
        assert.equal(Atomics.load(flags, 1), 0, 'task completed before cancellation; no natural-running measurement is claimed');
        assert.equal(record.publicSettled, false);
        const running = sample('actual-task-started:' + kind);
        assert.equal(running.cpu, 1); assert.equal(running.bytes, reservedBytes);
        record.abortAtMs = performance.now() - began; control.abort(new Error('original natural cancellation: ' + kind));
        const peer = scheduler.schedule('natural-peer-' + kind, { cpu: 1, mem: 1, bytes: reservedBytes }, () => { record.peerEntered = true; });
        await rejected; await record.exited.promise; await peer;
        assert.equal(record.exitState.cpu, 1); assert.equal(record.exitState.memory, 1);
        assert.equal(record.exitState.bytes, reservedBytes); assert.equal(record.exitState.active, 1); assert.equal(record.exitState.dispatched, 1);
        if (kind !== 'quantize') assert.equal(record.exitState.javascriptThrottle, 1);
        assert.equal(record.exitState.publicSettled, false); assert.equal(record.exitState.peerEntered, false);
        assert(record.publicAtMs >= record.exitAtMs); assert(record.exitAtMs >= record.abortAtMs);
        assert.equal(facade.stats().activeTasks, 0); assert.equal(facade.stats().dispatchedTasks, 0);
        assert.equal(scheduler.stats().tokens.cpu.used, 0); assert.equal(scheduler.stats().activity.inFlightBytes, 0);
        activeGate = null; current = null;
        const healthy = canonical(kind, ordinary[kind], await invoke(kind, ordinary[kind])); assert.deepEqual(healthy, expected[kind]);
        aborts.push({ kind, originalId: record.originalId, reservedBytes, abortAtMs: record.abortAtMs, exitAtMs: record.exitAtMs,
          publicAtMs: record.publicAtMs, abortToOriginalExitMs: record.exitAtMs - record.abortAtMs,
          abortToPublicSettlementMs: record.publicAtMs - record.abortAtMs, healthyAfterCancelSha256: digest(healthy) });
      }
      return { issues: [1102], node: process.versions.node, piscinaVersion, inputEvidence, facadeConstructionMs, cold, throughput, aborts, phases, cleanup, peakObservedOriginalAndReplacement: peakLive,
        scope: 'actual locked Piscina/public facade; original task-entry SAB and original Worker exit; no terminate override, no imposed exit gate, no sleep-based sampling',
        limits: 'peak thread count observed at original dispatch/create/destroy/exit events; not continuous RSS/native CPU attribution' };
    } catch (error) { primaryFailure = error; hasPrimaryFailure = true; throw error; }
    finally {
      activeController?.abort(); activeGate = null; current = null; delay.disable(); await parent?.catch(() => {});
      const failures = [];
      try { await facade?.destroy(); } catch (error) { failures.push(error); }
      try { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); } catch (error) { failures.push(error); }
      try {
        cleanup.originalFacadeSettled = facade?.isSettled() ?? true;
        cleanup.liveNativeThreads = [...nativePools].reduce((sum, raw) => sum + raw.threads.filter(thread => thread.threadId > 0).length, 0);
        cleanup.schedulerRunningTasks = scheduler.stats().runningTasks;
        cleanup.schedulerCpu = scheduler.stats().tokens.cpu.used; cleanup.schedulerBytes = scheduler.stats().activity.inFlightBytes;
        assert.equal(cleanup.originalFacadeSettled, true); assert.equal(cleanup.liveNativeThreads, 0);
        assert.equal(cleanup.schedulerRunningTasks, 0); assert.equal(cleanup.schedulerCpu, 0); assert.equal(cleanup.schedulerBytes, 0);
      } catch (error) { failures.push(error); }
      try { hooks.deregister(); } catch (error) { failures.push(error); }
      delete globalThis.__threadCostGate; delete globalThis.__threadCostNativePool; delete globalThis.__threadCostDispatch;
      if (failures.length) throw new AggregateError([...(hasPrimaryFailure ? [primaryFailure] : []), ...failures],
        'Natural cancellation measurement cleanup failed.', hasPrimaryFailure ? { cause: primaryFailure } : {});
    }
  });
};
