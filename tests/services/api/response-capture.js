export const createResponseCapture = () => {
  const capture = {
    statusCode: null,
    headers: null,
    body: null
  };
  return {
    capture,
    response: Object.assign(new EventEmitter(), {
      writeHead(statusCode, headers) {
        capture.statusCode = statusCode;
        capture.headers = headers;
      },
      end(body) {
        capture.body = body;
        this.writableEnded = true;
      }
    })
  };
};

export const createMockResponse = () => {
  const state = {
    statusCode: 0,
    headers: {},
    body: ''
  };
  return {
    res: Object.assign(new EventEmitter(), {
      writeHead(statusCode, headers) {
        state.statusCode = Number(statusCode) || 0;
        state.headers = headers || {};
      },
      end(chunk = '') {
        state.body += String(chunk || '');
        this.writableEnded = true;
      }
    }),
    get statusCode() {
      return state.statusCode;
    },
    get json() {
      return state.body ? JSON.parse(state.body) : null;
    }
  };
};

export const invokeRouteWithMockResponse = async (routeHandler, {
  method = 'GET',
  requestUrl,
  pathname,
  corsHeaders = {},
  req = {},
  ...routeOptions
}) => {
  const response = createMockResponse();
  const handled = await routeHandler({
    req: Object.assign(new EventEmitter(), { method }, req),
    res: response.res,
    requestUrl,
    pathname,
    corsHeaders,
    ...routeOptions
  });
  return { handled, response };
};
import { EventEmitter } from 'node:events';
