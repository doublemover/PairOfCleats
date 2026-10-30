import { registerHooks } from 'node:module';
if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('The benchmark clock fixture requires the test environment.');
const mode = new URL(import.meta.url).searchParams.get('mode');
let now = 0n;
const originalClock = process.hrtime.bigint.bind(process.hrtime);
process.hrtime.bigint = () => {
  const caller = new Error().stack?.split('\n')[2] || '';
  const measurementOwner = mode === 'hash' ? caller.includes('/tools/bench/micro/utils.js')
    : /[\\/]tools[\\/]bench[\\/]vfs[\\/](coalesce-docs|parallel-manifest-build|merge-runs-heap|partial-lsp-open)\.js/.test(caller);
  if (!measurementOwner) return originalClock();
  const result = now; if (mode !== 'hash') now += 10000000n; return result;
};
if (mode === 'hash') {
  const key = Symbol.for('poc.segment-hash-count'); globalThis[key] = { advance: () => { now += 10000000n; } };
  registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/bench/vfs/segment-hash-cache.js') && specifier.endsWith('/hash.js')) return { url: 'counted-segment-hash:owner', shortCircuit: true };
    return next(specifier, context);
  }, load(url, context, next) {
    return url === 'counted-segment-hash:owner' ? { format: 'module', shortCircuit: true,
      source: `export const checksumString=async text=>{if(typeof text!=='string')throw new Error('undefined segment operand');
        globalThis[Symbol.for('poc.segment-hash-count')].advance();return {value:text};};` } : next(url, context);
  } });
}
