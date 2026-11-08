#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-dedicated-handshake-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
applyTestEnv({ cacheRoot: path.join(tempRoot, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const restorePath = prependLspTestPath({ repoRoot: root, extraPrepend: [path.dirname(process.execPath)] });
const restoreExecution = grantFixtureRepositoryExecution(tempRoot);
const providers = [
  { id: 'jdtls', config: 'jdtls', mode: 'java', args: [] },
  { id: 'csharp-ls', config: 'csharp', mode: 'csharp', args: [] },
  { id: 'solargraph', config: 'solargraph', mode: 'ruby', args: ['stdio'] }
];
const stub = path.join(root, 'tests/fixtures/lsp/stub-lsp-server.js');
const rpcModule = pathToFileURL(path.join(root, 'src/shared/jsonrpc.js')).href;
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const fixtureCommand = async (provider, state) => {
  if (state === 'healthy') {
    const cmd = path.join(root, 'tests/fixtures/lsp/bin',
      process.platform === 'win32' ? provider.id + '.cmd' : provider.id);
    await fs.access(cmd);
    return cmd;
  }
  if (state === 'missing') return path.join(tempRoot, provider.id + '-not-installed.exe');
  const cmd = path.join(tempRoot, provider.id + '-' + state + (process.platform === 'win32' ? '.cmd' : ''));
  const probeExit = state === 'inconclusive' ? 7 : 0;
  let server = stub;
  if (state === 'failed-handshake' || state === 'zero-error') {
    server = path.join(tempRoot, `${state}-server.mjs`);
    await fs.writeFile(server, `
      import {createFramedJsonRpcParser,writeFramedJsonRpc} from ${JSON.stringify(rpcModule)};
      const parser=createFramedJsonRpcParser({onMessage(message){
        if(message.method==='initialize')writeFramedJsonRpc(process.stdout,{jsonrpc:'2.0',id:message.id,
          error:{code:${state === 'zero-error' ? 0 : -32098},message:'intentional initialize fixture failure'}});
      }});
      process.stdin.on('data',chunk=>parser.push(chunk));
    `);
  }
  const windows = [
    '@echo off', 'setlocal', 'set "arg=%~1"',
    `if "%arg:~0,1%"=="-" exit /b ${probeExit}`,
    state === 'abrupt-exit' ? 'exit /b 17'
      : `"${process.execPath}" "${server}" --mode ${provider.mode}`, ''
  ].join('\r\n');
  const posix = [
    '#!/usr/bin/env sh', `case "$1" in -*) exit ${probeExit};; esac`,
    state === 'abrupt-exit' ? 'exit 17'
      : `exec ${shellQuote(process.execPath)} ${shellQuote(server)} --mode ${provider.mode}`, ''
  ].join('\n');
  await fs.writeFile(cmd, process.platform === 'win32' ? windows : posix);
  if (process.platform !== 'win32') await fs.chmod(cmd, 0o755);
  return cmd;
};
try {
  registerDefaultToolingProviders();
  const scenarios = [
    {state:'healthy', selected:providers},
    {state:'missing', selected:[providers[0]]},
    {state:'inconclusive', selected:[providers[2]]},
    {state:'failed-handshake', selected:[providers[1]]},
    {state:'zero-error', selected:[providers[2]]},
    {state:'abrupt-exit', selected:[providers[0]]}
  ];
  for (const {state,selected} of scenarios) {
    const toolingConfig = { enabledTools: selected.map(provider => provider.id) };
    for (const provider of selected) toolingConfig[provider.config] = {
      cmd: await fixtureCommand(provider, state), args: provider.args
    };
    const report = await runToolingDoctor({ repoRoot: tempRoot, buildRoot: tempRoot, toolingConfig, strict: false },
      toolingConfig.enabledTools, { log: () => {}, probeTimeoutMs: 750, handshakeTimeoutMs: 750 });
    let probeSuccessCount = 0, handshakeSuccessCount = 0;
    for (const expected of selected) {
      const provider = report.providers.find(entry => entry.id === expected.id);
      assert.ok(provider, `expected provider report for ${expected.id}`);
      assert.ok(provider.command, `expected command profile for ${expected.id}`);
      assert.equal(provider.command.requested.cmd, toolingConfig[expected.config].cmd, 'select the explicit fixture command');
      const probeOk = state !== 'missing' && state !== 'inconclusive';
      assert.equal(provider.command.probe.ok, probeOk, `${state}: command probe for ${expected.id}`);
      if (probeOk) probeSuccessCount += 1;
      if (state === 'missing') {
        assert.equal(provider.handshake == null, true, `expected no handshake for definitely missing ${expected.id}`);
        continue;
      }
      assert.ok(provider.handshake, `expected handshake probe result for ${expected.id}`);
      assert.equal(typeof provider.handshake.ok, 'boolean', `expected boolean handshake status for ${expected.id}`);
      assert.equal(provider.handshake.contextRoot, tempRoot);
      assert.equal(provider.handshake.scope, 'selected-workspace');
      assert.equal(provider.handshake.ok, state === 'healthy' || state === 'inconclusive', `${state}: initialize result for ${expected.id}`);
      if (provider.handshake.ok) handshakeSuccessCount += 1;
      else assert.ok(typeof provider.handshake.errorCode === 'string' && provider.handshake.errorCode.length > 0,
        `expected handshake error code for ${expected.id} when handshake is not ok`);
      if (state === 'failed-handshake') assert.equal(provider.handshake.errorCode, '-32098');
      if (state === 'zero-error') assert.equal(provider.handshake.errorCode, '0');
      if (state === 'inconclusive') assert.ok(provider.checks.some(check => check.name === `${expected.id}-command`
        && check.status === 'warn' && check.message.includes('inconclusive')), 'retain the inconclusive-probe diagnostic');
    }
    assert.equal(probeSuccessCount, state !== 'missing' && state !== 'inconclusive' ? selected.length : 0);
    assert.equal(handshakeSuccessCount, state === 'healthy' || state === 'inconclusive' ? selected.length : 0);
    console.log(JSON.stringify({ fixture: 'dedicated-provider-handshake', state, providers: selected.length, probeSuccessCount, handshakeSuccessCount }));
  }
} finally {
  restoreExecution();
  await restorePath();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
console.log('tooling doctor dedicated provider handshake fixtures test passed');
