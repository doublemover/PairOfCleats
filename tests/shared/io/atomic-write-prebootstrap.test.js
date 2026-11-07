import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { makeTempDir } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { incAtomicPersistenceFallback, getAtomicPersistenceFallbackCounts } from '../../../src/shared/metrics/atomic-persistence.js';

const env = applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/io/atomic-write-prebootstrap/')[1];
assert.ok(['dependency-free-publication', 'late-metric-owner', 'active-metric-reset'].includes(mode));
if (mode === 'dependency-free-publication') {
  const root = await makeTempDir('atomic-prebootstrap-'), target = path.join(root, 'owned.json');
  const atomicUrl = new URL('../../../src/shared/io/atomic-write.js', import.meta.url).href;
  const source = `import {registerHooks} from 'node:module';
    let external=0;
    registerHooks({resolve(specifier,context,next){
      if(!specifier.startsWith('.')&&!specifier.startsWith('node:')&&!specifier.startsWith('file:')){
        external++;throw new Error('External dependency before bootstrap: '+specifier);
      }return next(specifier,context);
    }});
    const {atomicWriteJson}=await import(${JSON.stringify(atomicUrl)});
    await atomicWriteJson(${JSON.stringify(target)},{source:'actual atomic publication'},{mkdir:false,durable:true});
    console.log(JSON.stringify({external}));`;
  try {
    const result = runNode(['--input-type=module', '--eval', source], 'dependency-free atomic publication', process.cwd(), env,
      { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { external: 0 });
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { source: 'actual atomic publication' });
    assert.deepEqual(await fs.readdir(root), ['owned.json'], 'actual publication closes/removes its original staging resources');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
} else if (mode === 'late-metric-owner') {
  const thinUrl = new URL('../../../src/shared/metrics/atomic-persistence.js', import.meta.url).href,
    coreUrl = new URL('../../../src/shared/metrics/core.js', import.meta.url).href;
  const source = `import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
    let rendererAllowed=false;
    registerHooks({resolve(specifier,context,next){if(specifier==='@prometheus-io/client'&&!rendererAllowed)
      throw new Error('Metrics renderer loaded before dependency-free events');return next(specifier,context);}});
    const thin=await import(${JSON.stringify(thinUrl)});
    thin.incAtomicPersistenceFallback({reason:' EXDEV '});thin.incAtomicPersistenceFallback({reason:'exdev'});
    thin.incAtomicPersistenceFallback({reason:'noncanonical-label'});
    assert.deepEqual(thin.getAtomicPersistenceFallbackCounts(),[{reason:'exdev',count:2},{reason:'unknown',count:1}]);
    rendererAllowed=true;const core=await import(${JSON.stringify(coreUrl)});
    assert.equal(core.incAtomicPersistenceFallback,thin.incAtomicPersistenceFallback);
    const first=await core.getMetricsText();
    assert.ok(first.includes('pairofcleats_atomic_persistence_fallbacks_total{reason="exdev"} 2'));
    assert.ok(first.includes('pairofcleats_atomic_persistence_fallbacks_total{reason="unknown"} 1'));
    core.incAtomicPersistenceFallback({reason:'exdev'});
    assert.ok((await core.getMetricsText()).includes('pairofcleats_atomic_persistence_fallbacks_total{reason="exdev"} 3'));
    console.log('late metrics projected exactly once');`;
  const result = runNode(['--input-type=module', '--eval', source], 'late atomic metrics projection', process.cwd(), env,
    { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /late metrics projected exactly once/);
} else {
  const core = await import('../../../src/shared/metrics/core.js');
  core.getMetricsRegistry();
  incAtomicPersistenceFallback({ reason: 'exdev' }); core.incAtomicPersistenceFallback({ reason: 'exdev' });
  assert.match(await core.getMetricsText(), /pairofcleats_atomic_persistence_fallbacks_total\{reason="exdev"\} 2/);
  core.getMetricsRegistry().resetMetrics(); core.incAtomicPersistenceFallback({ reason: 'exdev' });
  assert.match(await core.getMetricsText(), /pairofcleats_atomic_persistence_fallbacks_total\{reason="exdev"\} 1/,
    'a deliberate registry reset keeps its existing active-registry semantics');
  assert.equal(getAtomicPersistenceFallbackCounts().find(row => row.reason === 'exdev').count, 3);
}
console.log('Atomic persistence works before dependencies and preserves late/active metric projection');
