import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Create a serialized append writer backed by one reusable file descriptor.
 *
 * This is useful for high-frequency logging/trace streams where repeated
 * open/write/close cycles can create descriptor pressure.
 *
 * @param {{
 *   filePath:string,
 *   ensureDir?:boolean,
 *   syncOnFlush?:boolean,
 *   onError?:(stage:'open'|'write'|'flush'|'close',err:unknown)=>void
 * }} input
 * @returns {{enqueue:(text:string)=>Promise<void>,flush:()=>Promise<void>,close:()=>Promise<void>}}
 */
export const createQueuedAppendWriter = ({
  filePath,
  ensureDir = true,
  syncOnFlush = false,
  onError = null
} = {}) => {
  let handlePromise = null;
  let writeChain = Promise.resolve();
  let acceptingWrites = true;
  let closePromise = null;
  let closed = false;

  const reportError = (stage, err) => {
    if (typeof onError !== 'function') return;
    try {
      onError(stage, err);
    } catch {}
  };

  const ensureHandle = () => {
    if (closed || closePromise) return Promise.resolve(null);
    if (handlePromise) return handlePromise;
    handlePromise = (async () => {
      try {
        if (ensureDir) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
        }
        return await fs.open(filePath, 'a');
      } catch (err) {
        handlePromise = null;
        reportError('open', err);
        return null;
      }
    })();
    return handlePromise;
  };

  const enqueue = (text) => {
    if (!acceptingWrites || closed || closePromise || typeof text !== 'string' || text.length === 0) {
      return Promise.resolve();
    }
    writeChain = writeChain.then(async () => {
      if (closed || closePromise) return;
      const handle = await ensureHandle();
      if (!handle || closed) return;
      try {
        await handle.write(text);
      } catch (err) {
        reportError('write', err);
      }
    });
    return writeChain;
  };

  const flush = async () => {
    await writeChain;
    if (closed) return;
    if (closePromise) {
      await closePromise;
      return;
    }
    if (!syncOnFlush || !handlePromise) return;
    const handle = await handlePromise;
    if (!handle || closed) return;
    try {
      await handle.sync();
    } catch (err) {
      reportError('flush', err);
    }
  };

  const close = async () => {
    if (closePromise) return closePromise;
    acceptingWrites = false;
    closePromise = (async () => {
      await writeChain;
      const localHandlePromise = handlePromise;
      if (!localHandlePromise) {
        closed = true;
        handlePromise = null;
        return;
      }
      const handle = await localHandlePromise;
      if (!handle) {
        closed = true;
        handlePromise = null;
        return;
      }
      try {
        if (syncOnFlush) {
          try {
            await handle.sync();
          } catch (err) {
            reportError('flush', err);
          }
        }
        try {
          await handle.close();
        } catch (err) {
          reportError('close', err);
        }
      } finally {
        closed = true;
        handlePromise = null;
      }
    })();
    await closePromise;
  };

  return {
    enqueue,
    flush,
    close
  };
};
