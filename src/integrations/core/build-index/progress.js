import { showProgress } from '../../../shared/progress.js';

export const createOverallProgress = ({ modes, buildId, includeEmbeddings = false, includeSqlite = false }) => {
  const stageCounts = {
    code: 6,
    prose: 6,
    'extracted-prose': 6,
    records: 1
  };
  const extraStages = (includeEmbeddings ? 1 : 0) + (includeSqlite ? 1 : 0);
  const total = modes.reduce((sum, mode) => {
    const base = stageCounts[mode] || 0;
    if (!base) return sum;
    return sum + base + extraStages;
  }, 0);
  if (!total) return null;
  const taskId = `overall:${buildId || 'build'}`;
  let current = 0;
  showProgress('Overall', current, total, { taskId, stage: 'overall' });
  return {
    total,
    advance(meta = {}) {
      if (current >= total) return;
      current += 1;
      showProgress('Overall', current, total, {
        taskId,
        stage: 'overall',
        message: meta.message || null
      });
    },
    finish(meta = {}) {
      current = total;
      showProgress('Overall', current, total, {
        taskId,
        stage: 'overall',
        message: meta.message || null
      });
    }
  };
};
