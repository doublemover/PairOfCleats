import { readEffectiveCpu } from '../../shared/effective-cpu.js';
import { readEffectiveMemory } from '../../shared/effective-memory.js';
import { fileURLToPath } from 'node:url';
import { treeSitterState } from './state.js';
import { destroyPiscinaPool } from '../../shared/piscina-cleanup.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { currentRunResourceScope } from '../../shared/lifecycle/run-scope.js';
import { createRunSharedResources } from '../../shared/lifecycle/shared-resource.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import {
  buildWorkerExecArgv,
  collectNodeHeapArgv,
  parseMaxOldSpaceSizeMb
} from '../../shared/workers/node-argv.js';

const CPU_COUNT = readEffectiveCpu().cpuCount;

export const normalizeTreeSitterWorkerConfig = (raw) => {
  if (raw === false) return { enabled: false };
  if (raw === true) raw = { enabled: true };
  if (!raw || typeof raw !== 'object') return { enabled: false };
  const enabled = raw.enabled !== false;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const launchThreads = getEnvConfig().threads;
  const defaultMax = Math.max(1, Math.min(4, CPU_COUNT,
    Number.isFinite(launchThreads) && launchThreads > 0 ? Math.floor(launchThreads) : 4));
  const maxWorkers = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.min(defaultMax, Math.max(1, Math.floor(maxWorkersRaw)))
    : defaultMax;
  const maxQueueRaw = Number(raw.maxQueue);
  const defaultMaxQueue = Math.max(4, maxWorkers * 4);
  const maxQueue = Number.isFinite(maxQueueRaw) && maxQueueRaw > 0
    ? Math.min(256, Math.max(1, Math.floor(maxQueueRaw)))
    : defaultMaxQueue;
  const idleTimeoutMsRaw = Number(raw.idleTimeoutMs);
  const idleTimeoutMs = Number.isFinite(idleTimeoutMsRaw) && idleTimeoutMsRaw > 0
    ? Math.floor(idleTimeoutMsRaw)
    : 30000;
  const taskTimeoutMsRaw = Number(raw.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw) && taskTimeoutMsRaw > 0
    ? Math.floor(taskTimeoutMsRaw)
    : 60000;
  return {
    enabled,
    maxWorkers,
    maxQueue,
    idleTimeoutMs,
    taskTimeoutMs
  };
};

export const sanitizeTreeSitterOptions = (treeSitter) => {
  const config = treeSitter && typeof treeSitter === 'object' ? treeSitter : {};
  return {
    enabled: config.enabled !== false,
    languages: config.languages || {},
    maxBytes: config.maxBytes ?? null,
    maxLines: config.maxLines ?? null,
    maxParseMs: config.maxParseMs ?? null,
    maxAstNodes: config.maxAstNodes ?? null,
    maxAstStack: config.maxAstStack ?? null,
    maxChunkNodes: config.maxChunkNodes ?? null,
    useQueries: config.useQueries ?? null,
    adaptive: config.adaptive ?? null,
    cacheKey: config.cacheKey ?? null,
    chunkCache: config.chunkCache ?? null,
    chunkCacheMaxEntries: config.chunkCacheMaxEntries ?? null,
    allowedLanguages: Array.isArray(config.allowedLanguages) ? config.allowedLanguages : null,
    byLanguage: config.byLanguage || {},
    configChunking: config.configChunking === true
  };
};

