import { formatRate, formatSecondsPerUnit, resolveRateUnit, titleCaseUnit } from './text.js';

const LINE_PREFIX_TRANSPARENT = ' ';
const LINE_PREFIX_SHADED = ' ';

export { LINE_PREFIX_TRANSPARENT, LINE_PREFIX_SHADED };

export const resolveBarVariant = (task) => {
  const name = String(task?.name || '').toLowerCase();
  const stage = String(task?.stage || '').toLowerCase();
  if (stage === 'overall' || name === 'overall') return 'overall';
  if (name === 'stage') return 'stage';
  if (name === 'repos' || stage === 'bench') return 'repos';
  if (name === 'queries' || stage === 'queries' || stage === 'query') return 'queries';
  if (name === 'files') return 'files';
  if (name === 'shard') return 'shard';
  if (name === 'imports') return 'imports';
  if (name === 'artifacts') return 'artifacts';
  if (name === 'records') return 'records';
  if (name === 'downloads') return 'downloads';
  if (name === 'embeddings' || stage === 'embeddings') return 'embeddings';
  if (name === 'ci' || stage === 'ci') return 'ci';
  return 'default';
};

const clampRatio = (value) => Math.min(1, Math.max(0, value));

const progressRatio = (task) => {
  if (!task || !Number.isFinite(task.total) || task.total <= 0) return 0;
  const current = Number.isFinite(task.current) ? task.current : 0;
  return clampRatio(current / task.total);
};

export const computeOverallProgress = ({ overallTask, tasksByMode }) => {
  if (!overallTask || !Number.isFinite(overallTask.total) || overallTask.total <= 0) return null;
  let computed = 0;
  for (const [mode, stageTask] of tasksByMode.stage) {
    if (!stageTask || !Number.isFinite(stageTask.total) || stageTask.total <= 0) continue;
    const stageTotal = stageTask.total;
    if (stageTask.status === 'done') {
      computed += stageTotal;
      continue;
    }
    const stageIndex = Number.isFinite(stageTask.current) ? stageTask.current : 0;
    const completed = Math.max(0, Math.min(stageTotal, stageIndex - 1));
    const stageId = String(stageTask.stage || '').toLowerCase();
    let fraction = 0;
    if (stageId === 'imports') {
      fraction = progressRatio(tasksByMode.imports.get(mode));
    } else if (stageId === 'processing') {
      const filesFraction = progressRatio(tasksByMode.files.get(mode));
      const shardFraction = progressRatio(tasksByMode.shard.get(mode));
      fraction = Math.max(filesFraction, shardFraction);
    } else if (stageId === 'write') {
      fraction = progressRatio(tasksByMode.artifacts.get(mode));
    }
    computed += completed + fraction;
  }
  const overallCurrent = Number.isFinite(overallTask.current) ? overallTask.current : 0;
  const effective = Math.max(computed, overallCurrent);
  return clampRatio(effective / overallTask.total);
};

export const buildProgressExtras = (task, now) => {
  if (!task || !Number.isFinite(task.current)) return null;
  const endAt = (task.status === 'done' || task.status === 'failed')
    ? (Number.isFinite(task.endedAt) ? task.endedAt : now)
    : now;
  const elapsedMs = Number.isFinite(task.startedAt) ? Math.max(0, endAt - task.startedAt) : 0;
  if (!elapsedMs) return null;
  const current = Math.max(0, task.current);
  const elapsedSec = elapsedMs / 1000;
  const rate = current > 0 ? current / elapsedSec : 0;
  const unit = resolveRateUnit(task);
  let rateText = null;
  if (rate > 0 && unit) {
    if (rate >= 1) {
      const rateValue = formatRate(rate);
      if (rateValue) rateText = `${rateValue} ${titleCaseUnit(unit)}/s`;
    } else {
      const perUnit = formatSecondsPerUnit(1 / rate, unit);
      if (perUnit) rateText = perUnit;
    }
  }
  let etaSec = null;
  if (task.status === 'running'
    && Number.isFinite(task.total)
    && task.total > 0
    && rate > 0
    && current > 0) {
    const remaining = Math.max(0, task.total - current);
    etaSec = remaining / rate;
  }
  if (!rateText && !etaSec && !elapsedSec) return null;
  return { rateText, etaSec, elapsedSec, rawRate: rate };
};
