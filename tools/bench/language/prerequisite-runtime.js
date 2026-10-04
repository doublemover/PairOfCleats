import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getToolingConfig, loadUserConfig, getModelConfig, getDictConfig, getDictionaryPaths, getEffectiveConfigHash } from '../../shared/dict-utils.js';
import { detectRepoLanguages, getToolingRegistry, getToolProviderAliases } from '../../tooling/utils.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { selectToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { buildBenchmarkPrerequisiteReadiness } from './prerequisites.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../../sqlite/vector-extension.js';
import { getXxhashBackend } from '../../../src/shared/hash.js';
import { loadTypeScript } from '../../../src/index/tooling/typescript/load.js';
import { isRepoTrusted } from '../../../src/shared/config-authority.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

/** Only app-owned command recipes are invoked, always outside the downloaded checkout. */
export const runBenchmarkPrerequisiteCommand = async ({ scriptRoot, args, timeoutMs, json = false }) => {
  try {
    const result = await spawnSubprocess(process.execPath, args, { cwd: scriptRoot, env: process.env,
      timeoutMs, maxOutputBytes: 2 * 1024 * 1024, output: 'string', rejectOnNonZeroExit: false });
    if (result.stderr) process.stderr.write(result.stderr);
    const receipt = { ok: result.exitCode === 0 && !result.signal, exitCode: result.exitCode, signal: result.signal || null };
    if (json) {
      try { receipt.payload = JSON.parse(result.stdout || ''); }
      catch { receipt.ok = false; receipt.error = 'Prerequisite command produced an invalid JSON receipt.'; }
    }
    return receipt;
  } catch (error) {
    return { ok: false, exitCode: error.result?.exitCode ?? null, signal: error.result?.signal || null,
      error: error.message, code: error.code || null };
  }
};

export const verifyBenchmarkEmbeddingModel = async ({ repoRoot, modelConfig, embeddingsConfig }) => {
  // Probe cached model data without allowing an implicit network download.
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false;
  const { getEmbeddingAdapter } = await import('../../../src/shared/embedding-adapter.js');
  const adapter = getEmbeddingAdapter({ rootDir: repoRoot, modelsDir: modelConfig.dir, modelId: modelConfig.id,
    provider: embeddingsConfig.provider, onnxConfig: embeddingsConfig.onnx, dims: embeddingsConfig.dims, useStub: false });
  const vector = await adapter.embedOne('benchmark prerequisite');
  if (!vector?.length || !Array.from(vector).every(Number.isFinite)) throw new Error('Model returned an empty or non-finite vector.');
  if (Number.isFinite(embeddingsConfig.dims) && embeddingsConfig.dims > 0 && vector.length !== embeddingsConfig.dims) {
    throw new Error(`Model dimensions ${vector.length} disagree with configured ${embeddingsConfig.dims}.`);
  }
  return { dimensions: vector.length, provider: adapter.provider, verificationLevel: 'local-model-inference' };
};

