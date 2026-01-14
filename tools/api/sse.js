/**
 * Write SSE headers for streaming responses.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export const createSseResponder = (req, res) => {
  let closed = false;
  const markClosed = () => {
    closed = true;
  };
  req.on('aborted', markClosed);
  res.on('close', markClosed);
  res.on('finish', markClosed);
  res.on('error', markClosed);
  const writeChunk = async (chunk) => {
    if (closed || res.writableEnded || res.destroyed) return false;
    if (!res.write(chunk)) {
      await new Promise((resolve) => res.once('drain', resolve));
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
        'Access-Control-Allow-Origin': '*'
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
