#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path, { isAbsolute } from 'node:path';

import { detectTool, getToolingRegistry } from '../../../tools/tooling/utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = resolveTestCachePath(root, `tooling-install-detect-plan-matrix-${process.pid}-${Date.now()}`);

const runCliJson = ({ scriptPath, args, env = process.env, cwd = root, label }) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', env, cwd });
  assert.equal(result.status, 0, `${label} exited non-zero\n${result.stderr || result.stdout}`);
  try {
    return JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    assert.fail(`${label} did not return valid JSON: ${error.message}`);
  }
};

const makeScript = async (targetPath, body, helperBody = '#!/usr/bin/env node\nprocess.exit(0);\n') => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, body, 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(targetPath, 0o755);
    return;
  }
  await fs.writeFile(path.join(path.dirname(targetPath), 'ok.js'), helperBody, 'utf8');
};

const runDetectCases = () => {
  const payload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'detect.js'),
    args: ['--root', fixtureRoot, '--json'],
    label: 'tooling-detect baseline'
  });

  const languages = payload.languages || {};
  for (const lang of ['python', 'rust', 'go', 'java', 'cpp', 'objc', 'swift']) {
    assert.ok(languages[lang], `expected detected language ${lang}`);
  }

  const toolIds = new Set((payload.tools || []).map((tool) => tool.id));
  for (const toolId of ['clangd', 'gopls', 'rust-analyzer', 'jdtls', 'sourcekit-lsp']) {
    assert.ok(toolIds.has(toolId), `expected detected tool ${toolId}`);
  }
  for (const tool of payload.tools || []) {
    assert.ok(tool?.probe && typeof tool.probe === 'object', `expected probe payload for ${tool?.id || 'unknown'}`);
    assert.ok(String(tool.probe.outcome || ''), `expected probe outcome for ${tool?.id || 'unknown'}`);
  }

  const genericPayload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'detect.js'),
    args: ['--root', fixtureRoot, '--languages', 'go,rust,yaml,lua,zig', '--json'],
    label: 'tooling-detect generic lsp'
  });
  const genericIds = new Set((genericPayload.tools || []).map((tool) => tool.id));
  for (const toolId of ['gopls', 'rust-analyzer', 'yaml-language-server', 'lua-language-server', 'zls']) {
    assert.ok(genericIds.has(toolId), `expected generic tool ${toolId}`);
  }

  const dedicatedPayload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'detect.js'),
    args: ['--root', fixtureRoot, '--languages', 'java,csharp,ruby,elixir,haskell,php,dart', '--json'],
    label: 'tooling-detect dedicated lsp'
  });
  const dedicatedIds = new Set((dedicatedPayload.tools || []).map((tool) => tool.id));
  for (const toolId of ['jdtls', 'csharp-ls', 'solargraph', 'elixir-ls', 'haskell-language-server', 'phpactor', 'dart']) {
    assert.ok(dedicatedIds.has(toolId), `expected dedicated tool ${toolId}`);
  }
};

const runGlobalFallbackCase = async () => {
  const caseRoot = path.join(tempRoot, 'global-fallbacks');
  const homeDir = path.join(caseRoot, 'home');
  const appDataDir = path.join(caseRoot, 'appdata');
  const localAppDataDir = path.join(caseRoot, 'localappdata');
  const dotnetGlobalBin = path.join(homeDir, '.dotnet', 'tools');
  const phpactorGlobalBin = path.join(localAppDataDir, 'Programs', 'phpactor');
  const gemGlobalBin = path.join(homeDir, '.local', 'share', 'gem', 'ruby', '3.4.0', 'bin');

  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(localAppDataDir, 'Microsoft', 'WindowsApps'), { recursive: true });

  if (process.platform === 'win32') {
    await fs.mkdir(dotnetGlobalBin, { recursive: true });
    await fs.mkdir(phpactorGlobalBin, { recursive: true });
    await fs.mkdir(gemGlobalBin, { recursive: true });
    await fs.writeFile(path.join(dotnetGlobalBin, 'csharp-ls.cmd'), '@echo off\r\nif "%1"=="--version" exit /b 1\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n', 'utf8');
    await fs.writeFile(path.join(phpactorGlobalBin, 'phpactor.cmd'), '@echo off\r\nif "%1"=="--version" exit /b 0\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n', 'utf8');
    await fs.writeFile(path.join(gemGlobalBin, 'solargraph.cmd'), '@echo off\r\nif "%1"=="--version" exit /b 0\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n', 'utf8');
  } else {
    await makeScript(path.join(dotnetGlobalBin, 'csharp-ls'), '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 1; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n');
    await makeScript(path.join(phpactorGlobalBin, 'phpactor'), '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n');
    await makeScript(path.join(gemGlobalBin, 'solargraph'), '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n');
  }

  const baselinePath = path.dirname(process.execPath);
  const payload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'detect.js'),
    args: ['--root', fixtureRoot, '--languages', 'csharp,ruby,php', '--json'],
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      PATH: baselinePath,
      Path: baselinePath
    },
    label: 'tooling-detect global bin fallbacks'
  });

  const byId = new Map((payload.tools || []).map((entry) => [entry?.id, entry]));
  for (const toolId of ['csharp-ls', 'solargraph', 'phpactor']) {
    assert.equal(byId.get(toolId)?.found, true, `expected ${toolId} to be detected from global fallback`);
  }
};

