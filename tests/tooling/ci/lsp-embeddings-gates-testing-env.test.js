#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `lsp-embeddings-gates-testing-env-${process.pid}-${Date.now()}`);
const gatePath = path.join(root, 'tools', 'ci', 'run-lsp-embeddings-gates.js');
const probePath = path.join(tempRoot, 'testing-env-probe.test.js');
const testsJsonPath = path.join(tempRoot, 'tests.json');
const junitPath = path.join(tempRoot, 'junit.xml');
const diagnosticsPath = path.join(tempRoot, 'diagnostics.json');
const GATE_TIMEOUT_MS = 20_000;

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(
  probePath,
  [
    "#!/usr/bin/env node",
    "if (process.env.PAIROFCLEATS_TESTING !== '1') {",
    "  console.error(`expected PAIROFCLEATS_TESTING=1, received ${String(process.env.PAIROFCLEATS_TESTING)}`);",
    '  process.exit(9);',
    '}',
    "console.log('testing env probe passed');"
  ].join('\n'),
  'utf8'
);

await fs.writeFile(
  testsJsonPath,
  `${JSON.stringify([{ label: 'testing-env-probe', file: probePath, timeoutMs: 5000 }], null, 2)}\n`,
  'utf8'
);

const result = runNode(
  [
    gatePath,
    '--tests-json',
    testsJsonPath,
    '--junit',
    junitPath,
    '--diagnostics',
    diagnosticsPath
  ],
  'lsp embeddings gates testing env',
  root,
  applyTestEnv({ testing: '0', syncProcess: false }),
  { stdio: 'pipe', timeoutMs: GATE_TIMEOUT_MS, allowFailure: true }
);

if (result.status !== 0) {
  console.error('lsp embeddings gates testing env test failed');
  console.error(result.stderr || result.stdout || '');
}
assert.equal(result.status, 0, `expected gate exit code 0, received ${result.status}`);

const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
assert.equal(diagnostics?.status, 'ok', `expected diagnostics status=ok, received ${String(diagnostics?.status)}`);
assert.equal(diagnostics?.metrics?.executed, 1, 'expected one executed gate test');
assert.equal(diagnostics?.results?.[0]?.status, 'passed', 'expected probe test status=passed');

// Explicit inert spawn adapter qualifies the default gate's routing, without
// substituting for the separately executed real cache/native fixtures.
const shim = path.join(tempRoot, 'default-gate-spawns.mjs');
const callsPath = path.join(tempRoot, 'default-calls.json');
await fs.writeFile(shim, `import fs from 'node:fs';import {registerHooks} from 'node:module';
  const calls=[];
  registerHooks({resolve(specifier,context,next){
    if(context.parentURL===${JSON.stringify(pathToFileURL(gatePath).href)}&&specifier==='../../src/shared/subprocess/runner.js')
      return {url:'gate-routing:explicit-fixture',shortCircuit:true};return next(specifier,context);
  },load(url,context,next){if(url==='gate-routing:explicit-fixture')return {format:'module',shortCircuit:true,source:
    'export const spawnSubprocessSync=(command,args,options)=>globalThis.fixtureGateSpawn(command,args,options);'};
    return next(url,context);}});
  globalThis.fixtureGateSpawn=(command,args,options)=>{calls.push({command,args,timeoutMs:options.timeoutMs,
    testing:options.env.PAIROFCLEATS_TESTING,testId:options.env.PAIROFCLEATS_TEST_ID});
    fs.writeFileSync(${JSON.stringify(callsPath)},JSON.stringify(calls));return {exitCode:0,signal:null};};`);
const defaults = runNode([gatePath, '--junit', junitPath, '--diagnostics', diagnosticsPath],
  'default gate case routing', root, applyTestEnv({ testing: '0', syncProcess: false, extraEnv: {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(shim).href}`.trim()
  } }), { stdio: 'pipe', timeoutMs: GATE_TIMEOUT_MS, allowFailure: true });
assert.equal(defaults.status, 0, defaults.stderr);
const calls = JSON.parse(await fs.readFile(callsPath, 'utf8'));
assert.equal(calls.length, 4, 'LSP, current dimension validation and both bounded cache cases execute');
assert.ok(calls.some(call => call.args[0].endsWith('dims-validation.test.js')));
assert.ok(calls.every(call => call.testing === '1'));
const cacheCalls = calls.filter(call => call.args[0].endsWith('cache-identity.test.js'));
assert.deepEqual(cacheCalls.map(call => call.testId), [
  'indexing/embeddings/cache-identity/inline-publication',
  'indexing/embeddings/cache-identity/standalone-dimension-transition'
]);
assert.ok(cacheCalls.every(call => call.timeoutMs === 30000));

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('lsp embeddings gates testing env test passed');
