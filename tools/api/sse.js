/**
 * Write SSE headers for streaming responses.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{headers?:object}} [options]
 */
export const createSseResponder = (req, res, options = {}) => {
  let closed = false;
  const extraHeaders = options.headers || {};
  const markClosed = () => {
    closed = true;
  };
  req.on('aborted', markClosed);
  res.on('close', markClosed);
  res.on('finish', markClosed);
  res.on('error', markClosed);
  const waitForDrainOrClose = () => new Promise((resolve) => {
    const onDone = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('finish', onClose);
      res.off('error', onClose);
      req.off('aborted', onClose);
      resolve();
    };
    const onDrain = () => onDone();
    const onClose = () => onDone();
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('finish', onClose);
    res.once('error', onClose);
    req.once('aborted', onClose);
  });
  const writeChunk = async (chunk) => {
    if (closed || res.writableEnded || res.destroyed) return false;
    if (!res.write(chunk)) {
      await waitForDrainOrClose();
      if (closed || res.writableEnded || res.destroyed) return false;
    }
    return true;
  };
  return {
    sendHeaders() {
      if (closed || res.headersSent) return false;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...extraHeaders
      });
      return writeChunk('\n');
    },
    async sendEvent(event, payload) {
      if (closed || res.writableEnded || res.destroyed) return false;
      const ok = await writeChunk(`event: ${event}\n`);
      if (!ok) return false;
      return writeChunk(`data: ${JSON.stringify(payload)}\n\n`);
    },
    end() {
      if (closed || res.writableEnded || res.destroyed) return;
      res.end();
      closed = true;
    },
    isClosed() {
      return closed || res.writableEnded || res.destroyed;
    }
  };
};
