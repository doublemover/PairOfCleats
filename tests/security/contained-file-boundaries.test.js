import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readContainedFile, openContainedFileSync } from '../../src/shared/contained-file.js';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../../src/shared/cache-deletion.js';
import { buildPrimaryExcerpt, clearContextPackCaches } from '../../src/context-pack/excerpt-cache.js';
import { readTextFileWithHash } from '../../src/shared/encoding.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poc-contained-')));
const repo = path.join(tmp, 'repo');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(repo);
fs.mkdirSync(outside);
const slot = path.join(repo, 'slot');
fs.mkdirSync(slot);
const file = path.join(slot, 'sample.txt');
const external = path.join(outside, 'sample.txt');
fs.writeFileSync(file, 'safe fixture');
fs.writeFileSync(external, 'outside fixture sentinel');
try {
  assert.equal((await readContainedFile(repo, file)).toString(), 'safe fixture');
  const discoveredStat = fs.lstatSync(file);
  assert.equal((await readTextFileWithHash(file, { repoRoot: repo, stat: discoveredStat })).text, 'safe fixture');
  const fd = openContainedFileSync(repo, file);
  assert.equal(fs.readFileSync(fd, 'utf8'), 'safe fixture');
  fs.closeSync(fd);
  await assert.rejects(() => readContainedFile(repo, repo), { code: 'EISDIR' });
  assert.throws(() => openContainedFileSync(repo, repo), { code: 'EISDIR' });
  const first = buildPrimaryExcerpt({ chunk: { file: 'slot/sample.txt', start: 0, end: 12 }, repoRoot: repo, maxBytes: 32, warnings: [] });
  assert.equal(first.excerpt, 'safe fixture');
  fs.unlinkSync(file);
  if (process.platform === 'win32') {
    fs.rmdirSync(slot);
    fs.symlinkSync(outside, slot, 'junction');
  } else fs.symlinkSync(external, file);
  await assert.rejects(() => readTextFileWithHash(file, { repoRoot: repo, stat: discoveredStat }));
  await assert.rejects(() => readContainedFile(repo, file), /authorized root|symlink/);
  assert.throws(() => openContainedFileSync(repo, file));
  clearContextPackCaches();
  const unavailable = buildPrimaryExcerpt({ chunk: { file: 'slot/sample.txt', start: 0, end: 12 }, repoRoot: repo, maxBytes: 32, warnings: [] });
  assert.equal(unavailable.excerpt, '');
  assert.ok(unavailable.evidence.warningCodes.includes('PRIMARY_PATH_UNAVAILABLE'));
  const linkDir = path.join(repo, 'linked');
  fs.symlinkSync(outside, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => readContainedFile(repo, path.join(linkDir, 'sample.txt')));
  assert.throws(() => assertSafeCacheDeletion(outside, [repo]));
  assert.throws(() => assertSafeCacheDeletion(linkDir, [repo]));
  assert.throws(() => assertSafeCacheDeletion(path.join(repo, 'new-cache'), [repo]));
  fs.writeFileSync(path.join(repo, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  assert.equal(assertSafeCacheDeletion(path.join(repo, 'new-cache'), [repo]), path.join(repo, 'new-cache'));
  // A valid ownership marker must not hide a symlink at any boundary. These
  // checks run after marking the root so rejection cannot come from ownership.
  const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';
  const rootLink = path.join(tmp, 'root-link');
  const parentLink = path.join(tmp, 'parent-link');
  const internalDir = path.join(repo, 'internal');
  const internalLink = path.join(repo, 'internal-link');
  fs.mkdirSync(internalDir);
  fs.symlinkSync(repo, rootLink, directoryLinkType);
  fs.symlinkSync(tmp, parentLink, directoryLinkType);
  fs.symlinkSync(internalDir, internalLink, directoryLinkType);
  for (const allowUnmarked of [false, true]) {
    const policy = { allowUnmarked };
    assert.throws(() => assertSafeCacheDeletion(path.parse(tmp).root, [repo], policy));
    assert.throws(() => assertSafeCacheDeletion(outside, [repo], policy));
    assert.throws(() => assertSafeCacheDeletion(linkDir, [repo], policy));
    assert.throws(() => assertSafeCacheDeletion(path.join(linkDir, 'missing'), [repo], policy));
    assert.throws(() => assertSafeCacheDeletion(internalLink, [repo], policy));
    assert.throws(() => assertSafeCacheDeletion(path.join(rootLink, 'new-cache'), [rootLink], policy));
    const redirectedRoot = path.join(parentLink, 'repo');
    assert.throws(() => assertSafeCacheDeletion(path.join(redirectedRoot, 'new-cache'), [redirectedRoot], policy));
  }
  const unmarked = path.join(tmp, 'unmarked');
  fs.mkdirSync(unmarked);
  const missingTarget = path.join(unmarked, 'missing', 'nested');
  assert.throws(() => assertSafeCacheDeletion(missingTarget, [unmarked]));
  assert.equal(assertSafeCacheDeletion(missingTarget, [unmarked], { allowUnmarked: true }), missingTarget);
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(repo, CACHE_OWNER_FILE), path.join(unmarked, CACHE_OWNER_FILE));
    assert.throws(() => assertSafeCacheDeletion(missingTarget, [unmarked]), 'a linked marker grants no ownership');
  }
  assert.equal(fs.readFileSync(external, 'utf8'), 'outside fixture sentinel', 'no external reads/deletes are performed by cleanup validation');
  console.log('descriptor-backed repository reads and cleanup containment passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
