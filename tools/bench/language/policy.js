import { sha1 } from '../../../src/shared/hash.js';
import { PROGRESS_TIMEOUT_POLICY_VERSION } from '../../../src/shared/indexing/progress-timeout-policy.js';

export const BENCH_METHODOLOGY_SCHEMA_VERSION = 1;
export const BENCH_METHODOLOGY_POLICY_VERSION = 'bench-language-methodology-v1';
const DEFAULT_CONTROL_SLICE_MAX_TASKS = 12;
const CONTROL_SLICE_TIER_ORDER = Object.freeze([
  'small',
  'medium',
  'large',
  'xlarge'
]);

const toText = (value) => String(value == null ? '' : value).trim();

export const resolveBenchMode = (value) => {
  const normalized = toText(value).toLowerCase();
  if (normalized === 'cold') return 'cold';
  if (normalized === 'reliability') return 'reliability';
  if (normalized === 'tooling') return 'tooling';
  return 'warm';
};

export const resolveBenchModePolicy = (mode) => {
  const normalizedMode = resolveBenchMode(mode);
  switch (normalizedMode) {
    case 'cold':
      return {
        mode: normalizedMode,
        cacheMode: 'cold',
        toolingMode: 'disabled',
        scoreIncludesTooling: false
      };
    case 'tooling':
      return {
        mode: normalizedMode,
        cacheMode: 'warm',
        toolingMode: 'included',
        scoreIncludesTooling: true
      };
    case 'reliability':
      return {
        mode: normalizedMode,
        cacheMode: 'warm',
        toolingMode: 'disabled',
        scoreIncludesTooling: false
      };
    default:
      return {
        mode: 'warm',
        cacheMode: 'warm',
        toolingMode: 'disabled',
        scoreIncludesTooling: false
      };
  }
};

const buildTaskId = (task) => [
  toText(task?.language) || 'unknown',
  toText(task?.tier) || 'unknown',
  toText(task?.repo) || 'unknown'
].join(':');

const compareTasks = (left, right) => (
  toText(left?.language).localeCompare(toText(right?.language))
  || CONTROL_SLICE_TIER_ORDER.indexOf(toText(left?.tier).toLowerCase()) - CONTROL_SLICE_TIER_ORDER.indexOf(toText(right?.tier).toLowerCase())
  || toText(left?.tier).localeCompare(toText(right?.tier))
  || toText(left?.repo).localeCompare(toText(right?.repo))
);

export const selectBenchControlSlice = (tasks, { maxTasks = DEFAULT_CONTROL_SLICE_MAX_TASKS } = {}) => {
  const ordered = (Array.isArray(tasks) ? tasks.slice() : []).sort(compareTasks);
  const cap = Number.isFinite(Number(maxTasks))
    ? Math.max(1, Math.floor(Number(maxTasks)))
    : DEFAULT_CONTROL_SLICE_MAX_TASKS;
  const selected = [];
  const selectedIds = new Set();
  const byLanguage = new Map();
  for (const task of ordered) {
    const language = toText(task?.language) || 'unknown';
    if (!byLanguage.has(language)) byLanguage.set(language, []);
    byLanguage.get(language).push(task);
  }
  for (const language of Array.from(byLanguage.keys()).sort((left, right) => left.localeCompare(right))) {
    const entries = byLanguage.get(language) || [];
    for (const tier of CONTROL_SLICE_TIER_ORDER) {
      const match = entries.find((task) => toText(task?.tier).toLowerCase() === tier);
      if (!match) continue;
      const taskId = buildTaskId(match);
      if (selectedIds.has(taskId)) continue;
      selected.push(match);
      selectedIds.add(taskId);
      if (selected.length >= cap) {
        return {
          maxTasks: cap,
          tasks: selected.slice(),
          taskIds: selected.map((task) => buildTaskId(task))
        };
      }
    }
  }
  for (const task of ordered) {
    const taskId = buildTaskId(task);
    if (selectedIds.has(taskId)) continue;
    selected.push(task);
    selectedIds.add(taskId);
    if (selected.length >= cap) break;
  }
  return {
    maxTasks: cap,
    tasks: selected,
    taskIds: selected.map((task) => buildTaskId(task))
  };
};

export const createBenchMethodologyPolicy = ({
  argv = {},
  tasks = [],
  configPath = null,
  waiverFile = null,
  corpusVersion = null
} = {}) => {
  const modePolicy = resolveBenchModePolicy(argv?.mode);
  const selectedCorpusVersion = toText(corpusVersion)
    || `repos-${sha1(JSON.stringify((Array.isArray(tasks) ? tasks : []).map((task) => buildTaskId(task))))}`;
  const controlSlice = selectBenchControlSlice(tasks, {
    maxTasks: Number(argv?.['control-slice-max']) || DEFAULT_CONTROL_SLICE_MAX_TASKS
  });
  const repoOrder = (Array.isArray(tasks) ? tasks : []).map((task) => buildTaskId(task));
  return {
    schemaVersion: BENCH_METHODOLOGY_SCHEMA_VERSION,
    policyVersion: BENCH_METHODOLOGY_POLICY_VERSION,
    mode: modePolicy.mode,
    corpusVersion: selectedCorpusVersion,
    configPath: toText(configPath) || null,
    repoOrder,
    cacheMode: modePolicy.cacheMode,
    toolingMode: modePolicy.toolingMode,
    scoreIncludesTooling: modePolicy.scoreIncludesTooling,
    timeoutPolicyVersion: PROGRESS_TIMEOUT_POLICY_VERSION,
    waiverFile: toText(waiverFile) || null,
    passFailThresholds: {
      maxFailedRepos: 0,
      maxRetainedCrashBundles: 0,
      maxUnwaivedIssues: 0
    },
    controlSlice: {
      maxTasks: controlSlice.maxTasks,
      taskIds: controlSlice.taskIds
    }
  };
};

export const filterTasksToControlSlice = (tasks, methodology) => {
  const taskIdSet = new Set(
    Array.isArray(methodology?.controlSlice?.taskIds)
      ? methodology.controlSlice.taskIds
      : []
  );
  if (!taskIdSet.size) return Array.isArray(tasks) ? tasks.slice() : [];
  return (Array.isArray(tasks) ? tasks : []).filter((task) => taskIdSet.has(buildTaskId(task)));
};

export const buildBenchMetricTags = (methodology) => {
  if (!methodology || typeof methodology !== 'object') return null;
  return {
    mode: methodology.mode || null,
    cacheMode: methodology.cacheMode || null,
    toolingMode: methodology.toolingMode || null,
    corpusVersion: methodology.corpusVersion || null,
    policyVersion: methodology.policyVersion || null
  };
};

export const buildBenchMethodologyTaskId = buildTaskId;
