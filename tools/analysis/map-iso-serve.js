#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import selfsigned from 'selfsigned';
import { getRuntimeConfig, resolveRepoConfig, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { decodePathnameSafe, safeJoinUnderBase } from './map-iso-safe-join.js';

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
const { repoRoot, userConfig } = resolveRepoConfig(repoArg);
const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const mapsDir = path.join(repoRoot, '.pairofcleats', 'maps');
const outPath = argv.out ? path.resolve(argv.out) : path.join(mapsDir, 'map.iso.html');
const threeUrl = argv['three-url'] || '/three/three.module.js';
const certDir = argv['cert-dir'] ? path.resolve(argv['cert-dir']) : path.join(mapsDir, '.certs');
const port = Number.isFinite(argv.port) ? argv.port : 0;

const ensureDir = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const ensureCert = (targetDir) => {
  ensureDir(targetDir);
  const keyPath = path.join(targetDir, 'localhost.key');
  const certPath = path.join(targetDir, 'localhost.crt');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, { days: 30, keySize: 2048 });
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
    process.exit(result.exitCode ?? 1);
  }
};

const contentTypeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.hdr') return 'application/octet-stream';
  return 'application/octet-stream';
};

const serveStaticFileOr404 = (res, filePath, notFoundMessage) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end(notFoundMessage);
      return;
    }
  } catch {
    res.writeHead(404);
    res.end(notFoundMessage);
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  const stream = fs.createReadStream(filePath);
  const onResponseClose = () => {
    if (!stream.destroyed) {
      stream.destroy();
    }
  };
  res.once('close', onResponseClose);
  stream.once('close', () => {
    res.off('close', onResponseClose);
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404);
    }
    if (!res.writableEnded) {
      res.end(notFoundMessage);
    }
  });
  stream.pipe(res);
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

const { key, cert } = ensureCert(certDir);
const threeRoot = path.join(toolRoot, 'node_modules', 'three');
const threeBuildRoot = path.join(threeRoot, 'build');
const threeExamplesRoot = path.join(threeRoot, 'examples');
const isomapAssetsRoot = path.join(toolRoot, 'assets', 'isomap');
const isomapClientRoot = path.join(toolRoot, 'src', 'map', 'isometric', 'client');

const server = https.createServer({ key, cert }, (req, res) => {
  const url = new URL(req.url || '/', 'https://localhost');
  const pathname = decodePathnameSafe(url.pathname || '/');
  if (pathname == null) {
    res.writeHead(400);
    res.end('Malformed request path.');
    return;
  }
  if (pathname === '/' || pathname === '/map.iso.html') {
    serveStaticFileOr404(res, outPath, 'map.iso.html not found.');
    return;
  }
  if (pathname.startsWith('/three/examples/')) {
    const relativePath = pathname.replace('/three/examples/', '');
    const targetPath = safeJoinUnderBase(threeExamplesRoot, relativePath);
    if (!targetPath) {
      res.writeHead(404);
      res.end('three.js example asset not found.');
      return;
    }
    serveStaticFileOr404(res, targetPath, 'three.js example asset not found.');
    return;
  }
  if (pathname.startsWith('/three/')) {
    const relativePath = pathname.replace('/three/', '');
    const targetPath = safeJoinUnderBase(threeBuildRoot, relativePath);
    if (!targetPath) {
      res.writeHead(404);
      res.end('three.js asset not found.');
      return;
    }
    serveStaticFileOr404(res, targetPath, 'three.js asset not found.');
    return;
  }
  if (pathname.startsWith('/assets/isomap/')) {
    const relativePath = pathname.replace('/assets/isomap/', '');
    const targetPath = safeJoinUnderBase(isomapAssetsRoot, relativePath);
    if (!targetPath) {
      res.writeHead(404);
      res.end('isomap asset not found.');
      return;
    }
    serveStaticFileOr404(res, targetPath, 'isomap asset not found.');
    return;
  }
  if (pathname.startsWith('/isomap/')) {
    const relativePath = pathname.replace('/isomap/', '');
    const targetPath = safeJoinUnderBase(isomapClientRoot, relativePath);
    if (!targetPath) {
      res.writeHead(404);
      res.end('isomap client asset not found.');
      return;
    }
    serveStaticFileOr404(res, targetPath, 'isomap client asset not found.');
    return;
  }
  res.writeHead(404);
  res.end('Not found.');
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `https://localhost:${actualPort}/map.iso.html`;
  console.error(`Serving map: ${url}`);
  openBrowser(url);
});
