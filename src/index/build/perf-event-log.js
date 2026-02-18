import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_FLUSH_ROWS = 128;
const DEFAULT_FLUSH_BYTES = 256 * 1024;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

/**
 * Create a buffered JSONL perf event logger.
 *
 * Events are written to disk only and never mirrored to console output.
 *
 * @param {{
 *   buildRoot?:string|null,
 *   mode?:string|null,
 *   stream?:string|null,
 *   enabled?:boolean,
 *   flushRows?:number,
 *   flushBytes?:number
 * }} [options]
 * @returns {Promise<{
 *   enabled:boolean,
 *   path:string|null,
 *   emit:(event:string,payload?:object)=>void,
 *   flush:()=>Promise<void>,
 *   close:()=>Promise<void>
 * }>}
 */
export const createPerfEventLogger = async ({
  buildRoot = null,
  mode = null,
  stream = 'events',
  enabled = true,
  flushRows = DEFAULT_FLUSH_ROWS,
  flushBytes = DEFAULT_FLUSH_BYTES
} = {}) => {
  if (!enabled || !buildRoot) {
    return {
      enabled: false,
      path: null,
      emit: () => {},
      flush: async () => {},
      close: async () => {}
    };
  }

  const resolvedFlushRows = toPositiveInt(flushRows, DEFAULT_FLUSH_ROWS);
  const resolvedFlushBytes = toPositiveInt(flushBytes, DEFAULT_FLUSH_BYTES);
  const perfDir = path.join(buildRoot, 'perf');
  const modeLabel = typeof mode === 'string' && mode.trim() ? mode.trim().toLowerCase() : 'all';
  const streamLabel = typeof stream === 'string' && stream.trim() ? stream.trim().toLowerCase() : 'events';
  const filePath = path.join(perfDir, `${streamLabel}.${modeLabel}.jsonl`);

  try {
    await fs.mkdir(perfDir, { recursive: true });
    await fs.appendFile(filePath, '');
  } catch {
    return {
      enabled: false,
      path: null,
      emit: () => {},
      flush: async () => {},
      close: async () => {}
    };
  }

  let buffer = [];
  let bufferedBytes = 0;
  let writeChain = Promise.resolve();

  const flush = async () => {
    if (!buffer.length) return writeChain;
    const payload = buffer.join('');
    buffer = [];
    bufferedBytes = 0;
    writeChain = writeChain.then(async () => {
      try {
        await fs.appendFile(filePath, payload, 'utf8');
      } catch {}
    });
    return writeChain;
  };

  const emit = (event, payload = {}) => {
    if (!event) return;
    const encoded = safeStringify({
      ts: new Date().toISOString(),
      event,
      ...((payload && typeof payload === 'object') ? payload : {})
    });
    if (!encoded) return;
    const line = `${encoded}\n`;
    buffer.push(line);
    bufferedBytes += Buffer.byteLength(line, 'utf8');
    if (buffer.length >= resolvedFlushRows || bufferedBytes >= resolvedFlushBytes) {
      void flush();
    }
  };

  const close = async () => {
    await flush();
    await writeChain;
  };

  return {
    enabled: true,
    path: filePath,
    emit,
    flush,
    close
  };
};
