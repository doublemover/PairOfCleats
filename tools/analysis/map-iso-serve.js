#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { spawnSubprocessSync } from '../../src/shared/subprocess/runner.js';
import { createCli } from '../../src/shared/cli.js';
import selfsigned from 'selfsigned';
import { bootstrapRuntime, resolveToolRoot } from '../shared/dict-utils.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { resolveMapViewerAsset } from './map-viewer-assets.js';
import { decodePathnameSafe } from './map-iso-safe-join.js';
import { serveMapIsoStaticFileOr404 } from './map-iso-static.js';

const argv = createCli({
  scriptName: 'map-iso',
  options: {
    repo: { type: 'string', describe: 'Repo root.' },
    dir: { type: 'string', describe: 'Alias for --repo.' },
    out: { type: 'string', describe: 'Output HTML path.' },
    port: { type: 'number', default: 0, describe: 'HTTPS port (0 for random).' },
    'open-uri-template': { type: 'string', describe: 'URI template for double-click.' },
    'three-url': { type: 'string', describe: 'Override three.js module URL.' },
    'cert-dir': { type: 'string', describe: 'Directory for TLS key/cert.' },
    open: { type: 'boolean', default: true, describe: 'Open browser.' }
  }
}).parse();

const toolRoot = resolveToolRoot();
const repoArg = argv.repo || argv.dir || null;
const { repoRoot, runtimeEnv } = bootstrapRuntime(repoArg);
const mapsDir = path.join(repoRoot, '.pairofcleats', 'maps');
const outPath = argv.out ? path.resolve(argv.out) : path.join(mapsDir, 'map.iso.html');
const threeUrl = argv['three-url'] || '/three/three.module.js';
const certDir = argv['cert-dir'] ? path.resolve(argv['cert-dir']) : path.join(mapsDir, '.certs');
const port = Number.isFinite(argv.port) ? argv.port : 0;

const ensureDir = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const ensureCert = async (targetDir) => {
  ensureDir(targetDir);
  const keyPath = path.join(targetDir, 'localhost.key');
  const certPath = path.join(targetDir, 'localhost.crt');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = await selfsigned.generate(attrs, { days: 30, keySize: 2048 });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
};

const runReport = () => {
  ensureDir(path.dirname(outPath));
  const args = [
    path.join(toolRoot, 'tools', 'reports/report-code-map.js'),
    '--repo', repoRoot,
    '--format', 'html-iso',
    '--out', outPath,
    '--three-url', threeUrl
  ];
  if (argv['open-uri-template']) {
    args.push('--open-uri-template', argv['open-uri-template']);
  }
  const result = spawnSubprocessSync(process.execPath, args, {
    cwd: toolRoot,
    stdio: 'inherit',
    rejectOnNonZeroExit: false,
    env: runtimeEnv
  });
  if (result.exitCode !== 0) {
    exitLikeCommandResult({ status: result.exitCode, signal: result.signal });
  }
};

const openBrowser = (url) => {
  if (argv.open === false) return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore' });
};

runReport();

const { key, cert } = await ensureCert(certDir);
const server = https.createServer({ key, cert }, (req, res) => {
  const url = new URL(req.url || '/', 'https://localhost');
  const pathname = decodePathnameSafe(url.pathname || '/');
  if (pathname == null) {
    res.writeHead(400);
    res.end('Malformed request path.');
    return;
  }
  if (pathname === '/' || pathname === '/map.iso.html') {
    serveMapIsoStaticFileOr404(res, outPath, 'map.iso.html not found.');
    return;
  }
  const targetPath = resolveMapViewerAsset(toolRoot, pathname);
  if (targetPath) {
    serveMapIsoStaticFileOr404(res, targetPath, 'viewer asset not found.');
    return;
  }
  res.writeHead(404);
  res.end('Not found.');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  try { await close(); process.exitCode = 0; } catch (error) { console.error(error.message); process.exitCode = 1; }
});
const address = server.address();
const actualPort = typeof address === 'object' && address ? address.port : port;
const url = `https://localhost:${actualPort}/map.iso.html`;
console.error(`Serving map: ${url}`);
console.error('Readiness: listener-ready; rendered viewer qualification is separate.');
openBrowser(url);
