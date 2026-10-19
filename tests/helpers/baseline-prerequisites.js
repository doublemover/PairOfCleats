import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { CREATE_TABLES_SQL } from '../../src/storage/sqlite/schema.js';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';
import { runNode } from './run-node.js';

// This fixture checks prerequisite presence and schema inspection. Actual index
// construction/query coverage belongs to smoke/e2e, smoke/retrieval and smoke/sqlite.
export const createBaselinePrerequisites = async (checkout, script, indexFiles) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-baseline-prerequisites-')));
  const dictionary = path.join(root, 'dictionary');
  const config = { dictionary: { dir: dictionary, languages: [], files: [], includeSlang: false },
    sqlite: { vectorExtension: { enabled: false } } };
  const env = applyTestEnv({ cacheRoot: path.join(root, 'cache'), testConfig: config,
    extraEnv: { PAIROFCLEATS_DICT_DIR: dictionary } });
  const inside = filename => {
    const relative = path.relative(root, path.resolve(filename));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'fixture mutation stays in its owned root');
    return filename;
  };
  const cleanup = () => fs.rm(root, { recursive: true, force: true });
  try {
    for (const file of ['package.json', 'build_index.js', 'search.js']) {
      await fs.copyFile(path.join(checkout, file), path.join(root, file));
    }
    await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify(config));
    const userConfig = loadUserConfig(root);
    const dirs = ['code', 'prose'].map(mode => inside(getIndexDir(root, mode, userConfig)));
    const sqlite = resolveSqlitePaths(root, userConfig);
    const databases = [sqlite.codePath, sqlite.prosePath].map(inside);
    const restore = async () => {
      await fs.mkdir(dictionary, { recursive: true });
      await fs.writeFile(path.join(dictionary, 'combined.txt'), 'fixture\n');
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
        for (const file of indexFiles) await fs.writeFile(path.join(dir, file), '{}\n');
      }
      for (const file of databases) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.rm(file, { force: true });
        const db = new Database(file);
        try { db.exec(CREATE_TABLES_SQL); }
        finally { db.close(); }
      }
    };
    await restore();
    const required = ['--require-index', '--require-sqlite', '--require-dicts'];
    const optional = ['--require-index=false'];
    const deadlineAt = performance.now() + 20000;
    const warningLines = output => output.split(/\r?\n/).filter(line => line.startsWith('[warn]'));
    const execute = (args, expectedStatus) => {
      const remaining = Math.floor(deadlineAt - performance.now());
      assert.ok(remaining > 0, 'the aggregate diagnostic cases stay inside their 20-second budget');
      const result = runNode([script, ...args], 'Baseline prerequisite diagnostic', root, env,
        { stdio: 'pipe', allowFailure: true, timeoutMs: Math.min(5000, remaining) });
      assert.equal(result.error, undefined, 'the actual diagnostic finishes and reaps its child');
      assert.equal(result.signal, null);
      assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
      if (expectedStatus === 0) {
        assert.match(result.stdout, /All required checks passed/);
        assert.equal(result.stderr.trim(), '', 'healthy/optional diagnostics must not hide stderr warnings or errors');
      } else {
        assert.doesNotMatch(result.stdout, /All required checks passed/);
        assert.match(result.stderr.trim(), /^\d+ checks failed$/, 'required negatives emit only their asserted failure summary');
      }
      return result;
    };
    const verifyNegatives = async () => {
      // Fresh missing prerequisites and a subsequent healthy cache must produce
      // their own results, irrespective of any author-workspace cache contents.
      for (const dir of [...dirs, dictionary]) await fs.rm(inside(dir), { recursive: true, force: true });
      for (const file of databases) await fs.rm(inside(file), { force: true });
      const absent = execute(optional, 0);
      assert.deepEqual(warningLines(absent.stdout), [
        '[warn] dictionary files not found (run node tools/download/dicts.js --lang en)',
        ...dirs.map(dir => `[warn] ${path.relative(root, dir)} missing (build index to generate)`),
        ...databases.map((file, index) => `[warn] sqlite index missing (${index ? 'prose' : 'code'}: ${file})`)
      ]);
      const missingRequired = execute(required, 1);
      assert.deepEqual(warningLines(missingRequired.stdout), []);
      assert.match(missingRequired.stderr, /5 checks failed/);
      await restore();
      assert.deepEqual(warningLines(execute(required, 0).stdout), []);

      for (const file of databases) await fs.writeFile(inside(file), 'not a sqlite database\n');
      const corrupt = execute(required, 1);
      assert.match(corrupt.stdout, /\[fail\] sqlite table check failed \(file is not a database\)/);
      assert.deepEqual(warningLines(corrupt.stdout), []);
      assert.match(corrupt.stderr, /1 checks failed/);
      const optionalCorrupt = execute(optional, 0);
      assert.deepEqual(warningLines(optionalCorrupt.stdout), ['[warn] sqlite table check skipped (file is not a database)']);
      await restore();

      const db = new Database(sqlite.codePath);
      try { db.exec('DROP TABLE token_stats'); }
      finally { db.close(); }
      const incomplete = execute(required, 1);
      assert.match(incomplete.stdout, /\[fail\] sqlite code index missing tables \(token_stats\)/);
      assert.deepEqual(warningLines(incomplete.stdout), []);
      assert.deepEqual(warningLines(execute(optional, 0).stdout), ['[warn] sqlite code index missing tables (token_stats)']);
      await restore();

      await fs.writeFile(inside(sqlite.legacyPath), 'legacy fixture\n');
      const legacy = execute(required, 1);
      assert.ok(legacy.stdout.includes(`[fail] legacy sqlite index detected (${sqlite.legacyPath})`));
      assert.deepEqual(warningLines(legacy.stdout), []);
      await fs.rm(inside(sqlite.legacyPath));
      assert.deepEqual(warningLines(execute(required, 0).stdout), []);
    };
    return { root, cleanup, verifyNegatives };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
