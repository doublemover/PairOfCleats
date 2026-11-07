import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Packr, Unpackr } from 'msgpackr';
import { prepareIsolatedTestCacheDir } from './test-cache.js';
import { applyTestEnv } from './test-env.js';
import { resolveRepoCacheRootPath } from '../../src/shared/repo-paths.js';
import { CACHE_OWNER_FILE } from '../../src/shared/cache-deletion.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { withGeneratedArtifactMetadata } from '../../src/shared/generated-artifact-core.js';
import { prepareConfiguredNativePublication, commitConfiguredNativePublication } from '../../src/shared/storage/native-publication-producer.js';
import { updateSqliteState } from '../../src/storage/sqlite/build/index-state.js';
import { updateLmdbState } from '../../src/storage/lmdb/index-state.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../src/storage/sqlite/index-format.js';
import { LMDB_SCHEMA_VERSION, LMDB_META_KEYS, LMDB_ARTIFACT_KEYS } from '../../src/storage/lmdb/schema.js';
import { runNativeDatabaseCommand } from '../../tools/shared/native-database-lifetime.js';
import { acquireNativeReaderStorage } from '../../src/shared/storage/native-reader.js';
import { createLmdbCloseOwner } from '../../src/storage/lmdb/close.js';

const require = createRequire(import.meta.url);
const sentinel = '2026-11-05T00:00:00.000Z';
export const createNativePublicationFixture = async (backend, label) => {
  const { dir: root } = await prepareIsolatedTestCacheDir(`native-publication-${label}`);
  const repoRoot = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache'), home = path.join(root, 'home');
  const target = path.join(root, 'external', backend === 'sqlite' ? 'index-code.db' : 'index-code');
  const userConfig = { cache: { root: cacheRoot }, [backend]: { codeDbPath: target } };
  if (backend === 'sqlite') userConfig.sqlite.vectorExtension = { enabled: false };
  const env = applyTestEnv({ cacheRoot, testConfig: { [backend]: userConfig[backend],
    indexing: { typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false,
      riskAnalysisCrossFile: false, scm: { provider: 'none' } },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } },
  extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_BUNDLE_THREADS: '1' } });
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  await fs.mkdir(repoRoot, { recursive: true });
  const git = require('node:child_process').spawnSync('git', ['-c', 'init.defaultBranch=fixture', 'init', '--quiet', repoRoot],
    { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  assert.equal(git.status, 0, git.stderr);
  await fs.mkdir(repoCacheRoot, { recursive: true });
  await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({ cache: { root: cacheRoot } }));
  let sequence = 0;
  const createSource = async (sourceRepoRoot = repoRoot) => {
    await fs.mkdir(sourceRepoRoot, { recursive: true });
    const sourceCache = resolveRepoCacheRootPath(sourceRepoRoot, userConfig);
    const indexDir = path.join(sourceCache, 'builds', `fixture-${++sequence}`, 'index-code');
    await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
    const state = JSON.stringify(withGeneratedArtifactMetadata({ mode: 'code', generatedAt: sentinel }, 'index-state'));
    await fs.writeFile(path.join(indexDir, 'index_state.json'), state);
    await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ version: 1,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [{ name: 'index_state', path: 'index_state.json',
        bytes: Buffer.byteLength(state), checksum: createHash('sha256').update(state).digest('hex') }] }));
    return { repoRoot: sourceRepoRoot, repoCacheRoot: sourceCache, indexDir };
  };
  const createStore = async (source, { registered = true, beforeCommit = null } = {}) => {
    let publication = null;
    await runNativeDatabaseCommand({ commandIdentity: backend === 'sqlite' ? 'sqlite.compact' : 'lmdb.build' }, async resources => {
      resources.admitScope({ repoRoot: source.repoRoot, repoCacheRoot: source.repoCacheRoot,
        indexRoot: path.dirname(source.indexDir), userConfig, targets: [target] });
      if (registered) publication = await prepareConfiguredNativePublication({ backend, mode: 'code', target,
        indexDir: source.indexDir, repoRoot: source.repoRoot, userConfig });
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (backend === 'sqlite') {
        const db = resources.open(() => new (require('better-sqlite3'))(target));
        await resources.use(db, () => {
          db.exec(CREATE_TABLES_SQL); db.pragma(`user_version = ${SCHEMA_VERSION}`); writeSqliteIndexFormat(db);
          db.prepare('INSERT OR REPLACE INTO index_format_meta(key,value) VALUES (?,?)').run('fixtureProof', sentinel);
        });
        await updateSqliteState(source.indexDir, { path: target, schemaVersion: SCHEMA_VERSION, status: 'ready' });
      } else {
        const db = resources.open(() => require('lmdb').open({ path: target })), packr = new Packr();
        await resources.use(db, () => {
          for (const [key, value] of [[LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION], [LMDB_META_KEYS.mode, 'code'],
            [LMDB_META_KEYS.sourceIndex, source.indexDir], [LMDB_META_KEYS.createdAt, sentinel]]) db.putSync(key, packr.pack(value));
        });
        await updateLmdbState(source.indexDir, { enabled: true, ready: true, pending: false,
          schemaVersion: LMDB_SCHEMA_VERSION, path: target });
      }
      if (beforeCommit) await beforeCommit(publication);
      if (registered) await commitConfiguredNativePublication(publication);
    });
    return publication;
  };
  const openReader = ({ launchHome = home } = {}) => {
    let closed = false;
    const owner = acquireNativeReaderStorage(target, { repoRoot, userConfig, env: { ...env, PAIROFCLEATS_HOME: launchHome }, nativeBackend: backend, nativeMode: 'code' }, () => closed);
    owner.start();
    const db = backend === 'sqlite' ? new (require('better-sqlite3'))(target, { readonly: true })
      : require('lmdb').open({ path: target, readOnly: true });
    const originalClose = db.close;
    const nativeClose = backend === 'lmdb' ? createLmdbCloseOwner(db, originalClose) : null;
    return { readChunks: () => backend === 'sqlite' ? db.prepare('SELECT name FROM chunks ORDER BY id').all()
      : new Unpackr().unpack(db.get(LMDB_ARTIFACT_KEYS.chunkMeta)).map(row => ({ name: row.name })),
    read: () => backend === 'sqlite' ? db.prepare("SELECT value FROM index_format_meta WHERE key='fixtureProof'").get().value
      : new Unpackr().unpack(db.get(LMDB_META_KEYS.createdAt)), close: async () => {
      if (!closed) { if (nativeClose) await nativeClose.close(); else originalClose.call(db); closed = true; }
      owner.releaseAfterClosure();
    } };
  };
  const forgetSource = async (source, { keepGenerationRoot = false } = {}) => {
    const generation = keepGenerationRoot ? source.indexDir : path.dirname(source.indexDir);
    const relative = path.relative(root, generation);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'only a disposable fixture generation can be removed');
    await fs.rm(generation, { recursive: true, force: false });
  };
  return { root, repoRoot, repoCacheRoot, cacheRoot, home, target, userConfig, env, sentinel,
    createSource, createStore, openReader, forgetSource };
};
