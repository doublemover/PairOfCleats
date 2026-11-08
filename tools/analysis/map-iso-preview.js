import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { bootstrapRuntime, getRepoCacheRoot, getRepoId, resolveToolRoot } from '../shared/dict-utils.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { decodePathnameSafe } from './map-iso-safe-join.js';
import { readSavedMap } from './map-saved-input.js';
import { pinMapViewerAssets } from './map-viewer-session-assets.js';
import { createMapPreferenceStore } from './map-viewer-preferences.js';
import { VIEWER_SETTINGS_MAX_BYTES } from '../../src/map/isometric/client/effective-settings.js';
import { createMapSnapshotTransportAsync } from './map-snapshot-transport.js';
import { SNAPSHOT_PAGE_LIMITS } from '../../src/map/isometric/client/data/protocol.js';
import { createMapPreviewLifetime } from './map-preview-lifetime.js';
import { combineMapReadCleanupFailure, projectMapReadFailure } from '../../src/map/shared/read-outcome.js';
import { createMapPreviewSessionView, freezeMapPreviewMetadata } from './map-preview-session-view.js';
import { captureMapPreviewGraphSelection, prepareMapPreviewExport } from './map-preview-export.js';

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
  captureMapPreviewGraphSelection(argv);
  if (argv.input && argv.out) throw new Error('--input opens saved evidence; --out creates a new export. Use separate commands.');
  if (Boolean(argv['tls-key']) !== Boolean(argv['tls-cert'])) throw new Error('Supply both --tls-key and --tls-cert, or use default loopback HTTP.');
  const port = argv.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535.');
  const toolRoot = resolveToolRoot(), controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  let server, session, temporaryOutput = null, snapshotTransport=null,activeSnapshotRequests=0;
  const reportClose = error => stderr.write(`${projectMapReadFailure(error).message}\n`);
  const onSignal = () => { close().catch(reportClose); };
  const lifetime = createMapPreviewLifetime({ controller });
  const close = lifetime.close;
  try {
    lifetime.listen(controller.signal, 'abort', () => { if (server?.listening) close().catch(reportClose); }, { options: { once: true } });
    if (signal) {
      lifetime.listen(signal, 'abort', onAbort, { options: { once: true } });
      if (signal.aborted) onAbort();
    }
    lifetime.listen(process, 'SIGINT', onSignal, { add: 'once', remove: 'off' });
    lifetime.listen(process, 'SIGTERM', onSignal, { add: 'once', remove: 'off' });
    controller.signal.throwIfAborted();
    let input, identity,preferenceStore=null;
    const sessionToken=randomBytes(32).toString('hex');
    if (argv.input) {
      const inputPath = path.resolve(argv.input);
      stderr.write(`Opening saved map: ${inputPath}. No live-index validation or build is requested.\n`);
      input = await readSavedMap(inputPath, { signal: controller.signal });
      identity = { ...input.provenance, inputPath, repo: input.model.root, producer: input.model.version, options: input.model.options || null };
      if(argv.repo){const selected=bootstrapRuntime(argv.repo);preferenceStore=createMapPreferenceStore(getRepoId(selected.repoRoot));}
    } else {
      const { repoRoot, userConfig, runtimeEnv } = bootstrapRuntime(argv.repo || argv.dir || null);
      const repoId=getRepoId(repoRoot);preferenceStore=createMapPreferenceStore(repoId);
      const outPath = argv.out ? path.resolve(argv.out) : path.join(getRepoCacheRoot(repoRoot, userConfig), 'maps', `preview-${randomUUID()}.html`);
      if (!argv.out) temporaryOutput = outPath;
      stderr.write(`Preparing map for ${repoRoot}. Only the selected existing index is read; no index build is performed.\n`);
      ({input,identity}=await prepareMapPreviewExport({argv,toolRoot,repoRoot,repoId,runtimeEnv,outPath,signal:controller.signal}));
    }
    controller.signal.throwIfAborted();
    const threeUrl = argv['three-url'] || '/three/three.module.js';
    const pinned = await pinMapViewerAssets(toolRoot, threeUrl, { signal: controller.signal });
    const sourceAvailable = typeof input.model.root.path === 'string'
      && await fs.stat(input.model.root.path).then(stat => stat.isDirectory(), () => false);
    const sourceNavigation = { available: sourceAvailable, reason: sourceAvailable ? null : 'Original source checkout unavailable; recorded evidence remains inspectable.' };
    const viewerConfig = argv.input ? {} : input.model.viewer || {};
    const preferences=preferenceStore?{endpoint:'/map-preferences',repoId:preferenceStore.repoId,token:sessionToken}:null;
    snapshotTransport=await createMapSnapshotTransportAsync({model:input.model,snapshotId:input.sha256,identity},{signal:controller.signal});
    lifetime.adopt(snapshotTransport, 'map preview original snapshot transport');
    const snapshotData={endpoint:'/map-snapshot',snapshot:input.sha256,token:sessionToken,demand:true,manifest:snapshotTransport.manifest};
    const bootstrapModel={version:input.model.version,root:input.model.root,nodes:[],edges:[],legend:input.model.legend,__poc_session_manifest:{version:1,snapshot:input.sha256},
      summary:{counts:{files:0,members:0,edges:0},scope:'manifest bootstrap; source detail is demand paged'},coverage:{source:snapshotTransport.manifest.coverage}};
    const html = Buffer.from(renderIsometricHtml({ mapModel: bootstrapModel, threeUrl,
      openUriTemplate: sourceAvailable ? argv['open-uri-template'] || '' : '', viewerConfig: { ...viewerConfig, threeUrl,
        sourceNavigation,preferences,snapshotData,openUriTemplate: sourceAvailable ? argv['open-uri-template'] || '' : '' } }));
    if (html.length > 40 * 1024 * 1024) throw new Error('Rendered saved map exceeds the preview document budget.');
    session = { ...pinned, html, documentSha256: digest(html), snapshotSha256: input.sha256, identity };
    lifetime.adopt(session.assets, 'map preview original pinned assets', 'clear');
    const originalSession = session;
    lifetime.adopt({ dispose: () => { originalSession.html = Buffer.alloc(0); } }, 'map preview original document bytes');
    controller.signal.throwIfAborted();
    const tls = argv['tls-key'] ? { key: await fs.readFile(path.resolve(argv['tls-key'])), cert: await fs.readFile(path.resolve(argv['tls-cert'])) } : null;
    controller.signal.throwIfAborted();
    const handleRequest = async(request, response) => {
      const pathname = decodePathnameSafe(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      if (pathname == null) { response.writeHead(400); response.end('Malformed request path.'); return; }
      if(pathname==='/map-snapshot'){
        const reply=(status,bytes)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Map-Snapshot':session.snapshotSha256});response.end(bytes);};
        if(request.headers['x-map-session']!==sessionToken){reply(403,JSON.stringify({error:'Pinned viewer session token required.'}));return;}
        if(request.method!=='POST'){reply(405,JSON.stringify({error:'POST required.'}));return;}
        if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')){reply(415,JSON.stringify({error:'JSON request required.'}));return;}
        if(activeSnapshotRequests>=SNAPSHOT_PAGE_LIMITS.inFlight){reply(429,JSON.stringify({error:'Snapshot response queue is full.'}));return;}
        activeSnapshotRequests++;
        const requestController=new AbortController(),cancel=()=>requestController.abort(controller.signal.reason||new DOMException('Snapshot client disconnected.','AbortError'));
        const disconnected=()=>{if(!response.writableEnded)cancel();};
        request.once('aborted',cancel);response.once('close',disconnected);controller.signal.addEventListener('abort',cancel,{once:true});
        try{
          const chunks=[];let length=0;
          for await(const chunk of request){length+=chunk.length;if(length>SNAPSHOT_PAGE_LIMITS.requestBytes){reply(413,JSON.stringify({error:'Snapshot request exceeds its byte budget.'}));return;}chunks.push(chunk);}
          controller.signal.throwIfAborted();
          const bytes=await snapshotTransport.respondAsync(JSON.parse(Buffer.concat(chunks,length).toString('utf8')),{signal:requestController.signal});
          requestController.signal.throwIfAborted();reply(200,bytes);
        }catch(error){if(!response.writableEnded)reply(400,JSON.stringify({error:error.message}));}
        finally{request.off('aborted',cancel);response.off('close',disconnected);controller.signal.removeEventListener('abort',cancel);activeSnapshotRequests--;}
        return;
      }
      if(pathname==='/map-preferences'){
        if(!preferenceStore||request.headers['x-map-session']!==sessionToken){response.writeHead(403);response.end('No selected-repository preference authority for this request.');return;}
        const reply=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(body));};
        if(request.method==='GET'){reply(200,await preferenceStore.load());return;}
        if(request.method!=='PUT'){reply(405,{error:'GET or PUT required.'});return;}
        if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')){reply(415,{error:'JSON preferences required.'});return;}
        const chunks=[];let length=0;
        for await(const chunk of request){length+=chunk.length;if(length>VIEWER_SETTINGS_MAX_BYTES){reply(413,{error:'Preferences exceed 64 KiB.'});return;}chunks.push(chunk);}
        try{reply(200,await preferenceStore.save(JSON.parse(Buffer.concat(chunks,length).toString('utf8')),{signal:controller.signal}));}
        catch(error){reply(error.code==='ERR_VIEWER_PREFERENCE_CONFLICT'?409:400,{error:error.message});}
        return;
      }
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end('GET and HEAD only.'); return; }
      if(pathname==='/map.compat.html'){
        const bytes=Buffer.from(renderIsometricHtml({mapModel:snapshotTransport.getCompatibilityModel(),threeUrl,openUriTemplate:sourceAvailable?argv['open-uri-template']||'':'',
          viewerConfig:{...viewerConfig,threeUrl,sourceNavigation,preferences}}));
        if(bytes.length>40*1024*1024)throw new Error('Compatibility document exceeds its admitted document budget.');
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Map-Snapshot':session.snapshotSha256});response.end(request.method==='HEAD'?undefined:bytes);return;
      }
      const document = pathname === '/' || pathname === '/map.iso.html';
      const asset = document ? { bytes: session.html, sha256: session.documentSha256, contentType: 'text/html; charset=utf-8' } : session.assets.get(pathname);
      if (!asset) { response.writeHead(404); response.end('Asset unavailable in this pinned viewer session. Restart explicitly after repairing local assets.'); return; }
      response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.bytes.length,
        'Cache-Control': 'no-store', ETag: `"${asset.sha256}"`, 'X-Map-Snapshot': session.snapshotSha256 });
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
    };
    const handle=(request,response)=>{
      lifetime.request(()=>handleRequest(request,response)).catch(error=>{
        if(response.destroyed||response.writableEnded)return;
        if(!response.headersSent)response.writeHead(lifetime.retired?503:500,{'Content-Type':'application/json'});
        response.end(JSON.stringify({error:projectMapReadFailure(error).message}));
      });
    };
    server = tls ? https.createServer(tls, handle) : http.createServer(handle);
    lifetime.ownServer(server);
    await new Promise((resolve, reject) => {
      const aborted = () => failed(controller.signal.reason || new Error('Preview startup cancelled.'));
      const failed = error => { server.off('listening', ready); controller.signal.removeEventListener('abort', aborted); reject(error); };
      const ready = () => { server.off('error', failed); controller.signal.removeEventListener('abort', aborted); resolve(); };
      controller.signal.addEventListener('abort', aborted, { once: true });
      server.once('error', failed); server.once('listening', ready);
      server.listen({ port, host: '127.0.0.1', signal: controller.signal });
    });
    controller.signal.throwIfAborted();
    server.on('error', error => { stderr.write(`Preview listener failed: ${projectMapReadFailure(error).message}\n`); close().catch(reportClose); });
    const address = server.address(), url = `${tls ? 'https' : 'http'}://127.0.0.1:${address.port}/map.iso.html`;
    const ready = freezeMapPreviewMetadata({ type: 'map-preview-ready', version: 1, url, lifecycle: 'listener-ready', pid: process.pid,
      identity, snapshotSha256: session.snapshotSha256, documentSha256: session.documentSha256,
      clientAssetIdentity: pinned.identity, missingOptionalAssets: pinned.unavailable,
      consumption:'manifest-demand',compatibilityUrl:new URL('/map.compat.html',url).href,
      sourceNavigation,
      refresh: 'explicit-restart', renderedViewer: 'not-qualified' });
    stdout.write(`${JSON.stringify(ready)}\n`);
    stderr.write(`Serving pinned map: ${url}\nReadiness is listener-only; renderer/browser qualification is separate.\n`);
    if (argv['no-open'] !== true && argv.open !== false) {
      try { openMapPreviewBrowser(url, { warn: message => stderr.write(`${message}\n`) }); }
      catch (error) { stderr.write(`Browser did not open: ${error.message}. Use ${url}\n`); }
    }
    lifetime.finishStartup();
    return { server, close, ready, session: createMapPreviewSessionView(session), resourceOwner: lifetime.resourceOwner };
  } catch (error) {
    lifetime.retainFailure(error);
    lifetime.finishStartup();
    try { await close(); } catch (cleanup) { throw combineMapReadCleanupFailure(error, [cleanup], { hasPrimary: true, terminal: true }); }
    throw error;
  }
  finally {
    lifetime.finishStartup();
    if (temporaryOutput) await fs.unlink(temporaryOutput).catch(error => { if (error.code !== 'ENOENT') stderr.write(`Could not retire owned staging file ${temporaryOutput}: ${error.message}\n`); });
  }
};
