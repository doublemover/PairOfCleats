/** Bound queued transport frames while retaining whole logical events. A partly
 * sent chunk group is pinned until completion; pressure never removes fragments
 * from an already visible group or terminal state to admit ordinary progress. */
export const createProtocolQueue = ({ flow, write, onLifecycleLoss }) => {
  const units = [];
  let frames = 0;
  const taskKey = entry => entry.taskId == null ? null : JSON.stringify([entry.runId, entry.jobId, entry.taskId]);
  const remove = (index, coalesced = false) => {
    const [unit] = units.splice(index, 1);
    const count = unit.frames.length - unit.index;
    frames -= count;
    flow[coalesced ? 'coalesced' : 'dropped'] += count;
  };
  const discard = unit => {
    flow.dropped += unit.frames.length;
    if (unit.event === 'task:start' || unit.event === 'task:end') {
      flow.lifecycleDropped += 1;
      onLifecycleLoss();
    }
    return false;
  };
  const admit = (entry, entries) => {
    const unit = { event: entry.event, key: taskKey(entry), frames: entries, index: 0 };
    if (entries.length > flow.queueMax) return discard(unit);
    if (unit.key && ['task:progress', 'task:end'].includes(unit.event)) {
      for (let index = units.length - 1; index >= 0; index--) {
        const previous = units[index];
        if (previous.key !== unit.key) continue;
        if (previous.event === 'task:end' || previous.event === 'task:start') {
          if (previous.event === 'task:end' && unit.event === 'task:progress') return discard(unit);
          break;
        }
        if (previous.event === 'task:progress' && previous.index === 0) remove(index, true);
      }
    }
    while (frames + entries.length > flow.queueMax) {
      let victim = units.findIndex(value => value.index === 0 && value.event === 'log');
      if (victim < 0 && unit.event !== 'log') victim = units.findIndex(value => value.index === 0 && value.event === 'task:progress');
      if (victim < 0) return discard(unit);
      remove(victim);
    }
    units.push(unit); frames += entries.length;
    return true;
  };
  const drain = () => {
    while (flow.credits > 0 && units.length) {
      const unit = units[0];
      write(unit.frames[unit.index++]);
      flow.credits--; frames--;
      if (unit.index === unit.frames.length) units.shift();
    }
  };
  return { admit, drain, depth: () => frames };
};
