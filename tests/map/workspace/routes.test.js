import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiRouter } from '../../../tools/api/router.js';
const router = createApiRouter({host:'127.0.0.1',defaultRepo:process.cwd(),allowedRepoRoots:[process.cwd()],auth:{required:true,token:'fixture-token'},cors:{allowedOrigins:['http://allowed.test']}});
const server = http.createServer(router.handleRequest);
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const headers={Authorization:'Bearer fixture-token'};
  assert.equal((await fetch(base+'/map/workspace')).status,200);
  assert.equal((await fetch(base+'/map/catalog',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/map/workspace',{headers:{...headers,Origin:'http://blocked.test'}})).status,403);
  const page=await fetch(base+'/map/workspace',{headers});assert.equal(page.status,200);assert.match(await page.text(),/Evidence workspace/i);
  for (const file of ['app.js','projection.js','reladraw-worker.js']) assert.equal((await fetch(base+'/map/workspace/'+file,{headers})).status,200);
  assert.equal((await fetch(base+'/map/vendor/reladraw/index.js',{headers})).status,200);
  for (const path of ['/map/workspace/nope.js','/map/workspace/nested/app.js','/map/vendor/reladraw/../../package.json']) assert.equal((await fetch(base+path,{headers})).status,404);
  const denied=await fetch(base+'/map/catalog',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({repoRoot:'/outside-allowed-root'})});
  assert.ok([400,403].includes(denied.status));
  console.log('Workspace assets retain API authentication, origin, allowlist and static-path boundaries.');
} finally { await new Promise(resolve=>server.close(resolve)); router.close(); }
