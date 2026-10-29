import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { resolveToolingCommandProfile, probeLspInitializeHandshake } from '../../src/index/tooling/command-resolver.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { probeCommand } from '../shared/cli-utils.js';
import { isTestingEnv } from '../../src/shared/env/testing.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { PHPACTOR_APPROVED_RELEASE, PHPACTOR_POSIX_SHIM } from '../tooling/approved-artifacts.js';
import { GOPLS_VERSION } from '../tooling/gopls-recipe.js';
import { CSHARP_LS_VERSION } from '../tooling/csharp-ls-recipe.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

// Internal qualification recipes: no public CLI, configuration or execution grant.
const recipes = {
  gopls: { command: 'gopls', args: ['serve'], versionArgs: ['version'], versionPrefix: `golang.org/x/tools/gopls v${GOPLS_VERSION}`,
    files: { 'go.mod': 'module example.com/poc-qualification\n\ngo 1.26.0\n',
      'answer.go': 'package qualification\n\nfunc Answer() int { return 42 }\n' } },
  'csharp-ls': { command: 'csharp-ls', args: [], versionArgs: ['--version'], versionPrefix: `csharp-ls, ${CSHARP_LS_VERSION} `,
    files: { 'Qualification.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>\n',
      'Answer.cs': 'public static class Qualification { public static int Answer() => 42; }\n' } },
  phpactor: { command: 'phpactor', args: ['language-server'], versionArgs: ['--version'],
    versionPrefix: `Phpactor ${PHPACTOR_APPROVED_RELEASE.version}`, platforms: ['linux', 'darwin'],
    files: { 'composer.json': '{"name":"poc/qualification"}\n',
      'Answer.php': '<?php\nfinal class Answer { public function value(): int { return 42; } }\n' } }
};

// The pinned PHAR's lib/Extension/LanguageServer/Command/StartCommand.php:37
// emits this one normal info line; repeated or different diagnostics still fail.
const phpactorStartupInfo = 'Starting language server, use -vvv for verbose output';

const expectedCsharpInfo = [
  /^(?:[01]?\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3} info: (?:LifeCycle|Roslyn\.Solution)\[\d+\]$/u,
  new RegExp(`^initializing, csharp-ls version ${CSHARP_LS_VERSION.replaceAll('.', '\\.')} `, 'u'),
  /^csharp-ls is released under MIT license and is not affiliated with Microsoft Corp\.; see https:\/\/github\.com\/razzmatazz\/csharp-language-server$/u,
  /^SDK instances found, as reported by MSBuild:$/u,
  /^- SDK="\.NET Core SDK", Version=[\d.]+, MSBuildPath="[^"]+", DiscoveryType=DotNetSdk$/u,
  /^MSBuildLocator: will register "\.NET Core SDK", Version=[\d.]+ as default instance$/u,
  /^handleInitialize: using workspaceFolders: \[.+\]$/u,
  /^initialize: initial csharp config: \{ logLevel = Some "info"$/u,
  /^(?:applyFormattingOptions|analyzersEnabled|useMetadataUris|razorSupport|locale|debug|debugMode|solutionPathOverride) = (?:None|Some .+) ?\}?$/u,
  /^handleExit: exiting with code 0 \(shutdownReceived=True\)$/u
];