const runRequirementCases = async () => {
  const goBinDir = path.join(tempRoot, 'go-requirement', 'bin');
  await fs.rm(path.dirname(goBinDir), { recursive: true, force: true });
  await fs.mkdir(goBinDir, { recursive: true });
  if (process.platform === 'win32') {
    await fs.writeFile(path.join(goBinDir, 'go.cmd'), '@echo off\r\nnode "%~dp0\\ok.js" %*\r\n', 'utf8');
    await fs.writeFile(path.join(goBinDir, 'ok.js'), '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');
  } else {
    await makeScript(path.join(goBinDir, 'go'), '#!/bin/sh\nif [ "$1" = "version" ]; then exit 0; fi\nif [ "$1" = "install" ]; then exit 0; fi\nexit 1\n');
  }
  const goPayload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'install.js'),
    args: ['--root', fixtureRoot, '--tools', 'gopls', '--dry-run', '--json'],
    env: { ...process.env, PATH: goBinDir, Path: goBinDir },
    label: 'tooling-install gopls requirement probe'
  });
  const goplsResult = (goPayload.results || []).find((entry) => entry?.id === 'gopls');
  const goplsAction = (goPayload.actions || []).find((entry) => entry?.id === 'gopls');
  assert.notEqual(goplsResult?.status, 'missing-requirement');
  assert.ok(goplsAction, 'expected gopls install action');
  assert.ok(isAbsolute(String(goplsAction?.env?.GOBIN || '')), 'expected absolute GOBIN');

  const dotnetBinDir = path.join(tempRoot, 'dotnet-requirement', 'bin');
  await fs.rm(path.dirname(dotnetBinDir), { recursive: true, force: true });
  await fs.mkdir(dotnetBinDir, { recursive: true });
  if (process.platform === 'win32') {
    await fs.writeFile(path.join(dotnetBinDir, 'dotnet.cmd'), '@echo off\r\nif "%1"=="--info" exit /b 0\r\nif "%1"=="--version" exit /b 1\r\nif "%1"=="tool" exit /b 0\r\nexit /b 1\r\n', 'utf8');
  } else {
    await makeScript(path.join(dotnetBinDir, 'dotnet'), '#!/bin/sh\nif [ "$1" = "--info" ]; then exit 0; fi\nif [ "$1" = "--version" ]; then exit 1; fi\nif [ "$1" = "tool" ]; then exit 0; fi\nexit 1\n');
  }
  const dotnetPayload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'install.js'),
    args: ['--root', fixtureRoot, '--tools', 'csharp-ls', '--dry-run', '--json'],
    env: { ...process.env, PATH: dotnetBinDir, Path: dotnetBinDir },
    label: 'tooling-install dotnet requirement probe'
  });
  const csharpResult = (dotnetPayload.results || []).find((entry) => entry?.id === 'csharp-ls');
  const csharpAction = (dotnetPayload.actions || []).find((entry) => entry?.id === 'csharp-ls');
  assert.notEqual(csharpResult?.status, 'missing-requirement');
  if (csharpResult?.status !== 'already-installed') {
    assert.ok(csharpAction, 'expected csharp-ls install action');
  }
};

