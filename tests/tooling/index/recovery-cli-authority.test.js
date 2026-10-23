import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

// Real entry/dispatcher. The explicitly selected backend fixture records only;
// actual retained-stage/recovery fixtures own source/config/pointer validation.
const fixture = await makeTempDir('poc-recovery-cli-');
try {
  const repo = path.join(fixture, 'repo'), root = path.join(fixture, 'retained'), trace = path.join(fixture, 'calls.jsonl');
  await fs.mkdir(repo); await fs.mkdir(root);
  const preload = path.join(fixture, 'named-recording-backend.mjs');
  const backend = `import fs from 'node:fs/promises'; export async function buildIndex(repo,options){
    await fs.appendFile(${JSON.stringify(trace)},JSON.stringify({repo,recovery:options.recovery})+'\n');
    return options.recovery.action==='inspect'?{schemaVersion:1,planId:'fixture-plan',repoRoot:repo,buildRoot:options.recovery.indexRoot}: {action:options.recovery.action};
  }`;
  await fs.writeFile(preload, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){
    if(url.endsWith('/src/integrations/core/build-index/index.js'))return{format:'module',shortCircuit:true,source:${JSON.stringify(backend)}};
    return next(url,context);}});`);
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(fixture, 'cache'),
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
  const invoke = args => runNode(['bin/pairofcleats.js', 'index', 'recover', '--repo', repo, '--json', ...args],
    'recovery CLI', process.cwd(), env, { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
  const calls = async () => (await fs.readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'inspect';
  if (selected === 'inspect') {
    const result = invoke(['--index-root', root, '--operation', 'graph', '--mode', 'code']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).buildRoot, root);
    assert.deepEqual(await calls(), [{ repo, recovery: { action: 'inspect', indexRoot: root, operation: 'graph', modes: ['code'] } }]);
  } else if (selected === 'execute') {
    const plan = { schemaVersion: 1, planId: 'fixture-plan', repoRoot: repo, buildRoot: root, operation: 'validate' };
    const filename = path.join(fixture, 'reviewed.json'); await fs.writeFile(filename, JSON.stringify(plan));
    const result = invoke(['--action', 'execute', '--plan-file', filename]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await calls(), [{ repo, recovery: { action: 'execute', plan } }]);
    for (const invalid of [['--index-root', root], ['--operation', 'publish'], ['--mode', 'code']]) {
      assert.notEqual(invoke(['--action', 'execute', '--plan-file', filename, ...invalid]).status, 0);
    }
    assert.equal((await calls()).length, 1, 'mixed selectors never reach recovery');
  } else if (selected === 'selection') {
    const result = invoke(['--action', 'candidates', '--mode', 'all']); assert.equal(result.status, 0, result.stderr);
    const capability = 'a'.repeat(64);
    const opened = invoke(['--action', 'open-graph', '--index-root', root, '--graph-capability', capability]);
    assert.equal(opened.status, 0, opened.stderr);
    assert.deepEqual((await calls()).map(call => call.recovery), [
      { action: 'candidates', modes: ['code', 'prose', 'extracted-prose', 'records'] },
      { action: 'open-graph', indexRoot: root, capabilityId: capability }
    ]);
  } else if (selected === 'invalid') {
    const bad = path.join(fixture, 'bad.json'); await fs.writeFile(bad, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
    for (const args of [[], ['--action', 'execute'], ['--action', 'execute', '--plan-file', bad],
      ['--action', 'candidates', '--index-root', root], ['--index-root', root, '--plan-file', bad]]) {
      const result = invoke(args); assert.notEqual(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, false);
    }
    await assert.rejects(fs.stat(trace), { code: 'ENOENT' });
  } else assert.fail(`Unknown recovery fixture case: ${selected}`);
} finally { await rmDirRecursive(fixture); }
console.log('Recovery CLI preserves exact reviewed requests and rejects ambiguous/malformed authority before work.');
