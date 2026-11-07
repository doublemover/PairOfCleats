import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWatchSourceObservations } from '../../../src/index/build/watch/source-observations.js';
import { createObservationClock } from './observation-clock.js';
import { createTempWatchRepo, createWatchRuntime, createWatchDeps, normalizeAbsPath, startCodeWatch, waitFor } from './helpers.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const fail = code => Object.assign(new Error(`injected ${code}`), { code });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/watch/source-observation-replay/')[1];
assert.ok(['chokidar', 'parcel', 'ownership'].includes(selected));
const start = async (backend, observe, { beforeBuild = async () => {}, observeStability = ({ stat }) => stat() } = {}) => {
  const repo = await createTempWatchRepo({ prefix: 'poc-watch-observation-', files: {
    a: { rel: 'src/a.js', content: 'export const a = 1;\n' },
    b: { rel: 'src/b.js', content: 'export const b = 2;\n' }
  } });
  const clock = createObservationClock(), builds = [], publications = [], states = [], calls = new Map();
  const { deps, getOnEvent } = createWatchDeps({ backend, entries: Object.values(repo.files),
    buildIndexForMode: async ({ discovery }) => {
      const contents = {};
      for (const entry of discovery.entries) contents[entry.rel] = await fs.readFile(entry.abs, 'utf8');
      builds.push({ entries: discovery.entries.map(entry => normalizeAbsPath(entry.abs)),
        skipped: discovery.skippedFiles.map(entry => normalizeAbsPath(entry.file)), contents });
      await beforeBuild(builds.length);
    },
    promoteBuild: async ({ buildId }) => { publications.push({ buildId, discovery: builds.at(-1) }); }
  });
  deps.lstatPath = async file => {
    const name = normalizeAbsPath(file) === normalizeAbsPath(repo.files.a.abs) ? 'a' : 'b';
    const count = (calls.get(name) || 0) + 1;
    calls.set(name, count);
    return observe({ name, count, file, repo, stat: () => fs.lstat(file) });
  };
  deps.stabilityStatPath = file => observeStability({ file, stat: () => fs.stat(file) });
  deps.createWatchSourceObservations = options => createWatchSourceObservations({ ...options, ...clock });
  const runtime = await createWatchRuntime({ repoRoot: repo.repoRoot });
  const watch = startCodeWatch({ runtime, deps, onStateChange: state => {
    states.push(state);
    if (state.sourceObservations.pending) {
      assert.equal(state.consistency, 'catching-up');
      assert.equal(state.quiescent, false);
      assert.equal(state.pendingReplay, true);
      assert.ok(state.backlogDepth > 0, 'unresolved observation must retain backlog');
    }
  } });
  await watch.ready;
  const event = (name, type = 'change') => getOnEvent()({ type, absPath: repo.files[name].abs });
  const pending = async count => waitFor(() => runtime.watchState.sourceObservations.pending === count
    && !runtime.watchState.updateQueueRunning);
  return { ...repo, ...watch, clock, builds, publications, states, calls, runtime, event, pending,
    async stop() {
      watch.abortController.abort();
      const result = await watch.watchPromise;
      await fs.rm(repo.tempRoot, { recursive: true, force: true });
      return result;
    } };
};

for (const backend of selected === 'ownership' ? [] : [selected]) {
  for (const code of ['EIO', 'EMFILE', 'ENOENT', 'atomic-save']) {
    const context = await start(backend, async ({ name, count, stat, file }) => {
      if (name === 'a' && code === 'atomic-save') {
        if (count === 1) await fs.rename(file, file + '.saving');
        return stat();
      }
      if (name === 'a' && count === 1) throw fail(code);
      return stat();
    });
    try {
      await fs.writeFile(context.files.a.abs, 'export const a = "new source bytes";\n');
      context.event('a');
      context.event('b');
      await context.pending(1);
      if (code === 'atomic-save') await fs.rename(context.files.a.abs + '.saving', context.files.a.abs);
      await waitFor(() => context.calls.get('b') === 1 && !context.runtime.watchState.updateQueueRunning);
      assert.equal(context.publications.length, 0, 'unknown source must block publication');
      context.clock.advance(49);
      await turn();
      assert.equal(context.calls.get('a'), 1);
      context.clock.advance(1);
      await waitFor(() => context.publications.length > 0 && context.runtime.watchState.quiescent);
      const published = context.publications.at(-1).discovery;
      assert.ok(published.entries.includes(normalizeAbsPath(context.files.a.abs)), backend + '/' + code);
      assert.ok(published.entries.includes(normalizeAbsPath(context.files.b.abs)));
      assert.ok(!published.skipped.includes(normalizeAbsPath(context.files.a.abs)));
      assert.equal(published.contents['src/a.js'], 'export const a = "new source bytes";\n');
      assert.equal(context.calls.get('a'), 2, 'one event must recover through its owned retry');
      assert.equal(context.calls.get('b'), 1, 'successful sibling must not be reclassified on retry');
      assert.equal(context.runtime.watchState.lastConsistentGeneration.publicationCommitted, true);
    } finally { await context.stop(); }
  }

  const persistent = await start(backend, ({ name, stat }) => { if (name === 'a') throw fail('EACCES'); return stat(); });
  try {
    persistent.event('a');
    await persistent.pending(1);
    for (let attempt = 1; attempt <= 9; attempt++) {
      const delay = Math.min(5000, 50 * 2 ** (attempt - 1));
      persistent.clock.advance(delay - 1);
      await turn();
      assert.equal(persistent.calls.get('a'), attempt);
      persistent.clock.advance(1);
      await waitFor(() => persistent.calls.get('a') === attempt + 1
        && persistent.runtime.watchState.sourceObservations.failures[0]?.attempt === attempt + 1);
      await persistent.pending(1);
    }
    assert.equal(persistent.publications.length, 0);
    assert.equal(persistent.builds.length, 0);
    const calls = persistent.calls.get('a');
    await persistent.stop();
    assert.equal(persistent.clock.pending(), 0);
    persistent.clock.advance(100000);
    await turn();
    assert.equal(persistent.calls.get('a'), calls);
    assert.equal(persistent.runtime.watchState.sourceObservations.pending, 1);
    assert.equal(persistent.runtime.watchState.consistency, 'catching-up');
  } finally { await persistent.stop(); }

  const absent = await start(backend, ({ stat }) => stat());
  try {
    await fs.unlink(absent.files.a.abs);
    absent.event('a');
    await absent.pending(1);
    assert.equal(absent.publications.length, 0);
    absent.clock.advance(50);
    await waitFor(() => absent.publications.length > 0 && absent.runtime.watchState.quiescent);
    const published = absent.publications.at(-1).discovery;
    assert.ok(!published.entries.includes(normalizeAbsPath(absent.files.a.abs)));
    assert.ok(published.entries.includes(normalizeAbsPath(absent.files.b.abs)));
    assert.ok(published.skipped.includes(normalizeAbsPath(absent.files.a.abs)));
    assert.equal(absent.clock.pending(), 0, 'confirmed absence retires the retry timer');
  } finally { await absent.stop(); }
}

