const normalizeMemory = (value) => ({
  rss: value.rss,
  heapTotal: value.heapTotal,
  heapUsed: value.heapUsed,
  external: value.external,
  arrayBuffers: value.arrayBuffers
});

const diffMemory = (end, start) => ({
  rss: end.rss - start.rss,
  heapTotal: end.heapTotal - start.heapTotal,
  heapUsed: end.heapUsed - start.heapUsed,
  external: end.external - start.external,
  arrayBuffers: end.arrayBuffers - start.arrayBuffers
});

/**
 * Create a lightweight retrieval stage timing/memory tracker.
 * @param {{enabled?:boolean}} [options]
 * @returns {{enabled:boolean,mark:()=>object|null,record:(stage:string,start:object,meta?:object)=>void,span:(stage:string,metaOrFn:any,fn?:Function)=>Promise<any>,spanSync:(stage:string,metaOrFn:any,fn?:Function)=>any,stages:Array<object>}}
 */
export function createRetrievalStageTracker({ enabled = true } = {}) {
  const stages = [];
  const mark = () => {
    if (!enabled) return null;
    return {
      time: process.hrtime.bigint(),
      memory: process.memoryUsage()
    };
  };
  const record = (stage, start, meta = null) => {
    if (!enabled || !start) return;
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    const elapsedMs = Number(endTime - start.time) / 1e6;
    const entry = {
      stage,
      elapsedMs,
      memory: normalizeMemory(endMemory),
      delta: diffMemory(endMemory, start.memory)
    };
    if (meta && typeof meta === 'object') {
      Object.assign(entry, meta);
    }
    stages.push(entry);
  };
  const spanSync = (stage, meta, fn) => {
    const hasMeta = typeof meta === 'object' && typeof fn === 'function';
    const handler = hasMeta ? fn : meta;
    const info = hasMeta ? meta : null;
    if (!enabled) return handler();
    const start = mark();
    const result = handler();
    record(stage, start, info);
    return result;
  };
  const span = async (stage, meta, fn) => {
    const hasMeta = typeof meta === 'object' && typeof fn === 'function';
    const handler = hasMeta ? fn : meta;
    const info = hasMeta ? meta : null;
    if (!enabled) return handler();
    const start = mark();
    const result = await handler();
    record(stage, start, info);
    return result;
  };
  return {
    enabled,
    mark,
    record,
    span,
    spanSync,
    stages
  };
}
