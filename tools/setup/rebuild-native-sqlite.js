import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);

export { probeSqliteNative } from '../../src/shared/native-package-probe.js';
import { probeSqliteNative } from '../../src/shared/native-package-probe.js';

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
