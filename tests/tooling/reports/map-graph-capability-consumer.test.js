import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

// The actual report/dispatcher consume a named trusted graph boundary fixture.
// Backend sealing/authority negatives stay with the real graph capability owner.
const fixture = await makeTempDir('poc-map-graph-capability-');
try {
  const repo = path.join(fixture, 'repo'), retained = path.join(fixture, 'failed-build');
  const snapshot = path.join(fixture, 'immutable-graph'), indexDir = path.join(snapshot, 'index-code');
  const capabilityId = 'a'.repeat(64), buildId = 'reviewed-failed-attempt';
  const out = path.join(fixture, 'map.svg'), trace = path.join(fixture, 'reader.json');
  await fs.mkdir(repo); await fs.mkdir(retained);
  await writePiecesManifest(indexDir, []);
  const graph = { capabilityId, buildId, sourceBuildRoot: retained, indexRoot: snapshot,
    status: 'ready', capability: 'graph' };
  const graphAdapter = `import fs from 'node:fs/promises';
    export const buildIndex = () => {throw new Error('read-only report cannot execute recovery');};
    export const buildSqliteIndex = () => {throw new Error('graph consumption cannot build SQLite');};
    export async function withBuildGraphCapability(root, selected, consume) {
      if(root !== ${JSON.stringify(repo)} || selected.indexRoot !== ${JSON.stringify(retained)} || selected.capabilityId !== ${JSON.stringify(capabilityId)}) throw new Error('Wrong graph selection');
      globalThis.__trustedGraphReader = true;
      try { const result = await consume({...${JSON.stringify(graph)},indexDir:${JSON.stringify(indexDir)}});
        const bytes = await fs.readFile(${JSON.stringify(out)},'utf8');
        if(!bytes.includes('leased graph render')) throw new Error('Graph lease ended before output publication');
        await fs.writeFile(${JSON.stringify(trace)},JSON.stringify({root:selected.indexRoot,releasedAfterOutput:true}));
        return result;
      } finally {globalThis.__trustedGraphReader=false;}
    }`;
  const operationalAdapter = `export async function runOperationalCommand(input) {
    if(!globalThis.__trustedGraphReader || input.id !== 'graphviz') throw new Error('Render escaped original graph reader scope');
    await new Promise(resolve=>setTimeout(resolve,5));
    if(!globalThis.__trustedGraphReader) throw new Error('Render owner retired before settlement');
    return {exitCode:0,stdout:'<svg><text>leased graph render</text></svg>',stderr:''};
  }`;
  const modelAdapter = `export async function buildCodeMap(input) {
    if(!globalThis.__trustedGraphReader || input.indexDir !== ${JSON.stringify(indexDir)}) throw new Error('Map read escaped exact immutable scope');
    return {version:'fixture',root:{},nodes:[],edges:[],summary:{},options:{}};
  } export const buildNodeList=()=>[]; export const buildMapCacheKey=()=> 'graph-capability-fixture';`;
  const preload = path.join(fixture, 'trusted-graph.mjs');
  await fs.writeFile(preload, `import {registerHooks} from 'node:module'; registerHooks({load(url,context,next){
    if(url.endsWith('/src/integrations/core/build-index/index.js'))return{format:'module',shortCircuit:true,source:${JSON.stringify(graphAdapter)}};
    if(url.endsWith('/tools/tooling/operational-execution.js'))return{format:'module',shortCircuit:true,source:${JSON.stringify(operationalAdapter)}};
    if(url.endsWith('/src/map/build-map.js'))return{format:'module',shortCircuit:true,source:${JSON.stringify(modelAdapter)}};
    return next(url,context);}});`);
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(fixture, 'cache'),
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}`.trim() } });
  const args = ['report', 'map', '--repo', repo, '--index-root', retained, '--graph-capability', capabilityId,
    '--format', 'svg', '--out', out, '--json'];
  const child = runNode(['bin/pairofcleats.js', ...args], 'retained graph report', process.cwd(), env,
    { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ok, true); assert.equal(report.identity.selectedIndex.indexDir, indexDir);
  assert.deepEqual(report.identity.selectedIndex.graphCapability, graph);
  assert.deepEqual(JSON.parse(await fs.readFile(trace, 'utf8')), { root: retained, releasedAfterOutput: true });
  await fs.rm(trace);
  const invalid = runNode(['tools/reports/report-code-map.js', '--repo', repo, '--graph-capability', capabilityId, '--json'],
    'missing retained graph root', process.cwd(), env, { timeoutMs: 5000, stdio: 'pipe', allowFailure: true });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /explicit retained --index-root/);
  await assert.rejects(fs.stat(trace), { code: 'ENOENT' });
} finally { await rmDirRecursive(fixture); }
console.log('Dispatcher and map report retain exact graph capability across read, render and output publication.');