/** Build receipts in the exact environment subsequently used by indexing. Injection is for inert fixtures. */
export const checkBenchmarkPrerequisites = async ({ repoRoot, scriptRoot, buildRoot,
  autoInstall = true, strict = false, realEmbeddings = true, wantsSqlite = false, timeoutMs = 30 * 60 * 1000,
  dependencies = {} }) => {
  const startedAt = Date.now();
  const userConfig = (dependencies.loadUserConfig || loadUserConfig)(repoRoot);
  const toolingConfig = (dependencies.getToolingConfig || getToolingConfig)(repoRoot, userConfig);
  const discovery = await (dependencies.detectRepoLanguages || detectRepoLanguages)(repoRoot);
  const languages = [...new Set([...Object.keys(discovery.languages || {}), ...Object.keys(discovery.formats || {})])].sort();
  (dependencies.registerProviders || registerDefaultToolingProviders)();
  const selected = (dependencies.selectProviders || selectToolingProviders)({ toolingConfig,
    documents: languages.map((languageId) => ({ languageId })) }).map((plan) => plan.provider);
  const registry = (dependencies.getRegistry || getToolingRegistry)(toolingConfig.dir, repoRoot);
  const typescript = selected.some((provider) => provider.id === 'typescript')
    ? await (dependencies.loadTypescript || loadTypeScript)(toolingConfig, repoRoot) : null;
  const tools = [...new Set(selected.flatMap((provider) => {
    // TypeScript uses the public compiler API; install its managed recipe when that API is missing.
    if (provider.id === 'typescript') return typescript ? [] : ['tsserver'];
    const known = registry.find((tool) => getToolProviderAliases(tool.id).includes(provider.id));
    return known ? [known.id] : [];
  }))];
  const runCommand = dependencies.runCommand || runBenchmarkPrerequisiteCommand;
  const assets = [];
  let installation = null;
  let installationReceipt = null;
  let assetSetup = null;
  if (tools.length && autoInstall) {
    const install = await runCommand({ scriptRoot, timeoutMs, json: true,
      args: [path.join(scriptRoot, 'tools/tooling/install.js'), '--root', repoRoot, '--tools', tools.join(','),
        '--scope', toolingConfig.installScope || 'cache', '--json'] });
    installationReceipt = install;
    installation = { items: tools.map((id) => install.payload?.readiness?.items?.find((item) => item.id === id)
      || { id, state: 'failed', reason: install.error || 'Installation did not return the requested tool readiness check.' }) };
    if (!install.ok && installation.items.every((item) => ['available-and-verified', 'installed-and-verified'].includes(item.state))) {
      installation.items.push({ id: 'command-exit', state: 'failed', reason: install.error || `Installation exited ${install.exitCode ?? 'without a status'}.` });
    }
  }

  // Setup is restricted to shared data assets here: no package hydration, repository builds or indexing.
  const setupArgs = [path.join(scriptRoot, 'tools/setup/setup.js'), '--root', repoRoot, '--non-interactive', '--json',
    '--skip-validate', '--skip-install', '--skip-tooling', '--skip-models', '--skip-index', '--skip-sqlite', '--skip-artifacts'];
  const dictConfig = (dependencies.getDictConfig || getDictConfig)(repoRoot, userConfig);
  const needsDictionary = dictConfig.languages.length > 0 || dictConfig.files.length > 0;
  const vectorConfig = (dependencies.getVectorConfig || getVectorExtensionConfig)(repoRoot, userConfig);
  const needsExtension = wantsSqlite && vectorConfig.enabled === true;
  if (!needsDictionary) setupArgs.push('--skip-dicts');
  if (!needsExtension) setupArgs.push('--skip-extensions');
  if (autoInstall && (needsDictionary || needsExtension)) {
    const setup = await runCommand({ scriptRoot, args: setupArgs, timeoutMs, json: true });
    assetSetup = setup;
    for (const id of [needsDictionary && 'dictionaries', needsExtension && 'extensions'].filter(Boolean)) {
      const check = setup.payload?.readiness?.items?.find((item) => item.id === id);
      assets.push(check ? { ...check, required: id === 'dictionaries' || strict }
        : { id, required: id === 'dictionaries' || strict, state: 'unverified', reason: setup.error || 'Missing setup asset receipt.' });
    }
  } else if (!autoInstall && needsDictionary) {
    const paths = await (dependencies.getDictionaryPaths || getDictionaryPaths)(repoRoot, dictConfig);
    assets.push({ id: 'dictionaries', required: true, state: paths.length ? 'available-and-verified' : 'missing',
      verificationLevel: paths.length ? 'artifact-presence' : null });
  }
  if (!autoInstall && needsExtension) {
    const extensionPath = (dependencies.resolveVectorPath || resolveVectorExtensionPath)(vectorConfig);
    assets.push({ id: 'extensions', required: strict, state: extensionPath ? 'available-and-verified' : 'missing',
      verificationLevel: extensionPath ? 'artifact-presence' : null });
  }
  if (realEmbeddings && userConfig.indexing?.embeddings?.enabled !== false) {
    const modelConfig = (dependencies.getModelConfig || getModelConfig)(repoRoot, userConfig);
    const embeddingsConfig = userConfig.indexing?.embeddings || {};
    const verifyModel = dependencies.verifyModel || verifyBenchmarkEmbeddingModel;
    let verification = null;
    let error = null;
    try { verification = await verifyModel({ repoRoot, modelConfig, embeddingsConfig }); }
    catch (failure) { error = failure.message; }
    if (!verification && autoInstall) {
      const download = await runCommand({ scriptRoot, timeoutMs,
        args: [path.join(scriptRoot, 'tools/download/models.js'), '--repo', repoRoot, '--model', modelConfig.id, '--cache-dir', modelConfig.dir] });
      if (download.ok) {
        try { verification = await verifyModel({ repoRoot, modelConfig, embeddingsConfig }); error = null; }
        catch (failure) { error = failure.message; }
      } else error = download.error || 'Model installation failed.';
    }
    assets.push({ id: 'embedding-model', required: true, state: verification ? 'available-and-verified' : 'failed',
      verificationLevel: verification?.verificationLevel || null, details: verification, reason: error });
  }
  const providerIds = selected.map((provider) => provider.id);
  let doctor = null;
  let verificationRoot = null;
  let verificationRootIdentity = null;
  try {
    if (providerIds.length) {
      if (!(dependencies.isRepoTrusted || isRepoTrusted)(repoRoot)) {
        verificationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-installation-probe-'));
        verificationRootIdentity = await fs.stat(verificationRoot);
        const physicalProbeRoot = await fs.realpath(verificationRoot);
        if (isPathWithinRoot(physicalProbeRoot, await fs.realpath(repoRoot))) {
          throw new Error('Installation-only protocol verification must stay outside the selected checkout.');
        }
      }
      doctor = await (dependencies.runDoctor || runToolingDoctor)({
        repoRoot, buildRoot, toolingConfig, strict: false, indexingConfig: userConfig.indexing || {}, analysisPolicy: userConfig.analysisPolicy
      }, providerIds, { handshakeCwd: verificationRoot || repoRoot,
        log: (message) => process.stderr.write(`${message}\n`) });
    }
  } finally {
    if (verificationRoot) {
      const current = await fs.lstat(verificationRoot).catch(() => null);
      if (!current || (current.isDirectory() && verificationRootIdentity
        && current.dev === verificationRootIdentity.dev && current.ino === verificationRootIdentity.ino)) {
        await fs.rm(verificationRoot, { recursive: true, force: true });
      } else process.stderr.write('[prerequisites] owned protocol-probe root changed; cleanup deferred.\n');
    }
  }
  if (!providerIds.length) {
    const backend = await (dependencies.getHashBackend || getXxhashBackend)();
    assets.push({ id: 'chunk-identity', required: true, state: backend ? 'available-and-verified' : 'missing',
      verificationLevel: backend ? 'runtime-backend-load' : null, details: { backend: backend || null } });
  }
  return {
    schemaVersion: 1, repoRoot, generatedAt: new Date().toISOString(), autoInstall, strict,
    durationMs: Date.now() - startedAt,
    revision: doctor?.scm?.head || null,
    revisionStatus: doctor?.scm?.head ? 'doctor-provenance' : 'unverified',
    effectiveConfigHash: getEffectiveConfigHash(repoRoot, userConfig),
    runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch, executable: process.execPath,
      environmentFingerprint: createHash('sha256').update(JSON.stringify(Object.fromEntries([
        'PATH', 'Path', 'PATHEXT', 'NODE_OPTIONS', 'PAIROFCLEATS_HOME', 'PAIROFCLEATS_TOOLING_DIR',
        'PAIROFCLEATS_DICT_DIR', 'PAIROFCLEATS_MODELS_DIR', 'PAIROFCLEATS_EXTENSIONS_DIR'
      ].map((key) => [key, process.env[key] || null])))).digest('hex'),
      fingerprintScope: 'Launch paths, Node options and declared shared resource directories; not the entire environment.' },
    discoveryScope: 'Extension/filename inventory with shared tool-detection exclusions; not an indexed-file coverage claim.',
    languages, languageEvidence: discovery.languages, formats: discovery.formats, requestedProviderIds: providerIds,
    tools, installation, installationReceipt, assetSetup, doctor,
    readiness: buildBenchmarkPrerequisiteReadiness({ assets, installation, doctor, requestedProviderIds: providerIds, strict })
  };
};
