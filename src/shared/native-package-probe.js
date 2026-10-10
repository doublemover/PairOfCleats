import { spawnSync } from 'node:child_process';
import { formatSpawnFailureReason } from '../../tools/setup/rebuild-native-exit.js';

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
    timeout: 10000, maxBuffer: 65536
  });
  return {
    ok: result.status === 0,
    message: result.status === 0
      ? null
      : (result.stderr || result.stdout || '').trim() || formatSpawnFailureReason(result)
  };
};

export const probeNativePackage = async (root, pkgName) => {
  if (pkgName === 'better-sqlite3') return probeSqliteNative(root);
  /**
   * `npm ci --ignore-scripts` can leave tree-sitter core loadable but not
   * actually usable with rebuilt grammars. Probe parser activation explicitly
   * so `verify:native` / `repair:native` detect this CI-only failure mode.
   */
  if (pkgName === 'tree-sitter') {
    const parserProbeScript = `
      try {
        const Parser = require('tree-sitter');
        const js = require('tree-sitter-javascript');
        const parser = new Parser();
        const candidates = [js, js.javascript, js.language, js.default].filter(Boolean);
        let activated = false;
        let lastError = null;
        for (const language of candidates) {
          try {
            parser.setLanguage(language);
            const tree = parser.parse('function ok() { return 1; }');
            if (!tree || !tree.rootNode) {
              throw new Error('tree-sitter parser activation produced no tree');
            }
            activated = true;
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!activated) {
          throw lastError || new Error('tree-sitter parser activation failed');
        }
        process.exit(0);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    `.trim();

    const parserProbeResult = spawnSync(process.execPath, ['-e', parserProbeScript], {
      cwd: root,
      encoding: 'utf8', timeout: 10000, maxBuffer: 65536
    });

    if (parserProbeResult.status === 0) {
      return { ok: true, message: null };
    }

    const message = (parserProbeResult.stderr || parserProbeResult.stdout || '').trim();
    return {
      ok: false,
      message: message || 'failed to activate tree-sitter parser'
    };
  }

  const probeScript = `
    const pkg = process.argv[1];
    (async () => {
      try {
        await import(pkg);
        process.exit(0);
      } catch (importErr) {
        try {
          require(pkg);
          process.exit(0);
        } catch (requireErr) {
          const message = (requireErr && requireErr.message)
            || (importErr && importErr.message)
            || 'failed to load package';
          console.error(message);
          process.exit(1);
        }
      }
    })();
  `.trim();

  const result = spawnSync(process.execPath, ['-e', probeScript, pkgName], {
    cwd: root,
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });

  if (result.status === 0) {
    return { ok: true, message: null };
  }

  const message = (result.stderr || result.stdout || '').trim();
  return {
    ok: false,
    message: message || `failed to load ${pkgName}`
  };
};
