import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { loadQueryCache } from '../../../src/retrieval/query-cache.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from './query-cache-fixture.js';

if (process.argv[2] === '--cache-publication-child') {
  const [, , , directory, query, action] = process.argv;
  if (action === 'snapshot') {
    const entries = loadQueryCache(path.join(directory, 'queryCache.json')).entries;
    process.send(entries.map(entry => ({ key: entry.key, ts: entry.ts, id: entry.payload.code[0].id })));
  } else {
    const lookup = await resolveQueryCacheLookup(createQueryCacheLookupInput(directory, { query }));
    const released = once(process, 'message');
    process.send({ cacheKey: lookup.cacheKey, cacheHit: lookup.cacheHit });
    await released;
    const persisted = await persistSearchSession(createQueryCachePersistInput(lookup, { query, codeHits: [{ id: query }] }));
    assert.equal(persisted.cacheShouldPersist, false, 'one-shot session awaits its canonical or metadata publication');
  }
  process.disconnect();
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-process-publication-'));
  const children = new Set();
  const launch = (query, action) => {
    const child = fork(new URL(import.meta.url), ['--cache-publication-child', root, query, action], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    children.add(child);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); });
    const ready = new Promise((resolve, reject) => {
      let received = false;
      child.once('message', message => { received = true; resolve(message); });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (!received) reject(new Error(`Cache child closed before admission (${code ?? signal}): ${stderr}`));
      });
    });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        children.delete(child);
        if (code === 0 && signal == null) resolve();
        else reject(new Error(`Cache child failed (${code ?? signal}): ${stderr}`));
      });
    });
    // Both promises are observed immediately while all processes prepare.
    ready.catch(() => {}); done.catch(() => {});
    return { child, ready, done };
  };
  try {
    const queries = Array.from({ length: 4 }, (_, index) => `cross-process-${index}`);
    const misses = queries.map(query => launch(query, 'search'));
    const prepared = await Promise.all(misses.map(child => child.ready));
    assert.ok(prepared.every(message => message.cacheHit === false), 'every child captures an independent cold snapshot before publication');
    for (const child of misses) child.child.send('publish');
    await Promise.all(misses.map(child => child.done));
    const cachePath = path.join(root, 'queryCache.json');
    const canonical = await fs.readFile(cachePath, 'utf8');
    const saved = JSON.parse(canonical);
    assert.deepEqual(saved.entries.map(entry => entry.key).sort(), prepared.map(message => message.cacheKey).sort());
    assert.deepEqual(saved.entries.map(entry => entry.payload.code[0].id).sort(), queries);

    const hits = queries.map(query => launch(query, 'search'));
    const warmed = await Promise.all(hits.map(child => child.ready));
    assert.ok(warmed.every(message => message.cacheHit === true));
    for (const child of hits) child.child.send('publish');
    await Promise.all(hits.map(child => child.done));
    assert.equal(await fs.readFile(cachePath, 'utf8'), canonical, 'completed one-shot hit processes persist only their awaited touch metadata');
    const touches = JSON.parse(await fs.readFile(`${cachePath}.touches.json`, 'utf8'));
    assert.equal(touches.entries.length, queries.length);
    assert.ok((await fs.stat(`${cachePath}.touches.json`)).size < 4096);

    const observer = launch('', 'snapshot');
    const observed = await observer.ready;
    await observer.done;
    assert.deepEqual(observed.map(entry => entry.id).sort(), queries, 'a fresh process recovers every result after all producers exit');
    for (const entry of observed) {
      assert.equal(entry.ts, touches.entries.find(touch => touch.key === entry.key).ts,
        'fresh canonical reload applies each exact payload touch');
    }
  } finally {
    const closing = [...children].map(child => new Promise(resolve => { child.once('close', resolve); child.kill(); }));
    await Promise.all(closing);
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('Independent one-shot query sessions merge cold snapshots and durably publish touch metadata before process exit.');
}
