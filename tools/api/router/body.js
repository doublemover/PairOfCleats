export const createBodyParser = ({ maxBodyBytes }) => {
  /**
   * Parse a JSON request body.
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<Buffer>}
   */
  const parseBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (maxBodyBytes && total > maxBodyBytes) {
        const err = new Error('Request body too large.');
        err.code = 'ERR_BODY_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('aborted', () => reject(new Error('Request aborted.')));
    req.on('end', () => resolve(Buffer.concat(chunks, total)));
    req.on('error', reject);
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
