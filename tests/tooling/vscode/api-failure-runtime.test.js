#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requestApiJson } = require('../../../extensions/vscode/runtime.js');

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async text() {
      return JSON.stringify({ message: 'token expired' });
    }
  });
  const unauthorized = await requestApiJson('http://127.0.0.1:4311', '/search', {
    method: 'POST',
    payload: { query: 'AuthToken' },
    label: 'PairOfCleats search'
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.kind, 'api-unauthorized');
  assert.match(unauthorized.message, /unauthorized/i);
  assert.match(unauthorized.detail || '', /token expired/i);

  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async text() {
      return JSON.stringify({ message: 'workspace denied' });
    }
  });
  const forbidden = await requestApiJson('http://127.0.0.1:4311', '/search', {
    method: 'POST',
    payload: { query: 'AuthToken' },
    label: 'PairOfCleats search'
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.kind, 'api-forbidden');
  assert.match(forbidden.message, /forbidden/i);
  assert.match(forbidden.detail || '', /workspace denied/i);

  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return 'upstream blew up';
    }
  });
  const httpError = await requestApiJson('http://127.0.0.1:4311', '/search', {
    method: 'POST',
    payload: { query: 'AuthToken' },
    label: 'PairOfCleats search'
  });
  assert.equal(httpError.ok, false);
  assert.equal(httpError.kind, 'api-http-error');
  assert.match(httpError.message, /HTTP 500/i);
  assert.match(httpError.detail || '', /upstream blew up/i);

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '{"broken"';
    }
  });
  const invalidJson = await requestApiJson('http://127.0.0.1:4311', '/search', {
    method: 'POST',
    payload: { query: 'AuthToken' },
    label: 'PairOfCleats search'
  });
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.kind, 'api-invalid-json');
  assert.match(invalidJson.message, /invalid json/i);

  globalThis.fetch = async () => {
    const error = new Error('socket hang up');
    throw error;
  };
  const requestError = await requestApiJson('http://127.0.0.1:4311', '/search', {
    method: 'POST',
    payload: { query: 'AuthToken' },
    label: 'PairOfCleats search'
  });
  assert.equal(requestError.ok, false);
  assert.equal(requestError.kind, 'api-request-error');
  assert.match(requestError.message, /socket hang up/i);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('vscode api failure runtime test passed');
