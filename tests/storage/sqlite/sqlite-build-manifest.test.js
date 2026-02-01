#!/usr/bin/env node
import assert from 'node:assert/strict';
import { diffFileManifests, isManifestMatch, normalizeManifestFiles } from '../../../src/storage/sqlite/build/manifest.js';

const manifestFiles = {
  'src/conflict.js': { hash: 'aaa', mtimeMs: 1, size: 10 },
  'src\\conflict.js': { hash: 'bbb', mtimeMs: 2, size: 20 },
  'src/unchanged.js': { hash: 'keep', mtimeMs: 5, size: 50 },
  'src/changed.js': { mtimeMs: 9, size: 90 }
};

const normalized = normalizeManifestFiles(manifestFiles);
assert.ok(normalized.conflicts.includes('src/conflict.js'), 'expected conflict to be recorded');
assert.equal(normalized.entries.length, 3, 'expected normalized entries to dedupe conflicts');

const dbFiles = new Map();
dbFiles.set('src/unchanged.js', { hash: 'keep', mtimeMs: 5, size: 50 });
dbFiles.set('src/changed.js', { hash: 'old', mtimeMs: 8, size: 90 });
dbFiles.set('src/deleted.js', { hash: 'gone', mtimeMs: 1, size: 10 });

const { changed, deleted } = diffFileManifests(normalized.entries, dbFiles);

assert.ok(changed.some((record) => record.normalized === 'src/changed.js'), 'expected changed file to be detected');
assert.ok(!changed.some((record) => record.normalized === 'src/unchanged.js'), 'expected unchanged file to be skipped');
assert.deepEqual(deleted, ['src/deleted.js'], 'expected deleted file list');

const matchByHash = isManifestMatch({ hash: 'abc' }, { hash: 'abc', mtimeMs: 1, size: 1 });
assert.equal(matchByHash, true, 'expected hash match to win');
const matchByMeta = isManifestMatch({ mtimeMs: 5, size: 50 }, { mtimeMs: 5, size: 50 });
assert.equal(matchByMeta, true, 'expected mtime+size match');

const hashUpgradeEntry = { hash: 'newhash', mtimeMs: 5, size: 50 };
const dbMissingHash = { mtimeMs: 5, size: 50 };
const strictMatch = isManifestMatch(hashUpgradeEntry, dbMissingHash, { strictHash: true });
assert.equal(strictMatch, false, 'expected strict hash mismatch when db hash missing');

const manifestUpgrade = [{ file: 'src/upgrade.js', normalized: 'src/upgrade.js', entry: hashUpgradeEntry }];
const dbUpgrade = new Map([['src/upgrade.js', dbMissingHash]]);
const diffUpgrade = diffFileManifests(manifestUpgrade, dbUpgrade);
assert.equal(diffUpgrade.changed.length, 0, 'expected hash-only upgrade to avoid full rebuild');
assert.equal(diffUpgrade.manifestUpdates.length, 1, 'expected manifest update to fill missing hash');

console.log('sqlite build manifest test passed');
