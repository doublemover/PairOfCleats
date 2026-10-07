import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { formatSpawnFailureReason } from './rebuild-native-exit.js';

const require = createRequire(import.meta.url);

/** Probe the binding, which better-sqlite3 loads only when a database opens. */
export const probeSqliteNative = (root, nativeBinding = null) => {
  const script = `
    try {
      const Database = require('better-sqlite3');
      const options = process.argv[1] ? { nativeBinding: process.argv[1] } : {};
      const db = new Database(':memory:', options);
      try {
        if (db.prepare('SELECT 1 AS ok').get()?.ok !== 1) {
          throw new Error('SQLite runtime probe returned an unexpected result');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      console.error(error?.message || String(error));
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script, nativeBinding || ''], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  });
  return {
    ok: result.status === 0,
    message: result.status === 0
      ? null
      : (result.stderr || result.stdout || '').trim() || formatSpawnFailureReason(result)
  };
};

/**
 * v13 uses force_build (via build-release), not npm_config_build_from_source.
 * Its default loader prefers a bundled prebuild even after a source build, so
 * replace a failed host prebuild only after the new binding passes a real query.
 */
export const rebuildSqliteNativeFromSource = (root, runNpmCommand) => {
  const packageRoot = path.join(root, 'node_modules', 'better-sqlite3');
  const build = runNpmCommand(['run', 'build-release'], {
    cwd: packageRoot,
    buildFromSource: true
  });
  if (!build.ok) return build;

  const compiledPath = path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');
  const compiledProbe = probeSqliteNative(root, compiledPath);
  if (!compiledProbe.ok) return compiledProbe;

  let prebuildPath = null;
  let original = null;
  let originalMode;
  let promoted = false;
  const replacePrebuild = (bytes) => {
    const temporaryPath = `${prebuildPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: originalMode });
      fs.chmodSync(temporaryPath, originalMode & 0o777);
      fs.renameSync(temporaryPath, prebuildPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  };
  const restoreFailure = (message) => {
    if (original && promoted) {
      try {
        replacePrebuild(original);
      } catch (error) {
        return { ok: false, message: `${message}; could not restore prebuild: ${error?.message || error}` };
      }
    }
    return { ok: false, message };
  };
  try {
    const binding = require(path.join(packageRoot, 'lib', 'binding.js'));
    prebuildPath = binding.getPrebuildPath();
    if (prebuildPath) {
      original = fs.readFileSync(prebuildPath);
      originalMode = fs.statSync(prebuildPath).mode;
      replacePrebuild(fs.readFileSync(compiledPath));
      promoted = true;
    }
    const defaultProbe = probeSqliteNative(root);
    if (defaultProbe.ok) return defaultProbe;
    return restoreFailure(defaultProbe.message);
  } catch (error) {
    return restoreFailure(error?.message || String(error));
  }
};
