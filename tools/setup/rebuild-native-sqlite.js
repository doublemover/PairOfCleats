import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { observeStorageResource, describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const require = createRequire(import.meta.url);

export { probeSqliteNative } from '../../src/shared/native-package-probe.js';
import { probeSqliteNative } from '../../src/shared/native-package-probe.js';

/**
 * v13 uses force_build (via build-release), not npm_config_build_from_source.
 * Its default loader prefers a bundled prebuild even after a source build, so
 * replace a failed host prebuild only after the new binding passes a real query.
 */
export const rebuildSqliteNativeFromSource = async (root, runNpmCommand, probeOptions = {}) => {
  probeOptions = { signal: probeOptions.signal || null, run: probeOptions.run || null };
  probeOptions.signal?.throwIfAborted();
  const build = await runNpmCommand(['run', 'build-release'], {
    cwd: path.join(root, 'node_modules', 'better-sqlite3'), buildFromSource: false
  });
  probeOptions.signal?.throwIfAborted();
  return build.ok ? promoteSqliteBuild(root, probeOptions) : build;
};

const promoteSqliteBuild = async (root, probeOptions) => {
  const packageRoot = path.join(root, 'node_modules', 'better-sqlite3');

  const compiledPath = path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');
  const compiledProbe = await probeSqliteNative(root, compiledPath, probeOptions);
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
  const restoreFailure = result => {
    if (original && promoted) {
      try {
        replacePrebuild(original);
      } catch (cleanup) {
        const original = Object.hasOwn(result, 'error') ? result.error : new Error(result.message);
        const error = addStorageFailureContext(original, { sqlitePromotionResult: result }, cleanup, { secondaryPresent: true });
        observeStorageResource(error, { phase: 'sqlite-promotion-rollback' }).requireSettled();
        return { ...result, error, message: `${result.message}; could not restore prebuild: ${describeStorageFailure(cleanup,
          { phase: 'sqlite-promotion-rollback' }).message}` };
      }
    }
    return result;
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
  } catch (error) {
    observeStorageResource(error, { phase: 'sqlite-promotion-before-rollback' }).requireSettled();
    return restoreFailure({ ok: false, error, message: describeStorageFailure(error, { phase: 'sqlite-binding-promotion' }).message });
  }
  let defaultProbe;
  try { defaultProbe = await probeSqliteNative(root, null, probeOptions); }
  catch (error) {
    // An actual child/diagnostic callback rejection is terminal. Roll back only
    // after its original work retires, then preserve that exact rejection.
    observeStorageResource(error, { phase: 'sqlite-default-probe-before-rollback' }).requireSettled();
    const restored = restoreFailure({ ok: false, error, message: describeStorageFailure(error, { phase: 'sqlite-default-probe' }).message });
    throw restored.error;
  }
  return defaultProbe.ok ? defaultProbe : restoreFailure(defaultProbe);
};
