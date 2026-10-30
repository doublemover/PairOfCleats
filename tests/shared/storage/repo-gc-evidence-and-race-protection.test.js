import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { inspectRepoStorageProtection, removeDerivedRepoCache } from '../../../src/shared/storage/repo-protection.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('poc-repo-gc-protection-');
try {
  const cacheRoot = path.join(temporary, 'cache');
  await fs.mkdir(path.join(cacheRoot, 'repos'), { recursive: true });
  await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  let next = 0;
  const create = async () => {
    const repo = path.join(cacheRoot, 'repos', `fixture-${String(++next).padStart(12, '0')}`);
    const file = path.join(repo, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const payload = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
    await fs.writeFile(file, payload);
    return { repo, file, payload };
  };
  for (const evidence of ['snapshots', 'diffs', 'triage', 'metrics', 'recovery', 'logs', 'pins']) {
    const { repo, file } = await create();
    const saved = path.join(repo, evidence, 'ordinary-user-evidence.txt');
    await fs.mkdir(path.dirname(saved), { recursive: true });
    await fs.writeFile(saved, 'preserve-evidence');
    const protection = await inspectRepoStorageProtection({ repoCacheRoot: repo, cacheRoot });
    assert.equal(protection.protected, true, `${evidence} protects the mixed root`);
    const removal = await withExclusiveRepoCacheCleanup(repo, () => removeDerivedRepoCache(protection, { cacheRoot }));
    assert.equal(removal.result.ok, false);
    assert.equal(await fs.readFile(saved, 'utf8'), 'preserve-evidence');
    assert.equal((await fs.stat(file)).isFile(), true, 'protected planning does not partially remove another category');
  }
  const unknown = await create();
  const ordinary = path.join(unknown.repo, 'ordinary-data.bin');
  await fs.writeFile(ordinary, 'unmarked-user-bytes');
  assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: unknown.repo, cacheRoot })).protected, true);
  assert.equal(await fs.readFile(ordinary, 'utf8'), 'unmarked-user-bytes');
  const incomplete = await create();
  assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: incomplete.repo, cacheRoot, maxEntries: 1 })).protected, true);
  const malformed = await create();
  await fs.writeFile(malformed.file, '{"__poc_generated":');
  assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: malformed.repo, cacheRoot })).protected, true);
  const denied = await create();
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    if (path.resolve(args[0]) === denied.file) throw Object.assign(new Error('fixture denied read'), { code: 'EACCES' });
    return originalOpen(...args);
  };
  try {
    assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: denied.repo, cacheRoot })).protected, true);
  } finally { fs.open = originalOpen; }
  assert.equal((await fs.stat(denied.file)).isFile(), true);
  const unmarkedCache = path.join(temporary, 'unmarked');
  const unmarkedRepo = path.join(unmarkedCache, 'repos', 'fixture-0123456789ab');
  await fs.mkdir(unmarkedRepo, { recursive: true });
  await fs.writeFile(path.join(unmarkedRepo, 'ordinary.txt'), 'never-adopted');
  const unmarkedGenerated = path.join(unmarkedRepo, `tree-sitter-chunk_lk1_${'c'.repeat(40)}.json`);
  await fs.writeFile(unmarkedGenerated, JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks')));
  assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: unmarkedRepo, cacheRoot: unmarkedCache })).protected, true);
  assert.equal((await fs.stat(unmarkedGenerated)).isFile(), true, 'a generated producer header does not adopt an unmarked container');
  const pinned = await create();
  await fs.writeFile(pinned.file, JSON.stringify(withGeneratedCacheMetadata({ pinned: true, chunks: [] }, 'tree-sitter-chunks')));
  assert.equal((await inspectRepoStorageProtection({ repoCacheRoot: pinned.repo, cacheRoot })).protected, true);
  const eligible = await create();
  const proof = await inspectRepoStorageProtection({ repoCacheRoot: eligible.repo, cacheRoot });
  assert.equal(proof.protected, false, 'the real registered producer header/path is positive disposal authority');
  const removed = await withExclusiveRepoCacheCleanup(eligible.repo, () => removeDerivedRepoCache(proof, { cacheRoot }));
  assert.equal(removed.result.ok, true);
  assert.equal(removed.result.deletedLogicalBytes, Buffer.byteLength(eligible.payload));
  await assert.rejects(fs.stat(eligible.repo), { code: 'ENOENT' });
  const race = await create();
  const raceProof = await inspectRepoStorageProtection({ repoCacheRoot: race.repo, cacheRoot });
  const late = path.join(race.repo, 'late-user-evidence.txt');
  const raced = await withExclusiveRepoCacheCleanup(race.repo, () => removeDerivedRepoCache(raceProof, { cacheRoot,
    hooks: { afterRevalidation: () => fs.writeFile(late, 'preserve-after-preview') } }));
  assert.equal(raced.result.ok, false, 'late ordinary data prevents empty-root removal');
  assert.equal(await fs.readFile(late, 'utf8'), 'preserve-after-preview');
  assert.equal((await fs.stat(race.repo)).isDirectory(), true);
  const replaced = await create();
  const oldProof = await inspectRepoStorageProtection({ repoCacheRoot: replaced.repo, cacheRoot });
  const retained = `${replaced.repo}.retained-fixture`;
  await fs.rename(replaced.repo, retained);
  await fs.mkdir(path.dirname(replaced.file), { recursive: true });
  await fs.writeFile(replaced.file, replaced.payload);
  const replacement = await withExclusiveRepoCacheCleanup(replaced.repo, () => removeDerivedRepoCache(oldProof, { cacheRoot }));
  assert.equal(replacement.result.ok, false, 'a same-named replacement root is not the previewed canonical object');
  assert.equal(await fs.readFile(replaced.file, 'utf8'), replaced.payload);
  assert.equal(await fs.readFile(path.join(retained, path.relative(replaced.repo, replaced.file)), 'utf8'), replaced.payload);
} finally { await rmDirRecursive(temporary); }
console.log('repo GC evidence, unknown authority and concurrent creation protection passed');
