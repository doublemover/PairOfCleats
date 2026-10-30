import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/no-fallback-scope-consumer/')[1];
assert.ok(['canonical-preview', 'direct-preview', 'canonical-execution', 'direct-execution'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('install-no-fallback-' + selected);
const direct = selected.startsWith('direct'), preview = selected.endsWith('preview');
try {
  for (const [name, flags, configured, allowed] of [
    ['bare', ['--no-fallback'], true, false], ['equals-true', ['--no-fallback=true'], true, false],
    ['equals-false', ['--no-fallback=false'], true, true], ['omitted', [], true, true],
    ['config-false', [], false, false], ['config-false-explicit-false', ['--no-fallback=false'], false, false]
  ]) {
    const root = path.join(dir, name), repo = path.join(root, 'repo'), bin = path.join(root, 'bin');
    await fs.mkdir(repo, { recursive: true }); await fs.mkdir(bin);
    const marker = path.join(root, 'calls.jsonl'), script = path.join(bin, 'fake-tool.cjs');
    const analyzer = path.join(bin, process.platform === 'win32' ? 'rust-analyzer.cmd' : 'rust-analyzer');
    const wrapper = role => process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${script}" ${role} %*\r\n`
      : `#!${process.execPath}\nprocess.argv.splice(2,0,${JSON.stringify(role)});require(${JSON.stringify(script)});\n`;
    const analyzerWrapper = wrapper('rust-analyzer');
    await fs.writeFile(script, `const fs=require('node:fs');const role=process.argv[2],args=process.argv.slice(3);
      fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({role,args})+'\\n');
      if(role==='rust-analyzer'){console.log('rust-analyzer 1.85.0');}
      else if(args[0]==='component'&&args[1]==='add')fs.writeFileSync(${JSON.stringify(analyzer)},${JSON.stringify(analyzerWrapper)},{mode:0o755});
      else if(args[0]==='show')console.log('stable-x86_64-pc-windows-msvc (default)');
      else console.log('rustup 1.28.2');`);
    await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'rustup.cmd' : 'rustup'), wrapper('rustup'), { mode: 0o755 });
    const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(root, 'cache'),
      testConfig: { tooling: { allowGlobalFallback: configured } }, extraEnv: {
        PATH: bin, Path: bin, PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TOOLING_DIR: path.join(root, 'tools'),
        PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: null } });
    const args = direct ? ['tools/tooling/install.js'] : ['bin/pairofcleats.js', 'tooling', 'install'];
    const result = runNode([...args, '--repo', repo, '--tools', 'rust-analyzer', '--scope', 'cache', ...flags,
      ...(preview ? ['--dry-run'] : []), '--json'], `${selected}/${name}`, process.cwd(), env,
    { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    const payload = JSON.parse(result.stdout); assert.equal(payload.allowFallback, allowed);
    let calls = []; try { calls = (await fs.readFile(marker, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const installers = calls.filter(row => row.role === 'rustup' && row.args[0] === 'component');
    if (preview) {
      assert.deepEqual(calls, [], 'read-only plans launch no prerequisite, detection or installation command');
      const entry = payload.preview.entries[0]; assert.equal(entry.scope, allowed ? 'user' : 'cache');
      assert.equal(entry.fallback, allowed); assert.equal(Boolean(entry.action), allowed);
    } else {
      assert.equal(installers.length, Number(allowed), 'only explicitly/default allowed fallback can invoke the harmless task-owned installer');
      assert.equal(payload.actions.length, Number(allowed));
      if (allowed) { assert.equal(payload.actions[0].scope, 'user'); assert.equal(payload.results[0].status, 'installed'); }
      else { assert.equal(payload.results[0].status, 'manual'); await assert.rejects(fs.stat(analyzer), { code: 'ENOENT' }); }
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Canonical/direct installer ' + selected + ' preserves literal no-fallback intent before actual scope selection/execution.');