const runPlanCase = () => {
  const payload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'install.js'),
    args: ['--root', fixtureRoot, '--tools', 'yaml-language-server,lua-language-server,zls', '--dry-run', '--json'],
    label: 'tooling-install generic lsp plans'
  });

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const results = Array.isArray(payload.results) ? payload.results : [];
  const yamlAction = actions.find((entry) => entry?.id === 'yaml-language-server');
  const yamlResult = results.find((entry) => entry?.id === 'yaml-language-server');
  assert.ok(yamlAction || yamlResult, 'expected yaml-language-server action or result');
  if (yamlAction) {
    assert.equal(yamlAction.cmd, 'npm');
  }
  if (yamlResult) {
    assert.notEqual(yamlResult.status, 'manual');
  }

  const luaAction = actions.find((entry) => entry?.id === 'lua-language-server');
  const luaResult = results.find((entry) => entry?.id === 'lua-language-server');
  assert.ok(luaAction || luaResult, 'expected lua-language-server action or result');
  if (luaAction) {
    assert.equal(String(luaAction.cmd || ''), process.execPath);
    assert.equal(
      Array.isArray(luaAction.args) && luaAction.args.some((entry) => String(entry).includes('install-lua-language-server.js')),
      true,
      'expected lua-language-server plan to invoke the managed installer'
    );
  }
  if (luaResult) {
    assert.notEqual(luaResult.status, 'manual');
  }

  const zlsAction = actions.find((entry) => entry?.id === 'zls');
  const zlsResult = results.find((entry) => entry?.id === 'zls');
  assert.equal(zlsAction, undefined, 'zls should not emit an auto-install action');
  assert.ok(zlsResult && ['manual', 'already-installed'].includes(zlsResult.status), 'expected zls manual/already-installed result');
};

const runRegistryContractCases = () => {
  const registry = getToolingRegistry(path.join(tempRoot, 'registry-cache-root'), root);

  const pyright = registry.find((tool) => tool?.id === 'pyright');
  assert.ok(pyright, 'expected pyright entry in tooling registry');
  assert.equal(pyright.detect?.cmd, 'pyright-langserver', 'pyright tooling detection must use pyright-langserver');
  assert.ok(
    Array.isArray(pyright.detect?.args) && pyright.detect.args.includes('--help'),
    'pyright-langserver detection should include --help probe'
  );

  for (const toolId of ['gopls', 'sqls']) {
    const tool = registry.find((entry) => entry?.id === toolId);
    assert.ok(tool, `expected ${toolId} entry in tooling registry`);
    assert.ok(isAbsolute(String(tool.install?.cache?.env?.GOBIN || '')), `${toolId} cache install must use an absolute GOBIN`);
  }

  for (const toolId of ['omnisharp', 'csharp-ls']) {
    const tool = registry.find((entry) => entry?.id === toolId);
    assert.ok(tool, `expected ${toolId} entry in tooling registry`);
    const args = Array.isArray(tool.install?.cache?.args) ? tool.install.cache.args : [];
    const toolPathIndex = args.indexOf('--tool-path');
    assert.notEqual(toolPathIndex, -1, `${toolId} cache install must include --tool-path`);
    assert.ok(isAbsolute(String(args[toolPathIndex + 1] || '')), `${toolId} cache install must use an absolute --tool-path`);
  }

  for (const toolId of ['ruby-lsp', 'solargraph']) {
    const tool = registry.find((entry) => entry?.id === toolId);
    assert.ok(tool, `expected ${toolId} entry in tooling registry`);
    const args = Array.isArray(tool.install?.cache?.args) ? tool.install.cache.args : [];
    const installIndex = args.indexOf('-i');
    const binIndex = args.indexOf('-n');
    assert.notEqual(installIndex, -1, `${toolId} cache install must include -i`);
    assert.notEqual(binIndex, -1, `${toolId} cache install must include -n`);
    assert.ok(isAbsolute(String(args[installIndex + 1] || '')), `${toolId} cache install must use an absolute gem install dir`);
    assert.ok(isAbsolute(String(args[binIndex + 1] || '')), `${toolId} cache install must use an absolute gem bin dir`);
  }

  const phpactor = registry.find((entry) => entry?.id === 'phpactor');
  assert.ok(phpactor, 'expected phpactor entry in tooling registry');
  const phpactorArgs = Array.isArray(phpactor.install?.cache?.args) ? phpactor.install.cache.args : [];
  const toolingRootIndex = phpactorArgs.indexOf('--tooling-root');
  assert.notEqual(toolingRootIndex, -1, 'phpactor cache install must include --tooling-root');
  assert.ok(isAbsolute(String(phpactorArgs[toolingRootIndex + 1] || '')), 'phpactor cache install must use an absolute tooling root');

  const luaLanguageServer = registry.find((entry) => entry?.id === 'lua-language-server');
  assert.ok(luaLanguageServer, 'expected lua-language-server entry in tooling registry');
  const luaArgs = Array.isArray(luaLanguageServer.install?.cache?.args) ? luaLanguageServer.install.cache.args : [];
  const luaToolingRootIndex = luaArgs.indexOf('--tooling-root');
  assert.notEqual(luaToolingRootIndex, -1, 'lua-language-server cache install must include --tooling-root');
  assert.ok(isAbsolute(String(luaArgs[luaToolingRootIndex + 1] || '')), 'lua-language-server cache install must use an absolute tooling root');
};

