import { spawnSync } from 'node:child_process';
import { formatSpawnFailureReason } from '../../tools/setup/rebuild-native-exit.js';

const PERL_LIFECYCLE_SOURCE = "my $x = <<'END';\n$END\n\\END\nEND trailing\nsub fake { die 'literal'; }\nEND\nsub actual { return $x; }\n";

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

/** Bounded Node VM wrapper lifecycle; activation of native packages is separate. */
export const probeNodeRealmLifecycle = (root) => {
  const script = `
    const { Worker } = require('node:worker_threads');
    const source = \`
      const { parentPort, workerData } = require('node:worker_threads');
      const { Script } = require('node:vm');
      for (let i = 0; i < 128; i++) new Script('1 + 1');
      for (let i = 0; i < 16; i++) Buffer.allocUnsafe(1024 * 1024);
      parentPort.postMessage('ready');
      if (workerData.keepAlive) setInterval(() => {}, 1000);
    \`;
    (async () => {
      for (const mode of ['natural', 'terminate']) {
        const worker = new Worker(source, { eval: true,
          workerData: { keepAlive: mode === 'terminate' } });
        const exited = new Promise((resolve, reject) => {
          worker.once('exit', resolve);
          worker.once('error', reject);
        });
        const ready = new Promise((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', code => reject(Error('worker exited before ready: ' + code)));
        });
        if (await ready !== 'ready') throw Error('VM worker did not initialize');
        if (mode === 'terminate') {
          const code = await worker.terminate();
          if (code !== 1) throw Error('terminated worker returned ' + code);
        } else {
          const code = await exited;
          if (code !== 0) throw Error('VM worker returned ' + code);
        }
      }
      process.stdout.write('VM_REALM_LIFECYCLE_OK');
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  return { ok: result.status === 0 && result.stdout === 'VM_REALM_LIFECYCLE_OK',
    message: result.status === 0 && result.stdout === 'VM_REALM_LIFECYCLE_OK' ? null
      : (result.stderr || result.stdout || '').trim() || formatSpawnFailureReason(result) };
};

/** A real binding callback interrupted by owned worker shutdown, with natural
 * worker exit as the disposal boundary for the GC-owned Node parser binding. */
export const probeNativeParserWorkerLifecycle = (root) => {
  const script = `
    const { Worker } = require('node:worker_threads');
    const source = ${JSON.stringify(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Parser = require('tree-sitter');
      const language = require('tree-sitter-javascript');
      const parser = new Parser(); parser.setLanguage(language);
      function parse() { parser.reset(); parser.parse('function value(){ return 1; }'); }
      for (let i=0; i<16; i++) parse();
      parentPort.postMessage('ready');
      if (workerData.cancel) while (true) parse();
    `)};
    (async () => {
      for (const cancel of [false, true]) {
        const worker = new Worker(source, { eval: true, workerData: { cancel } });
        const exited = new Promise((resolve, reject) => {
          worker.once('exit', resolve); worker.once('error', reject);
        });
        const ready = await new Promise((resolve, reject) => {
          worker.once('message', resolve); worker.once('error', reject);
          worker.once('exit', code => reject(Error('parser worker exited before ready: ' + code)));
        });
        if (ready !== 'ready') throw Error('parser worker did not initialize');
        if (cancel) {
          if (await worker.terminate() !== 1) throw Error('parser cancellation status');
        } else if (await exited !== 0) throw Error('parser disposal status');
      }
      process.stdout.write('PARSER_WORKER_LIFECYCLE_OK');
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  const ok = result.status === 0 && result.stdout === 'PARSER_WORKER_LIFECYCLE_OK';
  return { ok, message: ok ? null : (result.stderr || result.stdout || '').trim() || formatSpawnFailureReason(result) };
};

/** Isolated parser activation using the same binding owner as production. */
export const probeNativeGrammarRoutes = (root, routes) => {
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    (async () => {
      const root = process.cwd(), routes = JSON.parse(process.argv[1]);
      const requireFromRoot = createRequire(path.join(root, 'package.json'));
      const { loadGrammarModule, resolveGrammarLanguageExport, normalizeLanguageBinding } =
        await import(pathToFileURL(path.join(root, 'src/lang/tree-sitter/native-grammar-binding.js')));
      const Parser = requireFromRoot('tree-sitter');
      const capabilities = [];
      for (const { languageId, source, ...spec } of routes) {
        const module = loadGrammarModule(spec, requireFromRoot);
        const language = normalizeLanguageBinding(resolveGrammarLanguageExport(module, spec).language, module);
        if (!language) throw Error(languageId + ': missing native grammar binding');
        const parser = new Parser();
        parser.setLanguage(language);
        const tree = parser.parse(source);
        if (!tree?.rootNode || tree.rootNode.hasError) throw Error(languageId + ': parser activation failed');
        if (languageId === 'perl') {
          const literal = ${JSON.stringify(PERL_LIFECYCLE_SOURCE)};
          for (let i = 0; i < 2; i++) {
            parser.reset();
            const checked = parser.parse(literal);
            try {
              const ends = checked.rootNode.descendantsOfType('heredoc_end_identifier');
              const functions = checked.rootNode.descendantsOfType('function_definition');
              if (checked.rootNode.hasError || ends.length !== 1
                || ends[0].startIndex !== literal.lastIndexOf('\\nEND\\n') + 1
                || functions.length !== 1 || !functions[0].text.startsWith('sub actual')) {
                throw Error('perl: literal heredoc lifecycle failed');
              }
            } finally { checked.delete?.(); }
          }
        }
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', spec.moduleName, 'package.json')));
        capabilities.push({ languageId, moduleName: spec.moduleName, packageVersion: pkg.version,
          nodeVersion: process.version, abi: process.versions.modules, state: 'parser-activated' });
        tree.delete?.(); parser.delete?.();
      }
      process.stdout.write(JSON.stringify(capabilities));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script, JSON.stringify(routes)], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  if (result.status !== 0) return { ok: false, capabilities: [],
    message: (result.stderr || '').trim() || formatSpawnFailureReason(result) };
  try { return { ok: true, message: null, capabilities: JSON.parse(result.stdout) }; }
  catch { return { ok: false, capabilities: [], message: 'Invalid parser activation evidence.' }; }
};

export const probeNativePackage = async (root, pkgName, { grammarRoutes = [] } = {}) => {
  if (grammarRoutes.length) return probeNativeGrammarRoutes(root, grammarRoutes);
  if (pkgName === 'better-sqlite3') return probeSqliteNative(root);
  if (pkgName === 'node-pty') {
    // Natural probe exit proves that ConPTY closes its connection worker too.
    // An unconditional process.exit would hide a leaked native/session owner.
    const script = `
      const pty = require('node-pty');
      const run = (marker) => new Promise((resolve, reject) => {
      const terminal = pty.spawn(process.execPath, ['-e', 'process.stdout.write(' + JSON.stringify(marker) + ')'], {
        cols: 80, rows: 24, cwd: process.cwd(), env: process.env, useConpty: true
      });
      let output = '';
      const timeout = setTimeout(() => { console.error('PTY child exceeded deadline'); process.exitCode = 1; terminal.kill(); }, 6000);
      terminal.onData(data => { output += data; });
      terminal.onExit(event => {
        clearTimeout(timeout);
        if (event.exitCode !== 0 || !output.includes(marker)) reject(Error('PTY operation returned an unexpected status or output'));
        else resolve();
      });
      });
      (async () => { for (const marker of ['PTY_PROBE_FIRST', 'PTY_PROBE_SECOND']) await run(marker); })()
        .catch(error => { console.error(error.message); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
    });
    return { ok: result.status === 0, message: result.status === 0 ? null
      : (result.stderr || result.stdout || '').trim() || formatSpawnFailureReason(result) };
  }
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
      return probeNativeParserWorkerLifecycle(root);
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