export const runLspQualificationWorker = async input => {
  await requireBootstrap();
  if (!Object.hasOwn(recipes, input.providerId)) throw new Error('Unknown internal LSP qualification recipe');
  const recipe = recipes[input.providerId];
  const fixture = input.fixture || null;
  if (fixture && !isTestingEnv()) throw new Error('Explicit fixture commands require the test environment');
  const receipt = { schemaVersion: 1, providerId: input.providerId, source: process.env.GITHUB_SHA || null,
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    evidence: fixture ? 'explicit-simulated-command' : 'installed-default-command',
    stderr: [], events: [], truncated: false, metrics: null };
  if (!fixture && recipe.platforms && !recipe.platforms.includes(process.platform)) {
    return { ...receipt, ok: false, reason: 'unsupported_platform', supportedPlatforms: recipe.platforms };
  }
  if (!fixture && input.providerId === 'phpactor') {
    const launcherPath = path.join(input.toolingConfig.dir, 'bin', 'phpactor');
    receipt.launcher = { path: launcherPath,
      expectedSha256: createHash('sha256').update(PHPACTOR_POSIX_SHIM).digest('hex') };
    try { receipt.launcher.sha256 = hashManagedToolFile(launcherPath, 16 * 1024); }
    catch (error) { receipt.launcher.error = redactDiagnosticText(describeStorageFailure(error,
      { phase: 'qualification-launcher-bytes' }).message, 1024); }
    if (receipt.launcher.sha256 !== receipt.launcher.expectedSha256) {
      return { ...receipt, ok: false, reason: 'runtime_launcher_unproven' };
    }
    const artifactPath = path.join(input.toolingConfig.dir, 'bin', 'phpactor.phar');
    receipt.artifact = { path: artifactPath, expectedSha256: PHPACTOR_APPROVED_RELEASE.sha256 };
    try { receipt.artifact.sha256 = hashManagedToolFile(artifactPath, 32 * 1024 * 1024); }
    catch (error) { receipt.artifact.error = redactDiagnosticText(describeStorageFailure(error,
      { phase: 'qualification-artifact-bytes' }).message, 1024); }
    if (receipt.artifact.sha256 !== PHPACTOR_APPROVED_RELEASE.sha256) {
      return { ...receipt, ok: false, reason: 'runtime_artifact_unproven' };
    }
  }
  const workspace = path.join(path.resolve(input.diagnosticsDir), '.lsp-qualification', input.providerId);
  fs.mkdirSync(workspace, { recursive: true });
  const fixtureHashes = {};
  for (const [name, content] of Object.entries(recipe.files)) {
    fs.writeFileSync(path.join(workspace, name), content);
    fixtureHashes[name] = createHash('sha256').update(content).digest('hex');
  }
  const profile = resolveToolingCommandProfile({ providerId: input.providerId,
    cmd: fixture?.command || receipt.launcher?.path || recipe.command,
    args: recipe.args, repoRoot: input.repoRoot, toolingConfig: input.toolingConfig });
  Object.assign(receipt, { profile, args: profile.resolved.args, workspace, fixtureHashes });
  if (!profile.probe.ok) return { ...receipt, ok: false, reason: 'command_probe_failed' };
  if (profile.probe.attempted?.some(attempt => attempt.errorCode || attempt.exitCode !== 0)) {
    return { ...receipt, ok: false, reason: 'command_probe_attempt_failed' };
  }
  const command = profile.probe.resolvedPath || profile.resolved.cmd;
  receipt.command = command;
  receipt.commandRealpath = fs.realpathSync(command);
  receipt.binarySha256 = hashManagedToolFile(receipt.commandRealpath);
  const version = probeCommand(command, recipe.versionArgs, { cwd: workspace, env: process.env,
    stdio: 'pipe', timeoutMs: 4000, maxOutputBytes: 16384 });
  receipt.version = { ...version, stdout: redactDiagnosticText(version.stdout, 16384),
    stderr: redactDiagnosticText(version.stderr, 16384) };
  const prefix = fixture?.versionPrefix || recipe.versionPrefix;
  const observedVersion = String(version.stdout).trim();
  const expectedVersion = prefix.trim();
  if (!version.ok || version.status !== 0 || version.stderr
    || !(observedVersion === expectedVersion || observedVersion.startsWith(`${expectedVersion} `))) {
    return { ...receipt, ok: false, reason: 'version_identity_failed' };
  }
  receipt.result = await probeLspInitializeHandshake({ providerId: input.providerId, ...profile.resolved, cwd: workspace,
    toolingConfig: input.toolingConfig, timeoutMs: 4000,
    onStderrLine: line => {
      if (receipt.stderr.length >= 64) { receipt.truncated = true; return; }
      if (String(line).length > 1024) receipt.truncated = true;
      receipt.stderr.push(redactDiagnosticText(line, 1024));
    },
    onLifecycleEvent: event => {
      if (receipt.events.length >= 64) { receipt.truncated = true; return; }
      receipt.events.push({ at: event.at, kind: event.kind, pid: event.pid ?? null,
        code: event.code ?? null, signal: event.signal ?? null,
        ...(event.message ? { message: redactDiagnosticText(event.message, 1024) } : {}) });
    },
    onMetrics: metrics => { receipt.metrics = metrics; }
  });
  receipt.reaped = receipt.events.filter(event => event.kind === 'start')
    .map(event => ({ pid: event.pid, alive: isProcessAlive(event.pid) }));
  const unknownStderr = receipt.stderr.filter((line, index) => input.providerId === 'csharp-ls'
    ? !expectedCsharpInfo.some(pattern => pattern.test(line))
    : input.providerId === 'phpactor' ? index !== 0 || line !== phpactorStartupInfo : true);
  const exit = receipt.events.find(event => event.kind === 'exit');
  const shutdown = receipt.metrics?.byMethod?.shutdown;
  const reasons = [];
  if (!receipt.result.ok) reasons.push('initialize_failed');
  if (shutdown?.succeeded !== 1 || shutdown?.timedOut) reasons.push('shutdown_not_acknowledged');
  if (!exit || exit.code !== 0 || exit.signal) reasons.push('no_clean_server_exit');
  if (!receipt.reaped.length || receipt.reaped.some(item => item.alive)) reasons.push('server_not_reaped');
  if (unknownStderr.length) reasons.push('unexpected_stderr');
  if (receipt.truncated) reasons.push('diagnostics_truncated');
  if (input.providerId === 'phpactor' && !fixture
    && (receipt.result.serverInfo?.name !== 'phpactor/phpactor'
      || receipt.result.serverInfo?.version !== PHPACTOR_APPROVED_RELEASE.version)) reasons.push('server_identity_unproven');
  if (input.providerId === 'csharp-ls' && !fixture) {
    const selectedRoot = process.env.DOTNET_ROOT;
    const reportedPaths = receipt.stderr.flatMap(line => {
      const match = /Version=10\.0\.403, MSBuildPath="([^"]+)"/u.exec(line);
      return match ? [match[1]] : [];
    });
    const physical = value => { try { return fs.realpathSync(value); } catch { return null; } };
    const expectedSdk = selectedRoot ? physical(path.join(selectedRoot, 'sdk', '10.0.403')) : null;
    receipt.sdkSelection = { root: selectedRoot || null, version: '10.0.403', reportedPaths };
    if (!expectedSdk || !reportedPaths.some(value => physical(value) === expectedSdk)
      || !receipt.stderr.includes('MSBuildLocator: will register ".NET Core SDK", Version=10.0.403 as default instance')) {
      reasons.push('server_sdk_identity_unproven');
    }
  }
  return { ...receipt, ok: reasons.length === 0, reasons, unknownStderr };
};

