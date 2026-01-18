/**
 * Write a JSON payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {any} payload
 * @param {object} [headers]
 */
export const sendJson = (res, statusCode, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
};

/**
 * Write an error payload to the HTTP response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @param {object} [headers]
 */
export const sendError = (res, statusCode, code, message, details = {}, headers = {}) => {
  const { code: ignored, ...rest } = details || {};
  sendJson(res, statusCode, { ok: false, code, message, ...rest }, headers);
};
