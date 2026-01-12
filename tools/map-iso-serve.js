#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync, spawn } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import selfsigned from 'selfsigned';

const argv = createCli({
  scriptName: 'map-iso',
  options: {
    repo: { type: 'string', describe: 'Repo root.' },
    out: { type: 'string', describe: 'Output HTML path.' },
    port: { type: 'number', default: 0, describe: 'HTTPS port (0 for random).' },
    'open-uri-template': { type: 'string', describe: 'URI template for double-click.' },
    'three-url': { type: 'string', describe: 'Override three.js module URL.' },
    'cert-dir': { type: 'string', describe: 'Directory for TLS key/cert.' },
    open: { type: 'boolean', default: true, describe: 'Open browser.' }
  }
}).parse();

const repoRoot = argv.repo ? path.resolve(argv.repo) : process.cwd();
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
    path.join(repoRoot, 'tools', 'report-code-map.js'),
    '--repo', repoRoot,
    '--format', 'html-iso',
    '--out', outPath,
    '--three-url', threeUrl
  ];
  if (argv['open-uri-template']) {
    args.push('--open-uri-template', argv['open-uri-template']);
  }
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const contentTypeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
};

const safeJoin = (baseDir, requestPath) => {
  const safePath = path.normalize(path.join(baseDir, requestPath));
  if (!safePath.startsWith(baseDir)) return null;
  return safePath;
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
const threeRoot = path.join(repoRoot, 'node_modules', 'three', 'build');

const server = https.createServer({ key, cert }, (req, res) => {
  const url = new URL(req.url || '/', 'https://localhost');
  const pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/' || pathname === '/map.iso.html') {
    const htmlPath = outPath;
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404);
      res.end('map.iso.html not found.');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(htmlPath) });
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }
  if (pathname.startsWith('/three/')) {
    const relativePath = pathname.replace('/three/', '');
    const targetPath = safeJoin(threeRoot, relativePath);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('three.js asset not found.');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('Not found.');
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `https://localhost:${actualPort}/map.iso.html`;
  console.log(`Serving map: ${url}`);
  openBrowser(url);
});
