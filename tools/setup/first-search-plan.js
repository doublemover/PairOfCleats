import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { modify, applyEdits } from 'jsonc-parser';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { mergeConfig } from '../../src/shared/config.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { validateConfig } from '../../src/config/validate.js';
import { loadUserConfig, readShippedConfigSchema } from '../dict-utils/config.js';
import { getToolingConfig, resolveRepoCacheRootPath, resolveToolRoot } from '../shared/dict-utils.js';
import { buildToolingReport, resolveToolsById, selectInstallPlan } from '../tooling/utils.js';
import { runCommand } from '../shared/cli-utils.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const readOptional = file => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Setup config must be a bounded regular file.');
    return fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

export const createFirstSearchPlan = async ({ repoRoot, profile = 'sparse', model = null, backend = 'memory', tools = [] } = {}) => {
  repoRoot = fs.realpathSync(repoRoot);
  if (!['sparse', 'semantic'].includes(profile) || !['memory', 'sqlite', 'lmdb'].includes(backend)) throw new Error('Unsupported setup profile/backend.');
  if (profile === 'semantic' && !model) throw new Error('Semantic planning requires an explicit --model; no download is chosen by default.');
  const toolRoot = resolveToolRoot();
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  const currentText = readOptional(configPath);
  const rawConfig = currentText === null ? {} : parseJsoncText(currentText, configPath);
  const effective = loadUserConfig(repoRoot);
  const toolConfig = getToolingConfig(repoRoot, effective);
  const selectedTools = [...new Set(tools)].sort();
  const tooling = resolveToolsById(selectedTools, toolConfig.dir, repoRoot, toolConfig);
  const unknown = selectedTools.filter(id => !tooling.some(tool => tool.id === id));
  if (unknown.length) throw new Error('Unknown or disabled selected tools: ' + unknown.join(', '));
  const patch = {
    threads: 1,
    indexing: { concurrency: 1, ioConcurrencyCap: 1, workerPool: { enabled: false },
      embeddings: profile === 'sparse' ? { enabled: false, mode: 'off' } : { enabled: true, mode: 'auto', model },
      typeInference: profile === 'semantic' },
    search: { annDefault: profile === 'semantic' }
  };
  const candidate = mergeConfig(rawConfig, patch);
  const schema = readShippedConfigSchema(path.join(toolRoot, 'docs/config/schema.json'));
  const validation = validateConfig(schema, candidate);
  if (!validation.ok) throw new Error('Proposed setup config is invalid:\n' + validation.errors.join('\n'));
  const detected = await buildToolingReport(repoRoot, null, { skipToolDetection: true });
  const operations = [];
  if (profile === 'semantic') operations.push({ id: 'models', command: process.execPath,
    args: [path.join(toolRoot, 'tools/download/models.js'), '--repo', repoRoot, '--model', model],
    effects: ['download selected model into configured managed model location'], bytes: 'unknown' });
  if (selectedTools.length) operations.push({ id: 'tooling', command: process.execPath,
    args: [path.join(toolRoot, 'tools/tooling/install.js'), '--repo', repoRoot, '--tools', selectedTools.join(','), '--scope', 'cache', '--no-fallback'],
    effects: ['provision only selected tool requirements into owned locations'], bytes: 'unknown',
    recipes: tooling.map(tool => ({ id: tool.id, ...selectInstallPlan(tool, 'cache', false) })) });
  operations.push({ id: 'index', command: process.execPath,
    args: [path.join(toolRoot, 'build_index.js'), '--repo', repoRoot, '--mode', 'code', '--threads', '1', ...(backend === 'sqlite' ? [] : ['--no-sqlite'])],
    effects: ['build selected target code generation'], bytes: 'unknown' });
  if (backend === 'lmdb') operations.push({ id: 'lmdb', command: process.execPath,
    args: [path.join(toolRoot, 'tools/build/lmdb-index.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['build selected LMDB representation'], bytes: 'unknown' });
  operations.push({ id: 'validate', command: process.execPath,
    args: [path.join(toolRoot, 'tools/index/validate.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['read-only artifact validation'] });
  const plan = {
    schemaVersion: 1, kind: 'first-search-plan', applicationRoot: toolRoot, repoRoot,
    choices: { profile, model, backend, tools: selectedTools },
    configPath, configPatch: patch, languages: detected.languages,
    cacheRoot: resolveRepoCacheRootPath(repoRoot, effective),
    inputIdentity: { config: currentText === null ? null : hash(currentText), effective: hash(stableStringify(effective)),
      runtime: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
    operations, readiness: 'not-probed',
    commands: { validate: ['node', 'bin/pairofcleats.js', 'index', 'validate', '--repo', repoRoot, '--mode', 'code'],
      search: ['node', 'bin/pairofcleats.js', 'search', '--repo', repoRoot, '--mode', 'code', '--backend', backend, '--top', '5', '--', '<query from your project>'] },
    notes: ['No target dependency installation or trust change.', 'Unknown bytes are not an estimate.', 'Tool installation is distinct from protocol/project qualification.']
  };
  return { ...plan, planId: hash(stableStringify(plan)) };
};

/** Re-plan from supported choices, never execute commands supplied by a saved file. */
export const applyFirstSearchPlan = async (approved, { execute = runCommand, signal = null } = {}) => {
  const current = await createFirstSearchPlan({ repoRoot: approved.repoRoot, ...approved.choices });
  if (approved.schemaVersion !== 1 || current.planId !== approved.planId) throw Object.assign(new Error('Setup plan is stale or changed. Generate and review a new plan.'), { code: 'ERR_SETUP_PLAN_STALE' });
  const lock = `${current.configPath}.setup-lock`;
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  const outcome = { schemaVersion: 1, kind: 'setup-plan-result', planId: current.planId,
    repoRoot: current.repoRoot, completed: [], pending: current.operations.map(step => step.id), state: 'applying' };
  let temporary = null;
  try {
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, planId: current.planId }));
    const before = readOptional(current.configPath);
    if ((before === null ? null : hash(before)) !== current.inputIdentity.config) throw new Error('Target config changed before apply; re-plan.');
    let next = before || '{}\n';
    const patchLeaves = (value, prefix = []) => {
      for (const [key, entry] of Object.entries(value)) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) patchLeaves(entry, [...prefix, key]);
        else next = applyEdits(next, modify(next, [...prefix, key], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
      }
    };
    patchLeaves(current.configPatch);
    temporary = `${current.configPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
    if (before === null) {
      // Exclusive creation refuses a target introduced after planning.
      fs.copyFileSync(temporary, current.configPath, fs.constants.COPYFILE_EXCL);
    } else {
      if (hash(readOptional(current.configPath)) !== current.inputIdentity.config) throw new Error('Target config changed while staging; re-plan.');
      fs.renameSync(temporary, current.configPath);
      temporary = null;
    }
    outcome.completed.push('config');
    for (const step of current.operations) {
      if (signal?.aborted) { outcome.state = 'cancelled'; break; }
      const result = await execute(step.command, step.args, { cwd: current.applicationRoot, stdio: 'inherit', env: process.env });
      if (result.ok !== true) {
        outcome.state = 'blocked';
        outcome.failed = { id: step.id, status: result.status ?? null, signal: result.signal || null };
        break;
      }
      outcome.completed.push(step.id);
      outcome.pending.shift();
    }
    if (outcome.pending.length === 0) outcome.state = 'complete';
    return { ...outcome, commands: current.commands, qualification: 'Index validation completed only when listed; protocol/project/model inference readiness is not inferred.' };
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
    fs.closeSync(lockFd);
    fs.rmSync(lock, { force: true });
  }
};
