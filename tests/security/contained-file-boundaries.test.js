import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readContainedFile, openContainedFileSync } from '../../src/shared/contained-file.js';
import { assertSafeCacheDeletion } from '../../src/shared/cache-deletion.js';
import { buildPrimaryExcerpt, clearContextPackCaches } from '../../src/context-pack/excerpt-cache.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-contained-'));
const repo = path.join(tmp, 'repo');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(repo);
fs.mkdirSync(outside);
const file = path.join(repo, 'sample.txt');
const external = path.join(outside, 'fixture.txt');
fs.writeFileSync(file, 'safe fixture');
fs.writeFileSync(external, 'outside fixture sentinel');
try {
  assert.equal((await readContainedFile(repo, file)).toString(), 'safe fixture');
  const fd = openContainedFileSync(repo, file);
  assert.equal(fs.readFileSync(fd, 'utf8'), 'safe fixture');
  fs.closeSync(fd);
  const first = buildPrimaryExcerpt({ chunk: { file: 'sample.txt', start: 0, end: 12 }, repoRoot: repo, maxBytes: 32, warnings: [] });
  assert.equal(first.excerpt, 'safe fixture');
  fs.unlinkSync(file);
  fs.symlinkSync(external, file);
  await assert.rejects(() => readContainedFile(repo, file), /authorized root|symlink/);
  assert.throws(() => openContainedFileSync(repo, file));
  clearContextPackCaches();
  const unavailable = buildPrimaryExcerpt({ chunk: { file: 'sample.txt', start: 0, end: 12 }, repoRoot: repo, maxBytes: 32, warnings: [] });
  assert.equal(unavailable.excerpt, '');
  assert.ok(unavailable.evidence.warningCodes.includes('PRIMARY_PATH_UNAVAILABLE'));
  const linkDir = path.join(repo, 'linked');
  fs.symlinkSync(outside, linkDir, 'dir');
  await assert.rejects(() => readContainedFile(repo, path.join(linkDir, 'fixture.txt')));
  assert.throws(() => assertSafeCacheDeletion(outside, [repo]));
  assert.throws(() => assertSafeCacheDeletion(linkDir, [repo]));
  assert.throws(() => assertSafeCacheDeletion(path.join(repo, 'new-cache'), [repo]));
  fs.writeFileSync(path.join(repo, '.pairofcleats-cache-owner.json'), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  assert.equal(assertSafeCacheDeletion(path.join(repo, 'new-cache'), [repo]), path.join(repo, 'new-cache'));
  assert.equal(fs.readFileSync(external, 'utf8'), 'outside fixture sentinel', 'no external reads/deletes are performed by cleanup validation');
  console.log('descriptor-backed repository reads and cleanup containment passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
