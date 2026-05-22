import { writeProgressEvent } from '../progress-events.js';

export const writeDisplayLogEvent = (stream, contextPatch, level, message, meta) => {
  writeProgressEvent(stream, 'log', {
    ...contextPatch,
    level,
    message,
    meta: meta && typeof meta === 'object' ? meta : null
  });
};

export const writeDisplayTaskEvent = (stream, contextPatch, event, task, extra = {}) => {
  writeProgressEvent(stream, event, {
    ...contextPatch,
    taskId: task.id,
    name: task.name,
    current: task.current,
    total: task.total,
    unit: task.unit || null,
    stage: task.stage || null,
    mode: task.mode || null,
    status: task.status || null,
    message: task.message || null,
    ...extra
  });
};