const resolveWorkerResourceLimits = (maxWorkers) => {
  const workerCount = Math.max(1, Math.floor(Number(maxWorkers) || 0));
  if (!Number.isFinite(workerCount) || workerCount <= 0) return null;

  const totalMemMb = Math.floor((readEffectiveMemory().totalBytes || 0) / 1024 / 1024);
  const maxOldMb = parseMaxOldSpaceSizeMb(collectNodeHeapArgv());

  // Tree-sitter workers can load multiple grammars. When indexing a repo
  // that spans many languages, overly small heaps can crash workers with V8
  // "Zone" OOMs even when overall RSS remains low.
  let budgetMb = null;
  if (Number.isFinite(maxOldMb) && maxOldMb > 0) {
    budgetMb = Math.floor(maxOldMb);
  } else if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    budgetMb = Math.floor(totalMemMb * 0.5);
  }
  if (!Number.isFinite(budgetMb) || budgetMb <= 0) return null;

  if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    const hardCap = Math.max(512, Math.floor(totalMemMb * 0.85));
    budgetMb = Math.min(budgetMb, hardCap);
  }

  const perWorkerMb = Math.floor(budgetMb / (workerCount + 1));
  const minMb = 128;
  const platformCap = process.platform === 'win32' ? 4096 : 8192;
  const oldGenMb = Math.max(minMb, Math.min(platformCap, perWorkerMb));
  return { maxOldGenerationSizeMb: oldGenMb };
};

let lifecycleTail=Promise.resolve();
let lifecycleGeneration=0;
let shutdownPending=0;
let retirementError=null;
const retiringPools = new WeakSet(), legacyWorkerViews = new WeakMap();
const viewLegacyPool = (pool, config, generation) => {
  let view = legacyWorkerViews.get(pool);
  if (!view) {
    const run = pool.run.bind(pool);
    view = Object.freeze({ maxQueue: config.maxQueue,
      get queueSize() { return pool.queueSize; }, get threads() { return pool.threads; },
      run: (...args) => {
        if (generation !== lifecycleGeneration || shutdownPending > 0 || retiringPools.has(pool)
          || treeSitterState.treeSitterWorkerPool !== pool) return Promise.reject(Object.assign(
          new Error('Tree-sitter worker admission is retired.'), { code: 'ERR_TREE_SITTER_WORKER_RETIRED' }));
        return run(...args);
      }
    });
    legacyWorkerViews.set(pool, view);
  }
  return view;
};
const serializeLifecycle=task=>{
  const pending=lifecycleTail.then(task);
  lifecycleTail=pending.catch(()=>{});
  return pending;
};
const closeWorkerPool = async (pool, options, label) => {
  const result = await destroyPiscinaPool(pool,{label,log:options?.log,
    destroyTimeoutMs:Number.isFinite(Number(options?.cleanupTimeoutMs))?Math.max(1000,Math.floor(Number(options.cleanupTimeoutMs))):30000});
  if (result?.skipped || (result?.timedOut && (!result.forced || result.forcedSummary?.failed > 0))) {
    throw Object.assign(new Error('Tree-sitter worker cleanup was not confirmed.'), { code: 'ERR_TREE_SITTER_WORKER_CLEANUP' });
  }
};
const retirePool=async(options,label)=>{
  const pool=treeSitterState.treeSitterWorkerPool;
  if(!pool)return;
  retiringPools.add(pool);
  try {
    await closeWorkerPool(pool, options, label);
  }catch(error){retirementError=error;throw error;}
  if(treeSitterState.treeSitterWorkerPool===pool){
    treeSitterState.treeSitterWorkerPool=null;
    treeSitterState.treeSitterWorkerConfigSignature=null;
    treeSitterState.treeSitterWorkerMaxQueue=null;
  }
  retirementError=null;
};

