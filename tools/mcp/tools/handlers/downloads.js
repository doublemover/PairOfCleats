import path from 'node:path';
import { DEFAULT_MODEL_ID, getModelConfig } from '../../../shared/dict-utils.js';
import { createProgressReporter, createStreamLineProgressForwarder } from '../../../../src/shared/progress-events.js';
import { parseCountSummary, parseExtensionPath, runNodeAsync, runNodeSync, runToolWithProgress } from '../../runner.js';
import { resolveMcpRepoContext, toolRoot } from '../helpers.js';
import { parseNameUrlSources } from '../../../shared/input-parsers.js';

/**
 * Handle the MCP download_models tool call.
 * @param {object} [args]
 * @returns {{model:string,output:string}}
 */
export async function downloadModels(args = {}, context = {}) {
  const { repoPath, userConfig, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const model = args.model || modelConfig.id || DEFAULT_MODEL_ID;
  const scriptArgs = [path.join(toolRoot, 'tools', 'download', 'models.js'), '--model', model, '--repo', repoPath];
  if (args.cacheDir) scriptArgs.push('--cache-dir', args.cacheDir);
  const reporter = createProgressReporter(context);
  const progressLine = createStreamLineProgressForwarder(context);
  reporter?.start(`Downloading model ${model}.`);
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, {
    streamOutput: true,
    onLine: progressLine,
    env: runtimeEnv,
    signal: context.signal
  });
  reporter?.done(`Model download complete (${model}).`);
  return { model, output: stdout.trim() };
}

/**
 * Handle the MCP download_dictionaries tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function downloadDictionaries(args = {}, context = {}) {
  if (args.dir != null) throw new Error('MCP dictionary downloads use user-owned storage configuration.');
  const { repoPath, runtimeEnv, userConfig } = resolveMcpRepoContext(args.repoPath);
  const approved = userConfig.security?.downloads?.allowlist || {};
  for (const source of parseNameUrlSources(args.url, { fileNameFromName: (name) => `${name}.txt` })) {
    if (!/^[a-f0-9]{64}$/i.test(String(approved[source.url] || ''))) {
      throw new Error('MCP custom dictionary sources require an exact URL/digest in user-owned download policy.');
    }
  }
  const scriptArgs = [path.join(toolRoot, 'tools', 'download', 'dicts.js'), '--repo', repoPath];
  if (args.lang) scriptArgs.push('--lang', String(args.lang));
  const urls = Array.isArray(args.url) ? args.url : (args.url ? [args.url] : []);
  urls.forEach((value) => scriptArgs.push('--url', String(value)));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.update === true) scriptArgs.push('--update');
  if (args.force === true) scriptArgs.push('--force');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Downloading dictionaries.',
    doneMessage: 'Dictionary download complete.',
    env: runtimeEnv
  });
  const summary = parseCountSummary(stdout);
  return {
    repoPath,
    output: stdout.trim(),
    ...(summary || {})
  };
}

/**
 * Handle the MCP download_extensions tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function downloadExtensions(args = {}, context = {}) {
  for (const key of ['url', 'dir', 'out', 'provider', 'platform', 'arch']) {
    if (args[key] != null) throw new Error('MCP native downloads use the launching user’s configured source and storage only.');
  }
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'download', 'extensions.js'), '--repo', repoPath];
  if (args.provider) scriptArgs.push('--provider', String(args.provider));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.out) scriptArgs.push('--out', String(args.out));
  if (args.platform) scriptArgs.push('--platform', String(args.platform));
  if (args.arch) scriptArgs.push('--arch', String(args.arch));
  const urls = Array.isArray(args.url) ? args.url : (args.url ? [args.url] : []);
  urls.forEach((value) => scriptArgs.push('--url', String(value)));
  if (args.update === true) scriptArgs.push('--update');
  if (args.force === true) scriptArgs.push('--force');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Downloading extensions.',
    doneMessage: 'Extension download complete.',
    env: runtimeEnv
  });
  const summary = parseCountSummary(stdout);
  const resolvedPath = parseExtensionPath(stdout);
  return {
    repoPath,
    output: stdout.trim(),
    extensionPath: resolvedPath,
    ...(summary || {})
  };
}

/**
 * Handle the MCP verify_extensions tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function verifyExtensions(args = {}) {
  for (const key of ['path', 'dir', 'provider', 'platform', 'arch']) {
    if (args[key] != null) throw new Error('MCP native verification uses the launching user’s configured artifact only.');
  }
  if (args.load === true && process.env.PAIROFCLEATS_MCP_ALLOW_NATIVE_LOAD !== '1') {
    throw new Error('MCP native loading requires explicit launch-time authorization. Verification is non-loading by default.');
  }
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'sqlite', 'verify-extensions.js'), '--json', '--repo', repoPath];
  if (args.provider) scriptArgs.push('--provider', String(args.provider));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.path) scriptArgs.push('--path', String(args.path));
  if (args.platform) scriptArgs.push('--platform', String(args.platform));
  if (args.arch) scriptArgs.push('--arch', String(args.arch));
  if (args.module) scriptArgs.push('--module', String(args.module));
  if (args.table) scriptArgs.push('--table', String(args.table));
  if (args.column) scriptArgs.push('--column', String(args.column));
  if (args.encoding) scriptArgs.push('--encoding', String(args.encoding));
  if (args.options) scriptArgs.push('--options', String(args.options));
  if (args.annMode) scriptArgs.push('--ann-mode', String(args.annMode));
  scriptArgs.push(args.load === true ? '--load' : '--no-load');
  const stdout = runNodeSync(repoPath, scriptArgs, { env: runtimeEnv });
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { repoPath, output: stdout.trim() };
  }
}
