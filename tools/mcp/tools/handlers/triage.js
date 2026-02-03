import path from 'node:path';
import { isAbsolutePath } from '../../../../src/shared/files.js';
import { loadUserConfig } from '../../../dict-utils.js';
import { resolveRepoPath } from '../../repo.js';
import { runNodeAsync, runNodeSync } from '../../runner.js';
import { normalizeMetaFilters, resolveRepoRuntimeEnv, toolRoot } from '../helpers.js';
import { buildIndex } from './indexing.js';

/**
 * Handle the MCP triage_ingest tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function triageIngest(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const source = String(args.source || '').trim();
  const inputPath = String(args.inputPath || '').trim();
  if (!source || !inputPath) {
    throw new Error('source and inputPath are required.');
  }
  const resolvedInput = isAbsolutePath(inputPath) ? inputPath : path.join(repoPath, inputPath);
  const metaFilters = normalizeMetaFilters(args.meta);
  const ingestArgs = [path.join(toolRoot, 'tools', 'triage', 'ingest.js'), '--source', source, '--in', resolvedInput];
  ingestArgs.push('--repo', repoPath);
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => ingestArgs.push('--meta', entry));
  }
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: `Ingesting ${source} findings.`, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, ingestArgs, {
    streamOutput: true,
    onLine: progressLine,
    env: runtimeEnv,
    signal: context.signal
  });
  let payload = {};
  try {
    payload = JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`Failed to parse ingest output: ${error?.message || error}`);
  }
  if (args.buildIndex) {
    await buildIndex({
      repoPath,
      mode: 'records',
      incremental: args.incremental === true,
      stubEmbeddings: args.stubEmbeddings === true,
      sqlite: false
    }, context);
  }
  if (progress) {
    progress({ message: 'Triage ingest complete.', phase: 'done' });
  }
  return payload;
}

/**
 * Handle the MCP triage_decision tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function triageDecision(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const finding = String(args.finding || '').trim();
  const status = String(args.status || '').trim();
  if (!finding || !status) {
    throw new Error('finding and status are required.');
  }
  const metaFilters = normalizeMetaFilters(args.meta);
  const decisionArgs = [path.join(toolRoot, 'tools', 'triage', 'decision.js'), '--finding', finding, '--status', status];
  decisionArgs.push('--repo', repoPath);
  if (args.justification) decisionArgs.push('--justification', String(args.justification));
  if (args.reviewer) decisionArgs.push('--reviewer', String(args.reviewer));
  if (args.expires) decisionArgs.push('--expires', String(args.expires));
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => decisionArgs.push('--meta', entry));
  }
  const codes = Array.isArray(args.codes) ? args.codes : (args.codes ? [args.codes] : []);
  const evidence = Array.isArray(args.evidence) ? args.evidence : (args.evidence ? [args.evidence] : []);
  codes.filter(Boolean).forEach((code) => decisionArgs.push('--code', String(code)));
  evidence.filter(Boolean).forEach((item) => decisionArgs.push('--evidence', String(item)));
  const stdout = runNodeSync(repoPath, decisionArgs, { env: runtimeEnv });
  return JSON.parse(stdout || '{}');
}

/**
 * Handle the MCP triage_context_pack tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function triageContextPack(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const recordId = String(args.recordId || '').trim();
  if (!recordId) throw new Error('recordId is required.');
  const contextArgs = [path.join(toolRoot, 'tools', 'triage', 'context-pack.js'), '--record', recordId];
  contextArgs.push('--repo', repoPath);
  if (args.outPath) contextArgs.push('--out', String(args.outPath));
  if (args.ann === true) contextArgs.push('--ann');
  if (args.ann === false) contextArgs.push('--no-ann');
  if (args.stubEmbeddings === true) contextArgs.push('--stub-embeddings');
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: 'Building triage context pack.', phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, contextArgs, {
    streamOutput: true,
    onLine: progressLine,
    env: runtimeEnv,
    signal: context.signal
  });
  if (progress) {
    progress({ message: 'Context pack ready.', phase: 'done' });
  }
  try {
    return JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`Failed to parse context pack output: ${error?.message || error}`);
  }
}