const createWorkerPool = async (config, options, isNeeded) => {
  let Piscina;
  try { Piscina = (await import('piscina')).default; }
  catch (error) {
    if(options?.log&&!treeSitterState.loggedWorkerFailures.has('piscina')){
      options.log('[tree-sitter] Worker pool unavailable: '+(error?.message||error));
      treeSitterState.loggedWorkerFailures.add('piscina');
    }
    return null;
  }
  if (!isNeeded()) return null;
  try {
    const execArgv = buildWorkerExecArgv();
    const resourceLimits = resolveWorkerResourceLimits(config.maxWorkers);
    return new Piscina({ filename: fileURLToPath(new URL('../workers/tree-sitter-worker.js', import.meta.url)),
      maxThreads: config.maxWorkers, maxQueue: config.maxQueue, idleTimeout: config.idleTimeoutMs, taskTimeout: config.taskTimeoutMs,
      ...(execArgv.length ? { execArgv } : {}), ...(resourceLimits ? { resourceLimits } : {}) });
  } catch (error) {
    if(options?.log&&!treeSitterState.loggedWorkerFailures.has('init')){
      options.log('[tree-sitter] Worker pool init failed: '+(error?.message||error));
      treeSitterState.loggedWorkerFailures.add('init');
    }
    return null;
  }
};
const scopedWorkerPools = createRunSharedResources({
  create: async ({ config, options }, { isNeeded }) => {
    const pool = await createWorkerPool(config, options, isNeeded);
    if (!pool) return null;
    let disposed = false;
    const originalDestroy = pool.destroy.bind(pool);
    const closeOwner = {
      get threads() { return pool.threads; },
      destroy: async () => { await originalDestroy(); disposed = true; }
    };
    return { pool, isDisposed: () => disposed, close: async () => {
      await closeWorkerPool(closeOwner, options, 'tree-sitter.run-pool.shutdown');
      disposed = true;
    } };
  },
  dispose: resource => resource.close(), isDisposed: resource => resource.isDisposed()
});
const scopedWorkerViews = new WeakMap();

export const getTreeSitterWorkerPool = async(rawConfig,options={})=>{
  const config=normalizeTreeSitterWorkerConfig(rawConfig);
  const owner = currentRunResourceScope();
  owner?.assertAccepting();
  if(!config.enabled||shutdownPending>0)return null;
  if (owner) {
    const pool = await scopedWorkerPools.acquire(owner, JSON.stringify(config), { config, options });
    if (!pool) return null;
    let views = scopedWorkerViews.get(owner);
    if (!views) { views = new WeakMap(); scopedWorkerViews.set(owner, views); }
    let view = views.get(pool);
    if (!view) {
      view = Object.freeze({ maxQueue: config.maxQueue, get queueSize() { return pool.value.pool.queueSize; },
        run: (...args) => owner.track(() => pool.run(value => value.pool.run(...args))) });
      views.set(pool, view);
    }
    return view;
  }
  const generation=lifecycleGeneration;
  const signature=JSON.stringify(config);
  return serializeLifecycle(async()=>{
    if(generation!==lifecycleGeneration||shutdownPending>0)return null;
    if(retirementError)throw retirementError;
    if(treeSitterState.treeSitterWorkerPool&&treeSitterState.treeSitterWorkerConfigSignature===signature)return viewLegacyPool(treeSitterState.treeSitterWorkerPool, config, generation);
    await retirePool(options,'tree-sitter.worker-pool.reconfigure');
    if(generation!==lifecycleGeneration||shutdownPending>0)return null;
    const pool = await createWorkerPool(config, options, () => generation === lifecycleGeneration && shutdownPending === 0);
    if (!pool) return null;
    if (generation !== lifecycleGeneration || shutdownPending > 0) {
      // Retain the late resource under the same retirement owner before close
      // can fail. A later shutdown can observe/recover that original handle.
      treeSitterState.treeSitterWorkerPool=pool;
      treeSitterState.treeSitterWorkerConfigSignature=signature;
      treeSitterState.treeSitterWorkerMaxQueue=config.maxQueue;
      await retirePool(options, 'tree-sitter.worker-pool.stale-initialization');
      return null;
    }
    treeSitterState.treeSitterWorkerPool=pool;
    treeSitterState.treeSitterWorkerConfigSignature=signature;
    treeSitterState.treeSitterWorkerMaxQueue=config.maxQueue;
    return viewLegacyPool(pool, config, generation);
  });
};

export const shutdownTreeSitterWorkerPool = (options={})=>{
  lifecycleGeneration+=1;
  shutdownPending+=1;
  return Promise.allSettled([serializeLifecycle(()=>retirePool(options,'tree-sitter.worker-pool.shutdown')),
    scopedWorkerPools.shutdownAll()]).then(results => {
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw failures.slice(1).reduce((error, secondary) => addStorageFailureContext(error,
      {}, secondary, { secondaryPresent: true }), failures[0]);
  }).finally(()=>{shutdownPending-=1;});
};
