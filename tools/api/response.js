import fs from 'node:fs';

/**
 * Write a JSON payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {any} payload
 */
export const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
};

/**
 * Write a plain text payload to the HTTP response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string|number|boolean|null|undefined} body
 * @param {Record<string,string>} [headers]
 */
export const sendText = (res, statusCode, body, headers = {}) => {
  const payload = body == null ? '' : String(body);
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    ...headers
  });
  res.end(payload);
};

/**
 * Write a Buffer payload to the HTTP response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {Buffer|Uint8Array|string|null|undefined} data
 * @param {Record<string,string>} [headers]
 */
export const sendBuffer = (res, statusCode, data, headers = {}) => {
  const payload = Buffer.isBuffer(data)
    ? data
    : (data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data == null ? '' : data));
  res.writeHead(statusCode, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': payload.length,
    'Access-Control-Allow-Origin': '*',
    ...headers
  });
  res.end(payload);
};

/**
 * Stream a file to the HTTP response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 * @param {{statusCode?:number,headers?:Record<string,string>,contentType?:string}|null} [options]
 */
export const sendFile = (res, filePath, options = null) => {
  const statusCode = Number.isFinite(Number(options?.statusCode)) ? Number(options.statusCode) : 200;
  const headers = options?.headers && typeof options.headers === 'object' ? options.headers : {};
  const contentType = typeof options?.contentType === 'string' ? options.contentType : null;

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendText(res, 404, 'Not found.');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not found.');
    return;
  }

  res.writeHead(statusCode, {
    ...(contentType ? { 'Content-Type': contentType } : { 'Content-Type': 'application/octet-stream' }),
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
    ...headers
  });

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      sendText(res, 500, err?.message || 'Failed to read file.');
      return;
    }
    res.destroy(err);
  });
  stream.pipe(res);
};

/**
 * Write an error payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 */
export const sendError = (res, statusCode, code, message, details = {}) => {
  const { code: ignored, ...rest } = details || {};
  sendJson(res, statusCode, { ok: false, code, message, ...rest });
};
