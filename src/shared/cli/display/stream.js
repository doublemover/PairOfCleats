import { isClosedStreamWriteError } from '../../jsonrpc.js';

export const createSafeWritableStream = (target) => {
  if (!target || typeof target.write !== 'function') {
    return {
      stream: target,
      isWritable: () => false,
      close: () => {}
    };
  }
  let closed = false;
  const markClosed = () => { closed = true; };
  const isStreamWritable = () => !closed && target && !target.destroyed && !target.writableEnded;
  const safeWrite = (...args) => {
    if (!isStreamWritable()) {
      markClosed();
      return false;
    }
    try {
      return target.write.apply(target, args);
    } catch (err) {
      if (isClosedStreamWriteError(err)) {
        markClosed();
        return false;
      }
      throw err;
    }
  };
  const handleError = (err) => {
    if (isClosedStreamWriteError(err)) {
      markClosed();
    }
  };
  const removeListener = typeof target.off === 'function'
    ? (event, handler) => target.off(event, handler)
    : (typeof target.removeListener === 'function'
      ? (event, handler) => target.removeListener(event, handler)
      : null);
  if (typeof target.on === 'function') {
    target.on('close', markClosed);
    target.on('finish', markClosed);
    target.on('error', handleError);
  }
  const proxyHandler = {
    get(obj, prop, receiver) {
      if (prop === 'write') return safeWrite;
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    }
  };
  const close = () => {
    markClosed();
    if (!removeListener) return;
    removeListener('close', markClosed);
    removeListener('finish', markClosed);
    removeListener('error', handleError);
  };
  return {
    stream: new Proxy(target, proxyHandler),
    isWritable: isStreamWritable,
    close
  };
};
