#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startMapViewerStaticServer } from '../../tools/bench/map/shared.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-map-bench-dir-request-'));
const outPath = path.join(tempRoot, 'bench.html');
await fsPromises.writeFile(outPath, '<!doctype html><title>bench</title>\n', 'utf8');

const requestStatus = async (targetUrl) => new Promise((resolve, reject) => {
  const req = http.get(targetUrl, (res) => {
    const statusCode = Number(res.statusCode || 0);
    res.resume();
    res.once('end', () => resolve(statusCode));
  });
  req.once('error', reject);
});

let server = null;
try {
  const started = await startMapViewerStaticServer({ outPath, port: 0 });
  server = started.server;

  const directoryTarget = new URL('/three/', started.url).toString();
  const directoryStatus = await requestStatus(directoryTarget);
  assert.equal(directoryStatus, 404, 'expected directory path request to be rejected');

  const htmlStatus = await requestStatus(started.url);
  assert.equal(htmlStatus, 200, 'server should remain healthy after directory request');
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('map bench directory request safety test passed');
