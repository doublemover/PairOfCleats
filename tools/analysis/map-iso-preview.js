import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { bootstrapRuntime, getRepoCacheRoot, resolveToolRoot } from '../shared/dict-utils.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { decodePathnameSafe } from './map-iso-safe-join.js';
import { readSavedMap } from './map-saved-input.js';
import { pinMapViewerAssets } from './map-viewer-session-assets.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const openMapPreviewBrowser = (url, { platform = process.platform, spawnImpl = spawn, warn = console.error } = {}) => {
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', error => warn(`Browser did not open: ${error.message}. Open the ready URL manually.`));
  child.once('exit', code => { if (code) warn(`Browser opener exited ${code}. The preview URL remains available.`); });
  child.unref?.();
  return child;
};

export const runMapPreview = async (argv, { stdout = process.stdout, stderr = process.stderr, signal = null } = {}) => {
  if (argv.input && argv.out) throw new Error('--input opens saved evidence; --out creates a new export. Use separate commands.');
  if (Boolean(argv['tls-key']) !== Boolean(argv['tls-cert'])) throw new Error('Supply both --tls-key and --tls-cert, or use default loopback HTTP.');
  const port = argv.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535.');
  const toolRoot = resolveToolRoot(), controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  let server, session, temporaryOutput = null, closed = false;
  const onSignal = () => { controller.abort(); close().catch(error => stderr.write(`${error.message}\n`)); };
  const close = async () => {
    if (closed) return;
    closed = true;
    controller.abort();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    signal?.removeEventListener('abort', onAbort);
    if (server?.listening) await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    session?.assets.clear();
  };
  controller.signal.addEventListener('abort', () => { if (server?.listening) close().catch(error => stderr.write(`${error.message}\n`)); }, { once: true });
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    let input, identity;
    if (argv.input) {
      const inputPath = path.resolve(argv.input);
      stderr.write(`Opening saved map: ${inputPath}. No live-index validation or build is requested.\n`);
      input = await readSavedMap(inputPath, { signal: controller.signal });
      identity = { ...input.provenance, inputPath, repo: input.model.root, producer: input.model.version, options: input.model.options || null };
    } else {
      const { repoRoot, userConfig, runtimeEnv } = bootstrapRuntime(argv.repo || argv.dir || null);
      const outPath = argv.out ? path.resolve(argv.out) : path.join(getRepoCacheRoot(repoRoot, userConfig), 'maps', `preview-${randomUUID()}.html`);
      if (!argv.out) temporaryOutput = outPath;
      stderr.write(`Preparing map for ${repoRoot}. Only the selected existing index is read; no index build is performed.\n`);
      const args = [path.join(toolRoot, 'tools/reports/report-code-map.js'), '--repo', repoRoot,
        '--format', 'html-iso', '--out', outPath, '--three-url', '/three/three.module.js', '--json'];
      for (const key of ['mode','index-root','scope','focus','include','collapse','max-files','max-members-per-file','max-edges','top-k-by-degree','only-exported','refresh','cache-dir','open-uri-template']) {
        const value = argv[key];
        if (value == null || value === false) continue;
        if (value === true) args.push(`--${key}`);
        else if (Array.isArray(value)) for (const item of value) args.push(`--${key}`, String(item));
        else args.push(`--${key}`, String(value));
      }
      const result = await spawnSubprocess(process.execPath, args, { cwd: toolRoot, env: runtimeEnv,
        signal: controller.signal, outputMode: 'string', maxOutputBytes: 1024 * 1024, rejectOnNonZeroExit: false });
      let receipt;
      try { receipt = JSON.parse(result.stdout); } catch { throw new Error(`Map export produced no readable success receipt. ${result.stderr || ''}`); }
      const output = receipt.outputs?.find(entry => entry.kind === 'report');
      if (result.exitCode !== 0 || receipt.ok !== true || !output?.ok || output.path !== outPath) throw new Error(`Map export did not publish requested HTML: ${JSON.stringify(receipt.outputs || receipt)}. Validate the selected existing index before retrying.`);
      input = await readSavedMap(outPath, { signal: controller.signal });
      if (input.sha256 !== output.sha256 || input.bytes !== output.bytes) throw new Error('Map output changed after publication; preview admission refused. Retry with a separate --out destination.');
      identity = { kind: 'live-index-export', ...receipt.identity, cacheKey: receipt.cacheKey };
    }
    controller.signal.throwIfAborted();
    const threeUrl = argv['three-url'] || '/three/three.module.js';
    const pinned = await pinMapViewerAssets(toolRoot, threeUrl, { signal: controller.signal });
    const sourceAvailable = typeof input.model.root.path === 'string'
      && await fs.stat(input.model.root.path).then(stat => stat.isDirectory(), () => false);
    const sourceNavigation = { available: sourceAvailable, reason: sourceAvailable ? null : 'Original source checkout unavailable; recorded evidence remains inspectable.' };
    const viewerConfig = argv.input ? {} : input.model.viewer || {};
    const html = Buffer.from(renderIsometricHtml({ mapModel: input.model, threeUrl,
      openUriTemplate: sourceAvailable ? argv['open-uri-template'] || '' : '', viewerConfig: { ...viewerConfig, threeUrl,
        sourceNavigation, openUriTemplate: sourceAvailable ? argv['open-uri-template'] || '' : '' } }));
    if (html.length > 40 * 1024 * 1024) throw new Error('Rendered saved map exceeds the preview document budget.');
    session = { ...pinned, html, documentSha256: digest(html), snapshotSha256: input.sha256, identity };
    controller.signal.throwIfAborted();
    const tls = argv['tls-key'] ? { key: await fs.readFile(path.resolve(argv['tls-key'])), cert: await fs.readFile(path.resolve(argv['tls-cert'])) } : null;
    controller.signal.throwIfAborted();
    const handle = (request, response) => {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end('GET and HEAD only.'); return; }
      const pathname = decodePathnameSafe(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      if (pathname == null) { response.writeHead(400); response.end('Malformed request path.'); return; }
      const document = pathname === '/' || pathname === '/map.iso.html';
      const asset = document ? { bytes: session.html, sha256: session.documentSha256, contentType: 'text/html; charset=utf-8' } : session.assets.get(pathname);
      if (!asset) { response.writeHead(404); response.end('Asset unavailable in this pinned viewer session. Restart explicitly after repairing local assets.'); return; }
      response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.bytes.length,
        'Cache-Control': 'no-store', ETag: `"${asset.sha256}"`, 'X-Map-Snapshot': session.snapshotSha256 });
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
    };
    server = tls ? https.createServer(tls, handle) : http.createServer(handle);
    await new Promise((resolve, reject) => {
      const aborted = () => failed(controller.signal.reason || new Error('Preview startup cancelled.'));
      const failed = error => { server.off('listening', ready); controller.signal.removeEventListener('abort', aborted); reject(error); };
      const ready = () => { server.off('error', failed); controller.signal.removeEventListener('abort', aborted); resolve(); };
      controller.signal.addEventListener('abort', aborted, { once: true });
      server.once('error', failed); server.once('listening', ready);
      server.listen({ port, host: '127.0.0.1', signal: controller.signal });
    });
    controller.signal.throwIfAborted();
    server.on('error', error => { stderr.write(`Preview listener failed: ${error.message}\n`); close().catch(() => {}); });
    const address = server.address(), url = `${tls ? 'https' : 'http'}://127.0.0.1:${address.port}/map.iso.html`;
    const ready = { type: 'map-preview-ready', version: 1, url, lifecycle: 'listener-ready', pid: process.pid,
      identity, snapshotSha256: session.snapshotSha256, documentSha256: session.documentSha256,
      clientAssetIdentity: pinned.identity, missingOptionalAssets: pinned.unavailable,
      sourceNavigation,
      refresh: 'explicit-restart', renderedViewer: 'not-qualified' };
    stdout.write(`${JSON.stringify(ready)}\n`);
    stderr.write(`Serving pinned map: ${url}\nReadiness is listener-only; renderer/browser qualification is separate.\n`);
    if (argv['no-open'] !== true && argv.open !== false) {
      try { openMapPreviewBrowser(url, { warn: message => stderr.write(`${message}\n`) }); }
      catch (error) { stderr.write(`Browser did not open: ${error.message}. Use ${url}\n`); }
    }
    return { server, close, ready, session };
  } catch (error) { await close(); throw error; }
  finally {
    if (temporaryOutput) await fs.unlink(temporaryOutput).catch(error => { if (error.code !== 'ENOENT') stderr.write(`Could not retire owned staging file ${temporaryOutput}: ${error.message}\n`); });
  }
};
