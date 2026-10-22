import { readEffectiveCpu } from '../../shared/effective-cpu.js';
import { readEffectiveMemory } from '../../shared/effective-memory.js';
import { fileURLToPath } from 'node:url';
import { treeSitterState } from './state.js';
import { destroyPiscinaPool } from '../../shared/piscina-cleanup.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
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
const serializeLifecycle=task=>{
  const pending=lifecycleTail.then(task);
  lifecycleTail=pending.catch(()=>{});
  return pending;
};
const retirePool=async(options,label)=>{
  const pool=treeSitterState.treeSitterWorkerPool;
  if(!pool)return;
  try {
    const result = await destroyPiscinaPool(pool,{label,log:options?.log,
      destroyTimeoutMs:Number.isFinite(Number(options?.cleanupTimeoutMs))?Math.max(1000,Math.floor(Number(options.cleanupTimeoutMs))):30000});
    if (result?.skipped || (result?.forced && result?.forcedSummary?.failed > 0)) {
      throw Object.assign(new Error('Tree-sitter worker cleanup was not confirmed.'), { code: 'ERR_TREE_SITTER_WORKER_CLEANUP' });
    }
  }catch(error){retirementError=error;throw error;}
  if(treeSitterState.treeSitterWorkerPool===pool){
    treeSitterState.treeSitterWorkerPool=null;
    treeSitterState.treeSitterWorkerConfigSignature=null;
    treeSitterState.treeSitterWorkerMaxQueue=null;
  }
  retirementError=null;
};

export const getTreeSitterWorkerPool = async(rawConfig,options={})=>{
  const config=normalizeTreeSitterWorkerConfig(rawConfig);
  if(!config.enabled||shutdownPending>0)return null;
  const generation=lifecycleGeneration;
  const signature=JSON.stringify(config);
  return serializeLifecycle(async()=>{
    if(generation!==lifecycleGeneration||shutdownPending>0)return null;
    if(retirementError)throw retirementError;
    if(treeSitterState.treeSitterWorkerPool&&treeSitterState.treeSitterWorkerConfigSignature===signature)return treeSitterState.treeSitterWorkerPool;
    await retirePool(options,'tree-sitter.worker-pool.reconfigure');
    if(generation!==lifecycleGeneration||shutdownPending>0)return null;
    let Piscina;
    try{Piscina=(await import('piscina')).default;}
    catch(error){
      if(options?.log&&!treeSitterState.loggedWorkerFailures.has('piscina')){
        options.log('[tree-sitter] Worker pool unavailable: '+(error?.message||error));
        treeSitterState.loggedWorkerFailures.add('piscina');
      }
      return null;
    }
    if(generation!==lifecycleGeneration||shutdownPending>0)return null;
    try{
      const execArgv=buildWorkerExecArgv();
      const resourceLimits=resolveWorkerResourceLimits(config.maxWorkers);
      const pool=new Piscina({filename:fileURLToPath(new URL('../workers/tree-sitter-worker.js',import.meta.url)),
        maxThreads:config.maxWorkers,maxQueue:config.maxQueue,idleTimeout:config.idleTimeoutMs,taskTimeout:config.taskTimeoutMs,
        ...(execArgv.length?{execArgv}:{}),...(resourceLimits?{resourceLimits}:{})});
      treeSitterState.treeSitterWorkerPool=pool;
      treeSitterState.treeSitterWorkerConfigSignature=signature;
      treeSitterState.treeSitterWorkerMaxQueue=config.maxQueue;
      return pool;
    }catch(error){
      if(options?.log&&!treeSitterState.loggedWorkerFailures.has('init')){
        options.log('[tree-sitter] Worker pool init failed: '+(error?.message||error));
        treeSitterState.loggedWorkerFailures.add('init');
      }
      return null;
    }
  });
};

export const shutdownTreeSitterWorkerPool = (options={})=>{
  lifecycleGeneration+=1;
  shutdownPending+=1;
  return serializeLifecycle(()=>retirePool(options,'tree-sitter.worker-pool.shutdown'))
    .finally(()=>{shutdownPending-=1;});
};