if (selected === 'ownership') {
  let stabilityFailure = true;
  const stability = await start('parcel', ({ stat }) => stat(), { observeStability: ({ stat }) => {
    if (stabilityFailure) { stabilityFailure = false; throw fail('EMFILE'); }
    return stat();
  } });
  try {
    stability.event('a');
    await stability.pending(1);
    assert.equal(stability.runtime.watchState.sourceObservations.failures[0].code, 'EMFILE');
    assert.equal(stability.calls.get('a'), undefined, 'failed stability observation cannot admit later classification');
    assert.equal(stability.publications.length, 0);
    stability.clock.advance(50);
    await waitFor(() => stability.publications.length > 0 && stability.runtime.watchState.quiescent);
    assert.ok(stability.publications.at(-1).discovery.entries.includes(normalizeAbsPath(stability.files.a.abs)));
  } finally { await stability.stop(); }

  let release, entered = false;
  const active = await start('chokidar', ({ name, count, stat }) => {
    if (name === 'a' && count === 2) throw fail('EIO');
    return stat();
  }, { beforeBuild: async count => {
    if (count === 1) { entered = true; await new Promise(resolve => { release = resolve; }); }
  } });
  try {
    active.event('a');
    await waitFor(() => entered);
    await fs.writeFile(active.files.a.abs, 'export const a = "after active build";\n');
    active.event('a');
    await active.pending(1);
    release();
    await waitFor(() => !active.runtime.watchState.running);
    assert.equal(active.publications.length, 0, 'the active attempt cannot publish after failed observation');
    active.clock.advance(50);
    await waitFor(() => active.publications.length > 0 && active.runtime.watchState.quiescent);
    assert.equal(active.publications.at(-1).discovery.contents['src/a.js'], 'export const a = "after active build";\n');
  } finally { release?.(); await active.stop(); }

  entered = false;
  const unlinked = await start('chokidar', async ({ name, stat }) => {
    const observed = await stat();
    if (name === 'a') { entered = true; await new Promise(resolve => { release = resolve; }); }
    return observed;
  });
  try {
    unlinked.event('a');
    await waitFor(() => entered);
    await fs.unlink(unlinked.files.a.abs);
    unlinked.event('a', 'unlink');
    await turn();
    assert.equal(unlinked.publications.length, 0, 'publication must wait for the active observation owner');
    release();
    await waitFor(() => unlinked.publications.length > 0 && unlinked.runtime.watchState.quiescent);
    assert.ok(!unlinked.publications.at(-1).discovery.entries.includes(normalizeAbsPath(unlinked.files.a.abs)),
      'a late successful observation must not undo unlink');
  } finally { release?.(); await unlinked.stop(); }

  entered = false;
  const shutdown = await start('chokidar', async ({ name, stat }) => {
    if (name === 'a') { entered = true; await new Promise(resolve => { release = resolve; }); }
    return stat();
  });
  let settled = false;
  shutdown.watchPromise.then(() => { settled = true; }, () => { settled = true; });
  try {
    shutdown.event('a');
    await waitFor(() => entered);
    shutdown.abortController.abort();
    await turn();
    assert.equal(settled, false, 'shutdown must own active classification until it settles');
    assert.equal(shutdown.publications.length, 0);
    release();
    await shutdown.watchPromise;
    assert.equal(shutdown.publications.length, 0);
    assert.equal(shutdown.clock.pending(), 0);
  } finally { release?.(); await shutdown.stop(); }
}
console.log('watch source observation replay test passed');