const runPhpactorPlanCase = () => {
  const payload = runCliJson({
    scriptPath: path.join(root, 'tools', 'tooling', 'install.js'),
    args: ['--root', fixtureRoot, '--tools', 'phpactor', '--dry-run', '--json'],
    label: 'tooling-install phpactor phar plan'
  });

  const phpactorResult = Array.isArray(payload?.results)
    ? payload.results.find((entry) => entry?.id === 'phpactor')
    : null;
  if (['already-installed', 'missing-requirement', 'manual'].includes(String(phpactorResult?.status || ''))) {
    return;
  }

  const phpactorAction = Array.isArray(payload?.actions)
    ? payload.actions.find((entry) => entry?.id === 'phpactor')
    : null;
  assert.ok(phpactorAction, 'expected phpactor install action');
  assert.equal(phpactorAction.cmd, process.execPath, 'expected phpactor plan to execute via node');
  const args = Array.isArray(phpactorAction.args) ? phpactorAction.args.map((value) => String(value)) : [];
  assert.equal(
    args.some((value) => value.endsWith(path.join('tools', 'tooling', 'install-phpactor-phar.js'))),
    true,
    'expected phpactor phar installer script'
  );
  assert.equal(args.includes('--scope') && args.includes('cache'), true, 'expected cache scope install args');
  const toolingRootIndex = args.indexOf('--tooling-root');
  assert.equal(
    toolingRootIndex !== -1 && isAbsolute(String(args[toolingRootIndex + 1] || '')),
    true,
    'expected absolute tooling root'
  );
};

const runPyrightPathFallbackCase = async () => {
  const caseRoot = path.join(tempRoot, 'pyright-path-fallback');
  const binDir = path.join(caseRoot, 'bin');
  const toolingRoot = path.join(caseRoot, 'tooling-root');

  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(toolingRoot, { recursive: true });

  if (process.platform === 'win32') {
    await fs.writeFile(path.join(binDir, 'pyright-langserver.cmd'), '@echo off\r\nif "%1"=="--help" exit /b 0\r\nexit /b 0\r\n', 'utf8');
  } else {
    await makeScript(path.join(binDir, 'pyright-langserver'), '#!/bin/sh\nexit 0\n');
  }

  const registry = getToolingRegistry(toolingRoot, root);
  const pyright = registry.find((entry) => entry?.id === 'pyright');
  assert.ok(pyright, 'expected pyright registry entry');
  const pyrightPathOnly = {
    ...pyright,
    detect: {
      ...(pyright.detect || {}),
      binDirs: []
    }
  };

  await withTemporaryEnv({ PATH: '', Path: binDir }, async () => {
    const status = detectTool(pyrightPathOnly);
    assert.equal(status?.found, true);
    assert.equal(status?.source, 'path');
    assert.ok(String(status?.path || '').toLowerCase().includes('pyright-langserver'));
  });
};

const runLuaBrokenManagedLayoutCase = async () => {
  const caseRoot = path.join(tempRoot, 'lua-broken-managed-layout');
  const toolingRoot = path.join(caseRoot, 'tooling-root');
  const binDir = path.join(toolingRoot, 'bin');

  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(binDir, { recursive: true });

  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(binDir, 'lua-language-server.cmd'),
      '@echo off\r\nif "%1"=="-v" exit /b 0\r\nexit /b 0\r\n',
      'utf8'
    );
  } else {
    await makeScript(path.join(binDir, 'lua-language-server'), '#!/bin/sh\nexit 0\n');
  }

  const registry = getToolingRegistry(toolingRoot, root);
  const luaLanguageServer = registry.find((entry) => entry?.id === 'lua-language-server');
  assert.ok(luaLanguageServer, 'expected lua-language-server registry entry');

  await withTemporaryEnv({ PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) }, async () => {
    const status = detectTool(luaLanguageServer);
    assert.equal(status?.found, false, 'expected broken managed Lua layout to be rejected during detection');
    assert.equal(status?.probe?.validationFailure?.reasonCode, 'broken-layout');
  });
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

try {
  runDetectCases();
  await runGlobalFallbackCase();
  await runRequirementCases();
  runPlanCase();
  runRegistryContractCases();
  runPhpactorPlanCase();
  await runPyrightPathFallbackCase();
  await runLuaBrokenManagedLayoutCase();
  console.log('tooling install detect/plan contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
