import { createProgressLineDecoder } from '../../../src/shared/cli/progress-stream.js';
import { PROGRESS_EVENT_DROP_FIELDS } from './constants.js';

/**
 * Strip transport-level keys before re-emitting decoded progress payloads.
 *
 * @param {object} event
 * @returns {object}
 */
const extractRoutedProgressPayload = (event) => {
  const payload = {};
  if (!event || typeof event !== 'object') return payload;
  for (const [key, value] of Object.entries(event)) {
    if (PROGRESS_EVENT_DROP_FIELDS.has(key)) continue;
    payload[key] = value;
  }
  return payload;
};

/**
 * Re-emit decoded progress frame into supervisor protocol stream.
 *
 * @param {{jobId:string,stream:string,event:object,emit:(event:string,payload?:object,options?:object)=>void}} input
 * @returns {void}
 */
const routeDecodedProgressEvent = ({ jobId, stream, event, emit }) => {
  const payload = extractRoutedProgressPayload(event);
  if (typeof payload.stream !== 'string') {
    payload.stream = stream;
  }
  emit(event?.event, payload, { jobId });
};

/**
 * Emit warning when stream decoder drops oversized frame content.
 *
 * @param {{jobId:string,stream:string,overflowBytes:number,emitLog:(jobId:string,level:'warn',message:string,extra?:object)=>void}} input
 * @returns {void}
 */
const emitDecoderOverflowLog = ({ jobId, stream, overflowBytes, emitLog }) => {
  emitLog(jobId, 'warn', `${stream} decoder overflow (${overflowBytes} bytes truncated).`, { stream });
};

/**
 * Build a strict line decoder that routes protocol frames and plain logs.
 *
 * @param {{
 *  job:object,
 *  jobId:string,
 *  stream:'stdout'|'stderr',
 *  maxLineBytes:number,
 *  markActivity:()=>void,
 *  emit:(event:string,payload?:object,options?:object)=>void,
 *  emitLog:(jobId:string,level:'info'|'warn'|'error',message:string,extra?:object)=>void
 * }} input
 * @returns {ReturnType<typeof createProgressLineDecoder>}
 */
export const createJobStreamDecoder = ({ job, jobId, stream, maxLineBytes, markActivity, emit, emitLog }) => (
  createProgressLineDecoder({
    strict: true,
    maxLineBytes,
    onLine: ({ line, event }) => {
      markActivity();
      if (event) {
        routeDecodedProgressEvent({ jobId, stream, event, emit });
        return;
      }
      if (line.trim()) {
        emitLog(jobId, 'info', line, { stream, pid: job.pid || null });
      }
    },
    onOverflow: ({ overflowBytes }) => {
      markActivity();
      emitDecoderOverflowLog({ jobId, stream, overflowBytes, emitLog });
    }
  })
);
