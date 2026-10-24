import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
const root = process.cwd();
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parity-cold-cleanup-')));
const repo = path.join(temp, 'repo');
const pidDir = path.join(temp, 'pids');
await fs.mkdir(repo); await fs.mkdir(pidDir);
await fs.writeFile(path.join(repo, 'cache.js'), 'export function refreshCache(value) { return value; }\n');
await fs.writeFile(path.join(repo, 'README.md'), '# Refresh cache\nRefresh cached values.\n');
await fs.writeFile(path.join(repo, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { types: [], lib: ['es2022'] }
}));
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
  threads: 1,
  indexing: {
    scm: { provider: 'none' }, workerPool: { enabled: false },
    embeddings: { enabled: false, mode: 'off', hnsw: { enabled: false }, lancedb: { enabled: false } },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false
  },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
}));
const trace = path.join(temp, 'trace.mjs');
await fs.writeFile(trace, `import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(${JSON.stringify(pidDir)},String(process.pid)),JSON.stringify({pid:process.pid,parent:process.ppid,cwd:process.cwd(),argv:process.argv}));`);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_BUNDLE_THREADS: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(trace).href}`.trim() } });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
let primary;
const start = Date.now();
try {
  const result = runNode([path.join(root, 'bin/pairofcleats.js'), 'index', 'build', '--repo', repo,
    '--mode', 'both', '--threads', '1'], 'cold parity setup', repo, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 15000 });
  assert.equal(result.status, 0, `cold build after ${Date.now() - start}ms: ${result.error?.code || result.signal || ''}\n${result.stdout}\n${result.stderr}`);
} catch (error) { primary = error; }
const pids = (await fs.readdir(pidDir)).map(Number);
const deadline = Date.now()+2000;
while (pids.some(alive) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
const cleanupErrors = [];
if(pids.some(alive)) cleanupErrors.push(new Error(`Owned children survived: ${pids.filter(alive).join(',')}`));
try { await fs.rm(temp, {recursive:true,force:true}); } catch(error) { cleanupErrors.push(error); }
if(primary || cleanupErrors.length) throw new AggregateError([primary,...cleanupErrors].filter(Boolean),'Cold setup and cleanup results');
assert.ok(pids.length>=2,'trace the wrapper and real indexing child');
console.log(JSON.stringify({qualification:'cold two-file code/prose build; actual descendant exit and immediate directory removal',ownedProcesses:pids.length,elapsedMs:Date.now()-start}));
