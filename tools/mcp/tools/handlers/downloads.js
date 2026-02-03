import path from 'node:path';
import { DEFAULT_MODEL_ID, getModelConfig, loadUserConfig } from '../../../shared/dict-utils.js';
import { resolveRepoPath } from '../../repo.js';
import { parseCountSummary, parseExtensionPath, runNodeAsync, runNodeSync, runToolWithProgress } from '../../runner.js';
import { resolveRepoRuntimeEnv, toolRoot } from '../helpers.js';

/**
 * Handle the MCP download_models tool call.
 * @param {object} [args]
 * @returns {{model:string,output:string}}
 */
export async function downloadModels(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, userConfig);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const model = args.model || modelConfig.id || DEFAULT_MODEL_ID;
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-models.js'), '--model', model, '--repo', repoPath];
  if (args.cacheDir) scriptArgs.push('--cache-dir', args.cacheDir);
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: `Downloading model ${model}.`, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, {
    streamOutput: true,
    onLine: progressLine,
    env: runtimeEnv,
    signal: context.signal
  });
  if (progress) {
    progress({ message: `Model download complete (${model}).`, phase: 'done' });
  }
  return { model, output: stdout.trim() };
}

/**
 * Handle the MCP download_dictionaries tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function downloadDictionaries(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-dicts.js'), '--repo', repoPath];
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
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-extensions.js'), '--repo', repoPath];
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
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const scriptArgs = [path.join(toolRoot, 'tools', 'verify-extensions.js'), '--json', '--repo', repoPath];
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
  if (args.load === false) scriptArgs.push('--no-load');
  const stdout = runNodeSync(repoPath, scriptArgs, { env: runtimeEnv });
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { repoPath, output: stdout.trim() };
  }
}
