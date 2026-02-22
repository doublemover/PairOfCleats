export const createBodyParser = ({ maxBodyBytes }) => {
  /**
   * Parse a JSON request body.
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<Buffer>}
  */
  const parseBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('aborted', onAborted);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const fail = (err, { terminateStream = false } = {}) => {
      if (done) return;
      done = true;
      cleanup();
      if (terminateStream && typeof req.destroy === 'function' && !req.destroyed) {
        // Close oversized streams promptly so clients cannot continue pushing
        // bytes after the server has rejected the request.
        setImmediate(() => {
          if (!req.destroyed) req.destroy(err);
        });
      }
      reject(err);
    };
    const onData = (chunk) => {
      if (done) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (maxBodyBytes && total > maxBodyBytes) {
        const err = new Error('Request body too large.');
        err.code = 'ERR_BODY_TOO_LARGE';
        err.terminateStream = true;
        fail(err, { terminateStream: true });
        return;
      }
      chunks.push(buffer);
    };
    const onAborted = () => {
      fail(new Error('Request aborted.'));
    };
    const onEnd = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(Buffer.concat(chunks, total));
    };
    const onError = (err) => {
      fail(err);
    };
    req.on('data', onData);
    req.on('aborted', onAborted);
    req.on('end', onEnd);
    req.on('error', onError);
  });

  const parseJsonBody = async (req) => {
    const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const err = new Error('Content-Type must be application/json.');
      err.code = 'ERR_UNSUPPORTED_MEDIA_TYPE';
      throw err;
    }
    const buffer = await parseBody(req);
    if (!buffer?.length) return null;
    return JSON.parse(buffer.toString('utf8'));
  };

  return { parseJsonBody };
};
