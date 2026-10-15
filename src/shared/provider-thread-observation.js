import fs from 'node:fs';

/** Actual OS thread IDs/activity; ownership attribution is deliberately separate. */
export const observeProcessThreads = ({ platform = process.platform, io = fs } = {}) => {
  const base = { scope: 'process', providerAttribution: 'unknown', observedAt: new Date().toISOString(),
    method: platform === 'linux' ? 'proc-task-stat-native-thread-IDs-and-CPU-ticks' : 'unavailable-platform',
    clockTickSeconds: null, threads: [], count: null, truncated: false };
  if (platform !== 'linux') return base;
  try {
    const ids = io.readdirSync('/proc/self/task').filter(value => /^\d+$/u.test(value)).sort((a, b) => Number(a) - Number(b));
    const threads = [];
    for (const id of ids.slice(0, 256)) {
      try {
        const stat = io.readFileSync(`/proc/self/task/${id}/stat`, 'utf8');
        const end = stat.lastIndexOf(')');
        if (end < 0) continue;
        const fields = stat.slice(end + 1).trim().split(/\s+/u);
        const userTicks = Number(fields[11]), systemTicks = Number(fields[12]);
        if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) continue;
        threads.push({ id: Number(id), name: stat.slice(stat.indexOf('(') + 1, end),
          userTicks, systemTicks, totalTicks: userTicks + systemTicks });
      } catch { /* Threads may exit between inventory and reading their counters. */ }
    }
    return { ...base, count: ids.length, threads, truncated: ids.length > 256 };
  } catch (error) { return { ...base, method: 'unavailable-proc-task', errorCode: error.code || 'UNKNOWN' }; }
};
