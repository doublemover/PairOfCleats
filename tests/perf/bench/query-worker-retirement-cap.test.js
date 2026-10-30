import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveAdaptiveQueryWorkerCount } from './query-runtime.js';
import { executeBenchQueryPlan } from './query-execution.js';

const { dir } = await prepareIsolatedTestCacheDir('query-retirement-global-cap');
try {
  const script = path.join(dir, 'explicit-worker.cjs'), barrier = path.join(dir, 'barrier');
  await fs.writeFile(script, `const fs=require('node:fs');const send=value=>process.send(value);
    process.on('message',async message=>{
      if(message.type==='shutdown'){setTimeout(()=>process.exit(0),40);return;}
      if(message.type!=='run')return;
      const {id,meta}=message;send({type:'run-start',id,rssBytes:process.memoryUsage().rss});
      const start=Date.now();
      while(!fs.existsSync(message.args[0])){
        if(Date.now()-start>2000)throw new Error('parent barrier was not released');
        await new Promise(resolve=>setTimeout(resolve,1));
      }
      // The memory sibling completes while SQLite is retiring. An early
      // isBusy=false would let that sibling pump a replacement SQLite process.
      if(meta.backend==='memory')await new Promise(resolve=>setTimeout(resolve,10));
      send({type:'run-complete',id,rssBytes:process.memoryUsage().rss});
      send({id,ok:true,payload:{pid:process.pid}});
    });`);
  const plan = await resolveAdaptiveQueryWorkerCount({ requestedConcurrency: 2, backends: ['memory', 'sqlite', 'fts'],
    totalSystemMemoryBytes: 8 * 1024 ** 3, codeArtifactBytes: 0, proseArtifactBytes: 0, sqliteCodeBytes: 0, sqliteProseBytes: 0 });
  const live = new Set(), started = new Set(), starts = [], results = [];
  let peak = 0;
  const observed = await executeBenchQueryPlan({ plan,
    tasks: ['memory', 'sqlite', 'fts', 'memory', 'sqlite', 'fts'].map((backend, index) => ({ backend, index })),
    workerOptions: { workerScriptPath: script, env: applyTestEnv({ syncProcess: false }), onEvent(event) {
      if (event.type === 'process-start') { live.add(event.pid); peak = Math.max(peak, live.size); }
      if (event.type === 'process-close') live.delete(event.pid);
      if (event.type === 'run-start') {
        starts.push(event.meta.backend); started.add(event.pid);
        if (started.size >= 2) fsSync.writeFileSync(barrier, 'released');
      }
    } },
    async runTask(task, pool) { results.push(await pool.run([barrier], task)); }
  });
  assert.equal(results.length, 6); assert.equal(observed.completed, 6);
  assert.deepEqual(Object.fromEntries(['memory', 'sqlite', 'fts'].map(backend => [backend, starts.filter(value => value === backend).length])),
    { memory: 2, sqlite: 2, fts: 2 });
  assert.ok(peak <= 2, 'independently observed live processes must include retiring generations within the global cap');
  assert.equal(observed.peakLiveWorkerProcesses, peak);
  assert.equal(live.size, 0, 'stage close owns every created worker');
  assert.equal(new Set(results.map(result => result.pid)).size, 5, 'one memory process is reused; four SQLite-class queries retire separately');
  assert.ok(observed.peakKnownProcessRssBytes > 0, 'short operations retain real parent/worker RSS samples');
  assert.equal(observed.rssScope, 'sampled-benchmark-parent-and-known-query-workers');
  assert.equal(observed.processTreeRssPeakBytes, null, 'nested descendant memory is explicitly unobserved');
  assert.equal(observed.activeReservations, 0);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('actual grouped worker generations remain within the global cap through delayed retirement');
