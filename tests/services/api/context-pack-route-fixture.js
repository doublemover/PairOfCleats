import { createContextPackValidator } from '../../../tools/api/validation.js';
import { createResponseCapture } from './response-capture.js';

export const createMinimalContextPackPayload = (overrides = {}) => ({
  seed: 'chunk:ck64:v1:test:src/file.js:0000000000000001',
  hops: 0,
  includeGraph: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  ...overrides
});

export const createContextPackRouteFixture = (payload = createMinimalContextPackPayload()) => {
  const { capture, response } = createResponseCapture();
  const resolveRepoCalls = [];
  return {
    capture,
    response,
    payload,
    resolveRepoCalls,
    parseJsonBody: async () => payload,
    validateContextPackPayload: createContextPackValidator()
  };
};

export const readCapturedJson = (capture) => JSON.parse(String(capture?.body || '{}'));