/** Require a fresh qualification worker to exit naturally within 30 seconds. */
export const qualifyInstalledLspRuntime = async ({ providerId, repoRoot, toolingConfig, diagnosticsDir, fixture = null }) => {
  await requireBootstrap();
  if (!Object.hasOwn(recipes, providerId)) throw new Error('Unknown internal LSP qualification recipe');
  const config = { providerId, repoRoot: path.resolve(repoRoot), diagnosticsDir: path.resolve(diagnosticsDir),
    toolingConfig: { dir: toolingConfig.dir, cache: toolingConfig.cache
      ? { dir: toolingConfig.cache.dir, enabled: toolingConfig.cache.enabled } : undefined }, fixture };
  const program = `import { runLspQualificationWorker } from ${JSON.stringify(import.meta.url)};
    process.stdin.setEncoding('utf8');
    let input = ''; for await (const chunk of process.stdin) { input += chunk; if(Buffer.byteLength(input,'utf8')>16384) throw new Error('qualification input exceeds bound'); }
    const receipt = await runLspQualificationWorker(JSON.parse(input));
    process.stdout.write(JSON.stringify(receipt)); if(!receipt.ok) process.exitCode = 1;`;
  let processResult;
  try {
    processResult = await spawnResolvedSubprocess(process.execPath, ['--input-type=module', '-e', program], {
      cwd: repoRoot, env: process.env, input: JSON.stringify(config), stdio: ['pipe', 'pipe', 'pipe'],
      timeoutMs: 30000, maxOutputBytes: 1024 * 1024, outputMode: 'string', rejectOnNonZeroExit: false
    });
  } catch (error) {
    processResult = { ...error.result, error: redactDiagnosticText(error.message || 'qualification worker failed', 1024),
      errorCode: error.code ?? null };
  }
  let receipt = null;
  try { receipt = JSON.parse(processResult.stdout); } catch {}
  const captureFailed = Object.values(processResult.outputCapture || {}).some(stream =>
    stream?.truncated || stream?.encodingLoss || Number(stream?.droppedBytes) > 0);
  const result = { schemaVersion: 1, ok: processResult.exitCode === 0 && !processResult.signal
    && !processResult.error && !processResult.stderr && !captureFailed
    && Number.isFinite(processResult.durationMs) && processResult.durationMs <= 30000 && receipt?.ok === true,
  receipt, process: { exitCode: processResult.exitCode, signal: processResult.signal,
    durationMs: processResult.durationMs, error: processResult.error || null,
    errorCode: processResult.errorCode ?? null,
    stderr: redactDiagnosticText(processResult.stderr || '', 1024 * 1024),
    ...(!receipt ? { stdout: redactDiagnosticText(processResult.stdout || '', 1024 * 1024) } : {}),
    outputCapture: processResult.outputCapture || null } };
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  fs.writeFileSync(path.join(diagnosticsDir, `${providerId}-startup.json`), JSON.stringify(result, null, 2) + '\n');
  return result;
};
