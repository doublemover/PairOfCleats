import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { bindClaimedJobExecution } from '../../../tools/service/indexer-service/queue-worker.js';
import { startBuildProgressMonitor } from '../../../tools/service/indexer-service/progress-monitor.js';

const root = await makeTempDir('service-bound-progress-');
const originalOpen = fs.open, originalReadDir = fs.readdir, originalStat = fs.stat;
const stops = [];
try {
  for (const retained of [1, 8, 32]) {
    const cache = path.join(root, String(retained)), builds = path.join(cache, 'builds'), repo = path.join(cache, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const jobs = [0, 1].map(index => bindClaimedJobExecution({ id: `job-${retained}-${index}`, repo, stage: 'stage2' }));
    const state = (id, job, processed = 1) => ({ buildId: id, buildRoot: path.join(builds, id), repoRoot: repo,
      stage: 'stage2', phases: { stage2: { status: 'running' } }, progress: { code: { processedFiles: processed, totalFiles: 10 } },
      runtime: { latestAttemptId: id + '-attempt', attempts: [{ attemptId: id + '-attempt', buildId: id,
        stage: 'stage2', correlationId: job.observability.correlation.correlationId }] } });
    const write = async value => { await fs.mkdir(value.buildRoot, { recursive: true }); await fs.writeFile(path.join(value.buildRoot, 'build_state.json'), JSON.stringify(value)); };
    for (let index = 0; index < retained; index++) {
      const old = state(`old-${index}`, { observability: { correlation: { correlationId: 'foreign' } } });
      await write(old); await fs.utimes(path.join(old.buildRoot, 'build_state.json'), new Date(0), new Date(0));
    }
    const current = jobs.map((job, index) => state(`current-${index}`, job));
    for (const value of current) await write(value);
    const work = { directories: 0, stats: 0, opens: 0 }, logs = [];
    fs.readdir = async (location, ...args) => { if (path.resolve(String(location)) === builds) work.directories++; return originalReadDir(location, ...args); };
    fs.stat = async (location, ...args) => { if (String(location).endsWith('build_state.json')) work.stats++; return originalStat(location, ...args); };
    fs.open = async (location, ...args) => { if (String(location).endsWith('build_state.json')) work.opens++; return originalOpen(location, ...args); };
    const monitors = jobs.map(job => startBuildProgressMonitor({ job, repoPath: repo, stage: 'stage2', repoCacheRoot: cache,
      log: line => logs.push(line) })); stops.push(...monitors);
    await Promise.all(monitors.map(stop => stop.poll()));
    assert.ok(monitors.every(stop => stop.getDiagnostics().binding));
    work.directories = 0; work.stats = 0; work.opens = 0;
    for (let poll = 0; poll < 3; poll++) await Promise.all(monitors.map(stop => stop.poll()));
    assert.equal(work.directories, 0); assert.equal(work.stats, 0); assert.equal(work.opens, 6,
      'two bound monitors each read exactly their own state, independently of retained history');
    for (const stop of monitors) { assert.equal(stop.getDiagnostics().discoveries, 1); assert.equal(stop.getDiagnostics().boundReads, 3); }
    const foreign = structuredClone(current[0]); foreign.runtime.attempts[0].correlationId = 'foreign';
    await write(foreign); await monitors[0].poll();
    assert.equal(monitors[0].getDiagnostics().binding, null); assert.equal(monitors[0].getDiagnostics().bindingInvalidations, 1);
    assert.ok(monitors[1].getDiagnostics().binding); await write(current[0]); await monitors[0].poll();
    await fs.writeFile(path.join(current[0].buildRoot, 'build_state.json'), 'broken'); await monitors[0].poll();
    assert.equal(monitors[0].getDiagnostics().binding, null); assert.ok(monitors[0].getDiagnostics().statuses.corrupt > 0);
    await write(current[0]); await monitors[0].poll();

    const entered = Promise.withResolvers(), release = Promise.withResolvers(), selected = path.join(current[0].buildRoot, 'build_state.json');
    fs.open = async (location, ...args) => {
      const handle = await originalOpen(location, ...args), read = handle.read;
      if (path.resolve(String(location)) === selected) handle.read = async function(...values) {
        entered.resolve(); await release.promise; return read.call(handle, ...values);
      };
      return handle;
    };
    const pending = monitors[0].poll();
    await Promise.race([entered.promise, pending.then(() => { throw new Error('Expected the real metadata read barrier.'); })]);
    assert.equal(monitors[0].poll(), pending, 'polls share one captured original read');
    let stopped = false; const closing = monitors[0]().then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(stopped, false);
    const beforeCloseLogs = logs.length; release.resolve(); await pending; await closing;
    assert.equal(logs.length, beforeCloseLogs, 'drained late reads cannot publish after close');
    assert.equal(monitors[0].getDiagnostics().binding, null); await monitors[0].poll(); await monitors[1]();
    fs.open = originalOpen; fs.readdir = originalReadDir; fs.stat = originalStat;
  }
} finally {
  fs.open = originalOpen; fs.readdir = originalReadDir; fs.stat = originalStat;
  for (const stop of stops) await stop();
  await rmDirRecursive(root);
}
console.log('Owned service progress revalidates one exact attempt with no steady history scan and drains one captured in-flight read.');
