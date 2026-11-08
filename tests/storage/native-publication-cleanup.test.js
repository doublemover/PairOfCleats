import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativePublicationFixture } from '../helpers/native-publication-fixture.js';
import { cleanupConfiguredNativeArtifact } from '../../src/index/build/native-backend-cleanup.js';
import { prepareConfiguredNativePublication, commitConfiguredNativePublication } from '../../src/shared/storage/native-publication-producer.js';
import { nativePublicationRegistryPaths, readNativePublicationRecord } from '../../src/shared/storage/native-publication.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import { runNode } from '../helpers/run-node.js';
import { runWithTimeout } from '../../src/shared/promise-timeout.js';
import { cleanArtifacts } from '../../tools/mcp/tools/handlers/artifacts.js';
import { writeSqliteShardFixtureArtifacts } from './sqlite/helpers/build-fixture.js';
import { writeSqliteArtifactManifest } from '../helpers/artifact-io-fixture.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { resolveRepoPath } from '../../tools/mcp/repo.js';
import { sameIdentityPath } from '../../src/shared/indexing/build-pointer-roots.js';
import { createSqliteBenchBundleFixture, publishSqliteBenchSource } from '../../tools/bench/sqlite/shared.js';
import { getIncrementalPaths, writeIncrementalManifest } from '../../src/storage/sqlite/incremental.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const match = /^(sqlite|lmdb)-(owned|source-retained|saved|unregistered|legacy|modified|replacement|reader|plan-race|foreign-home-reader|foreign-home-plan-race|readonly-unregistered|registered-coordinator-required|interrupted|malformed|duplicate|foreign-member|dry-run|shared|source-history|replaced-attempt|producer|builder|late-close|close-mutation|mcp|invalid-ready|compaction|zero-reuse|incremental)$/u.exec(selected || '');
assert.ok(match, 'a bounded native-publication case is required');
const [, backend, scenario] = match;
const require = createRequire(import.meta.url);
const fixture = await createNativePublicationFixture(backend, selected);
const { root, repoRoot, repoCacheRoot, cacheRoot, home, target, userConfig, env } = fixture;
const input = { repoRoot, userConfig, backend, mode: 'code', target };
let reader = null, buildLock = null, closing = null, releaseClose = null;
const originalStat = fs.lstat, originalRename = fs.rename, originalUnlink = fsSync.unlinkSync, originalMkdir = fsSync.mkdirSync;
let restoreNative = () => {};
const snapshot = async directory => {
  const result = [];
  const walk = async current => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      result.push([path.relative(directory, file), entry.isDirectory() ? 'directory' : (await fs.readFile(file)).toString('base64')]);
      if (entry.isDirectory()) await walk(file);
    }
  };
  await walk(directory); return result;
};
const populateSource = async (source, chunk = null) => {
  const chunks = Array.isArray(chunk) ? chunk : [chunk || { file: 'source.js', name: 'ownedPublication' }];
  const { pieceEntries } = await writeSqliteShardFixtureArtifacts({ indexDir: source.indexDir, chunkCount: chunks.length,
    fileCount: chunks.length, tokens: chunks[0].tokens || ['ownership'],
    decorateChunk: (_, index) => chunks[index] });
  await writeSqliteArtifactManifest(source.indexDir, [...pieceEntries,
    { name: 'index_state', path: 'index_state.json', format: 'json' }], { buildId: path.basename(path.dirname(source.indexDir)) });
};
try {
  let source, incrementalFixture = null, incrementalPaths = null;
  if (scenario === 'producer' || scenario === 'incremental') {
    source = await fixture.createSource();
    if (scenario === 'incremental') {
      assert.equal(backend, 'sqlite');
      incrementalPaths = getIncrementalPaths(repoCacheRoot, 'code');
      await fs.mkdir(incrementalPaths.bundleDir, { recursive: true });
      incrementalFixture = await createSqliteBenchBundleFixture({ bundleDir: incrementalPaths.bundleDir,
        fileCount: 4, chunksPerFile: 1, tokensPerChunk: 2, vocabularySize: 16 });
      assert.equal(await writeIncrementalManifest(incrementalPaths.manifestPath, incrementalFixture.manifest), true);
    }
    const initialChunk = incrementalFixture ? Array.from({ length: 4 }, (_, index) =>
      incrementalFixture.buildChunks(`src/file-${index}.js`, `v1-${index}`)[0]) : null;
    await populateSource(source, initialChunk);
    const generation = path.dirname(source.indexDir), relative = path.relative(repoCacheRoot, generation);
    await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: path.basename(generation),
      buildRoot: relative, promotedAt: fixture.sentinel, buildRootsByMode: { code: relative } }));
    if (backend === 'sqlite') runNode(['--input-type=module', '-e',
      "import { buildSqliteIndex } from './src/integrations/core/build-index/sqlite.js'; await buildSqliteIndex(process.argv[1], {mode:'code',emitOutput:false,incremental:process.argv[2]==='incremental'});", repoRoot, scenario],
    'canonical SQLite publication fixture', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe' });
    else runNode(['tools/build/lmdb-index.js', '--repo', repoRoot, '--mode', 'code'],
      'canonical LMDB publication fixture', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe' });
    reader = fixture.openReader();
    assert.deepEqual(reader.readChunks(), initialChunk ? initialChunk.map(chunk => ({ name: chunk.name }))
      : [{ name: 'ownedPublication' }], 'real backend consumes the admitted nonempty source artifact');
    await reader.close(); reader = null;
  } else {
    source = await fixture.createSource();
    if (scenario === 'legacy') {
      await fixture.createStore(source, { registered: false });
      await fixture.createStore(source);
    } else if (scenario === 'invalid-ready') {
      await assert.rejects(fixture.createStore(source, { beforeCommit: async () => {
        const file = path.join(source.indexDir, 'index_state.json'), state = JSON.parse(await fs.readFile(file, 'utf8'));
        state[backend][backend === 'sqlite' ? 'status' : 'ready'] = backend === 'sqlite' ? 'failed' : false;
        await fs.writeFile(file, JSON.stringify(state));
      } }), /actual ready index-state producer/);
    } else if (scenario === 'replaced-attempt') {
      let replacement;
      await assert.rejects(fixture.createStore(source, { beforeCommit: async () => {
        replacement = await prepareConfiguredNativePublication({ ...input, indexDir: source.indexDir });
      } }), /replaced or changed/);
      await commitConfiguredNativePublication(replacement);
    } else await fixture.createStore(source, { registered: !['unregistered', 'readonly-unregistered'].includes(scenario) });
  }
  if (!['unregistered', 'readonly-unregistered', 'legacy', 'replaced-attempt', 'invalid-ready'].includes(scenario)) {
    const publication = await readNativePublicationRecord(target);
    assert.equal(publication.record.state, 'ready'); assert.equal(publication.record.qualified, true);
    assert.equal(sameIdentityPath(publication.record.sourceWitness.indexDir, source.indexDir), true);
  }
  if (scenario === 'source-retained') {
    const result = await cleanupConfiguredNativeArtifact(input);
    assert.equal(result.status, 'retained-protected'); assert.equal(result.reason, 'native-source-generation-retained');
    reader = fixture.openReader(); assert.equal(reader.read(), fixture.sentinel);
  } else {
    if (scenario === 'shared') {
      const other = await fixture.createSource(path.join(root, 'other-repo'));
      await fixture.createStore(other); await fixture.forgetSource(other);
    }
    if (scenario === 'source-history') {
      const next = await fixture.createSource();
      await fixture.createStore(next); await fixture.forgetSource(next);
      assert.equal((await readNativePublicationRecord(target)).record.sources.length, 2);
      assert.equal((await cleanupConfiguredNativeArtifact(input)).reason, 'native-source-generation-retained');
    }
    if (scenario === 'compaction') {
      assert.equal(backend, 'sqlite');
      const before = (await readNativePublicationRecord(target)).record;
      runNode(['tools/build/compact-sqlite-index.js', '--repo', repoRoot, '--mode', 'code', '--index-root', path.dirname(source.indexDir)],
        'registered native compaction', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe' });
      const after = (await readNativePublicationRecord(target)).record;
      assert.equal(after.state, 'ready'); assert.notEqual(after.publicationId, before.publicationId);
      assert.deepEqual(after.sources, before.sources);
    }
    if (scenario === 'zero-reuse') {
      assert.equal(backend, 'sqlite');
      const next = await fixture.createSource();
      await fs.writeFile(path.join(next.indexDir, 'chunk_meta.json'), '[]');
      await writeSqliteArtifactManifest(next.indexDir, [
        { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', count: 0 },
        { name: 'index_state', path: 'index_state.json', format: 'json' }],
      { buildId: path.basename(path.dirname(next.indexDir)) });
      runNode(['--input-type=module', '-e',
        "import {buildSqliteIndex} from './src/integrations/core/build-index/sqlite.js'; await buildSqliteIndex(process.argv[1],{mode:'code',emitOutput:false,indexRoot:process.argv[2]});",
        repoRoot, path.dirname(next.indexDir)], 'registered zero-state reuse', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe' });
      const after = (await readNativePublicationRecord(target)).record;
      assert.equal(after.state, 'ready'); assert.equal(after.sources.length, 2);
      assert.equal(sameIdentityPath(after.sourceWitness.indexDir, next.indexDir), true);
      assert.equal(JSON.parse(await fs.readFile(path.join(next.indexDir, 'index_state.json'), 'utf8')).sqlite.stats.skipped, true);
      await fixture.forgetSource(next);
    }
    if (scenario === 'incremental') {
      const next = await fixture.createSource(), chunks = incrementalFixture.buildChunks('src/file-0.js', 'v2');
      incrementalFixture.manifest.files['src/file-0.js'] = await publishSqliteBenchSource({ bundleDir: incrementalPaths.bundleDir,
        file: 'src/file-0.js', chunks, mtimeMs: 2000 });
      assert.equal(await writeIncrementalManifest(incrementalPaths.manifestPath, incrementalFixture.manifest), true);
      const expectedChunks = [chunks[0], ...Array.from({ length: 3 }, (_, index) =>
        incrementalFixture.buildChunks(`src/file-${index + 1}.js`, `v1-${index + 1}`)[0])];
      await populateSource(next, expectedChunks);
      runNode(['--input-type=module', '-e',
        "import {buildSqliteIndex} from './src/integrations/core/build-index/sqlite.js'; await buildSqliteIndex(process.argv[1],{mode:'code',emitOutput:false,indexRoot:process.argv[2],incremental:true});",
        repoRoot, path.dirname(next.indexDir)], 'registered actual incremental update', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe' });
      const state = JSON.parse(await fs.readFile(path.join(next.indexDir, 'index_state.json'), 'utf8'));
      assert.equal(state.sqlite.stats.incrementalUsed, true,
        'a full rebuild cannot qualify incremental publication: ' + JSON.stringify(state.sqlite));
      assert.equal(state.sqlite.note, 'incremental update');
      const publication = (await readNativePublicationRecord(target)).record;
      assert.equal(publication.state, 'ready'); assert.equal(publication.sources.length, 2);
      assert.equal(sameIdentityPath(publication.sourceWitness.indexDir, next.indexDir), true);
      reader = fixture.openReader(); assert.deepEqual(reader.readChunks().map(row => row.name).sort(), expectedChunks.map(row => row.name).sort());
      await reader.close(); reader = null;
      await fixture.forgetSource(next);
      await fs.rm(path.join(repoCacheRoot, 'builds', 'current.json'));
    }
    await fixture.forgetSource(source, { keepGenerationRoot: scenario === 'producer' });
    if (scenario === 'producer') {
      assert.equal((await cleanupConfiguredNativeArtifact(input)).reason, 'published-generation-retained');
      await fs.rm(path.join(repoCacheRoot, 'builds', 'current.json'), { force: true });
    }
    if (scenario === 'saved') {
      await fs.mkdir(path.join(repoCacheRoot, 'snapshots')); await fs.writeFile(path.join(repoCacheRoot, 'snapshots', 'saved.json'), '{"keep":true}');
    } else if (scenario === 'modified') {
      await fixture.createStore(await fixture.createSource(), { registered: false });
      await fs.appendFile(backend === 'sqlite' ? target : path.join(target, 'data.mdb'), '\nchanged-after-publication');
    } else if (scenario === 'replacement') {
      const file = backend === 'sqlite' ? target : path.join(target, 'data.mdb');
      await fs.copyFile(file, `${file}.replacement`); await fs.rename(`${file}.replacement`, file);
    } else if (scenario === 'reader' || scenario === 'foreign-home-reader') {
      reader = fixture.openReader({ launchHome: scenario === 'reader' ? home : path.join(root, 'foreign-home') });
      assert.equal(reader.read(), fixture.sentinel);
      assert.equal((await inspectStorageAccess(target, { coordinationRoot: nativePublicationRegistryPaths(target).access })).protected, true);
    } else if (scenario === 'readonly-unregistered' || scenario === 'registered-coordinator-required') {
      const sharedRoot = nativePublicationRegistryPaths(target).root;
      fsSync.mkdirSync = (directory, ...args) => {
        if (sameIdentityPath(directory, sharedRoot)) throw Object.assign(new Error('fixture store-local metadata is read-only'), { code: 'EACCES' });
        return originalMkdir(directory, ...args);
      };
      if (scenario === 'registered-coordinator-required') {
        assert.throws(() => fixture.openReader(), /fixture store-local metadata is read-only/);
        assert.ok(await fs.stat(target), 'failed required coordination cannot open or delete the registered store');
      } else {
        reader = fixture.openReader(); assert.equal(reader.read(), fixture.sentinel, 'an unregistered read-only store remains usable without granting cleanup authority');
      }
      fsSync.mkdirSync = originalMkdir;
    } else if (scenario === 'builder') {
      buildLock = await acquireIndexLock({ repoCacheRoot, requireSettlement: true }); assert.ok(buildLock);
    } else if (scenario === 'plan-race' || scenario === 'foreign-home-plan-race') {
      let admitted = false;
      fs.lstat = async (file, ...args) => {
        try { return await originalStat(file, ...args); }
        catch (error) {
          if (!admitted && path.resolve(file) === source.indexDir && error.code === 'ENOENT') {
            admitted = true; reader = fixture.openReader({ launchHome: scenario === 'plan-race' ? home : path.join(root, 'foreign-home') });
          }
          throw error;
        }
      };
    } else if (scenario === 'malformed' || scenario === 'duplicate') {
      const paths = nativePublicationRegistryPaths(target);
      const current = JSON.parse(await fs.readFile(paths.record, 'utf8'));
      await fs.writeFile(paths.record, scenario === 'malformed' ? JSON.stringify({ ...current, unknownAuthority: true })
        : '{"qualified":true,' + JSON.stringify(current).slice(1));
    } else if (scenario === 'foreign-member') {
      await fs.writeFile(backend === 'sqlite' ? `${target}-wal` : path.join(target, 'foreign.txt'), 'never remove unrelated bytes');
    }
    const protectedCase = ['saved', 'unregistered', 'readonly-unregistered', 'legacy', 'modified', 'replacement', 'reader', 'foreign-home-reader', 'plan-race', 'foreign-home-plan-race', 'malformed', 'duplicate', 'foreign-member', 'shared', 'replaced-attempt', 'builder', 'invalid-ready'].includes(scenario);
    if (scenario === 'dry-run') {
      const before = await snapshot(root);
      const preview = await cleanupConfiguredNativeArtifact({ ...input, dryRun: true });
      assert.equal(preview.status, 'planned', JSON.stringify(preview));
      assert.deepEqual(await snapshot(root), before, 'dry-run cannot create locks, rewrite receipts or open mutable native stores');
    } else if (scenario === 'interrupted') {
      let injected = false;
      if (backend === 'sqlite') fs.rename = async (from, to) => {
        if (path.resolve(to) === nativePublicationRegistryPaths(target).record && !fsSync.existsSync(target)) {
          injected = true; throw Object.assign(new Error('original fixture journal publication failure'), { code: 'EACCES' });
        }
        return originalRename(from, to);
      };
      else fsSync.unlinkSync = file => {
        if (!injected && path.resolve(file) === path.join(target, 'lock.mdb')) {
          injected = true; throw Object.assign(new Error('original fixture second-member failure'), { code: 'EACCES' });
        }
        return originalUnlink(file);
      };
      const interrupted = await cleanupConfiguredNativeArtifact(input);
      assert.ok(injected); assert.equal(interrupted.status, 'retained-protected');
      assert.equal((await readNativePublicationRecord(target)).record.state, 'deleting');
      fs.rename = originalRename; fsSync.unlinkSync = originalUnlink;
      const resumed = await cleanupConfiguredNativeArtifact(input);
      assert.equal(resumed.status, 'removed', JSON.stringify(resumed));
      if (backend === 'sqlite') assert.equal(resumed.logicalBytesRemoved, 0, 'previously missing bytes are not counted again');
    } else if (scenario === 'close-mutation') {
      const changeRetention = () => {
        const paths = nativePublicationRegistryPaths(target), record = JSON.parse(fsSync.readFileSync(paths.record, 'utf8'));
        fsSync.writeFileSync(paths.record, JSON.stringify({ ...record, qualified: false, state: 'unqualified', reason: 'independent-retention' }));
      };
      if (backend === 'sqlite') {
        const Database = require('better-sqlite3'), originalClose = Database.prototype.close;
        Database.prototype.close = function(...args) { const value = originalClose.apply(this, args); changeRetention(); return value; };
        restoreNative = () => { Database.prototype.close = originalClose; };
      } else {
        const lmdb = require('lmdb'), originalOpen = lmdb.open;
        lmdb.open = (...args) => {
          const db = originalOpen(...args), originalClose = db.close;
          db.close = function(callback) { return originalClose.call(this, () => { changeRetention(); callback(); }); };
          return db;
        };
        restoreNative = () => { lmdb.open = originalOpen; };
      }
      const result = await cleanupConfiguredNativeArtifact(input);
      assert.equal(result.status, 'retained-protected', JSON.stringify(result));
      assert.ok(await fs.stat(target), 'original native close cannot revoke independent retention');
      assert.equal((await readNativePublicationRecord(target)).record.reason, 'independent-retention');
    } else if (scenario === 'late-close' && backend === 'lmdb') {
      const lmdb = require('lmdb'), originalOpen = lmdb.open;
      const entered = Promise.withResolvers(), gate = Promise.withResolvers(); releaseClose = gate.resolve;
      lmdb.open = (...args) => {
        const db = originalOpen(...args), originalClose = db.close;
        db.close = function(callback) {
          assert.equal(typeof callback, 'function', 'LMDB inspection requires its real physical-close callback');
          return originalClose.call(this, () => { entered.resolve(); void gate.promise.then(callback); });
        };
        return db;
      };
      restoreNative = () => { lmdb.open = originalOpen; };
      closing = cleanupConfiguredNativeArtifact(input);
      await runWithTimeout(() => entered.promise, { timeoutMs: 3000, label: 'original LMDB physical close' });
      assert.ok(await fs.stat(target));
      assert.equal((await inspectStorageAccess(target, { coordinationRoot: path.join(home, 'state', 'storage-access') })).protected, true);
      gate.resolve();
      assert.equal((await closing).status, 'removed');
    } else if (scenario === 'late-close') {
      const Database = require('better-sqlite3'), originalClose = Database.prototype.close;
      let closes = 0;
      Database.prototype.close = function(...args) { closes++; return originalClose.apply(this, args); };
      restoreNative = () => { Database.prototype.close = originalClose; };
      assert.equal((await cleanupConfiguredNativeArtifact(input)).status, 'removed');
      assert.equal(closes, 1, 'the actual SQLite inspection is closed exactly once before unlink');
    } else if (scenario === 'producer') {
      const result = runNode(['tools/index/clean-artifacts.js', '--repo', repoRoot],
        'actual CLI eligible native category cleanup', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
      assert.ok(result.stderr.split(/\r?\n/).some(line => line.startsWith('removed: ')
        && sameIdentityPath(line.slice('removed: '.length), target)), result.stderr);
      assert.equal(result.status, result.stderr.includes('Cleanup partial') ? 1 : 0, result.stderr);
    } else if (scenario === 'mcp') {
      assert.equal(sameIdentityPath(resolveRepoPath(repoRoot), repoRoot), true, 'MCP must select only the disposable fixture repository');
      // The canonical cache may retain independent unknown fixture directories;
      // MCP must report that partial result while deleting the eligible native
      // category, and must continue rejecting all-repository delegation.
      try { await cleanArtifacts({ repoPath: repoRoot }); }
      catch (error) { assert.match(error.message, /Cleanup partial/); }
      await assert.rejects(cleanArtifacts({ repoPath: repoRoot, all: true }), /all|allowed|support/i);
    } else {
      const result = await cleanupConfiguredNativeArtifact(input);
      assert.equal(result.status, protectedCase ? 'retained-protected' : 'removed', JSON.stringify(result));
      if (protectedCase) assert.ok(await fs.stat(target), 'protected native bytes remain present');
      if (reader) assert.equal(reader.read(), fixture.sentinel, 'admitted original reader remains usable after attempted cleanup');
    }
    fs.lstat = originalStat;
    if (reader) { await reader.close(); reader = null; }
    if (scenario.startsWith('foreign-home-')) {
      const idle = await cleanupConfiguredNativeArtifact(input);
      assert.equal(idle.status, 'retained-protected', JSON.stringify(idle));
      assert.equal(idle.reason, 'shared-or-unknown-native-home-history', 'foreign-home evidence remains protected after native closure');
      assert.ok(await fs.stat(target));
    }
    if (buildLock) { await buildLock.release(); buildLock = null; }
    if (['reader', 'plan-race', 'builder'].includes(scenario)) {
      const idle = await cleanupConfiguredNativeArtifact(input); assert.equal(idle.status, 'removed', JSON.stringify(idle));
    }
    if (['owned', 'source-history', 'producer', 'interrupted', 'late-close', 'reader', 'plan-race', 'builder', 'mcp', 'compaction', 'zero-reuse', 'incremental', 'registered-coordinator-required'].includes(scenario)) {
      await assert.rejects(fs.stat(target), { code: 'ENOENT' });
      assert.equal((await readNativePublicationRecord(target)).record.state, 'removed');
      assert.equal((await cleanupConfiguredNativeArtifact(input)).status, 'missing');
    }
  }
} finally {
  fs.lstat = originalStat; fs.rename = originalRename; fsSync.unlinkSync = originalUnlink; fsSync.mkdirSync = originalMkdir; restoreNative();
  releaseClose?.(); if (closing) await closing;
  if (reader) await reader.close(); if (buildLock) await buildLock.release();
  const relative = path.relative(process.cwd(), root);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.includes(`..${path.sep}`));
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Native publication ${selected}: original producer, native lifetime and exact orphan-family authority.`);
