/** Actual workspace picker and transport; inert DOM/fetch only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
const window=new Window({url:'http://localhost/map/workspace',settings:{disableJavaScriptFileLoading:true}});
for(const key of ['window','document','DOMParser','HTMLElement','SVGElement'])globalThis[key]=key==='window'?window:window[key];
globalThis.Option=function(text,value){const node=document.createElement('option');node.textContent=text;node.value=value;return node;};
globalThis.Worker=class{constructor(){throw new Error('inert compiler unavailable');}};
const previous=globalThis.fetch,pending=[];globalThis.fetch=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
document.write((await fs.readFile(new URL('../../../src/map/workspace/index.html',import.meta.url),'utf8')).replace(/<script[\s\S]*?<\/script>/g,''));
await import('../../../src/map/workspace/app.js');const $=id=>document.getElementById(id);
const selection={indexRoot:'C:/retained/exact-build',capabilityId:'f'.repeat(64)},generation='original-graph-generation';
const graphCapability={capability:'graph',status:'ready',capabilityId:selection.capabilityId,buildId:'exact-build',indexDir:'C:/immutable/index-code'};
const response=result=>new Response(JSON.stringify({ok:true,result}),{headers:{'Content-Type':'application/json'}});
try{
  $('operation').value='catalog';$('request').value=JSON.stringify({repoRoot:'C:/selected/repo',...selection});const loading=$('run').onclick();
  pending.at(-1).resolve(response({kind:'artifact-catalog',generation,graphCapability,selection,artifacts:[{name:'chunk_meta',available:true,family:'source',mode:'rows'}]}));await loading;
  assert.match($('generation').textContent,/graph-only.*health not established/);
  $('tree').querySelector('button').click();const inspect=[...$('detail').querySelectorAll('button')].find(node=>node.textContent==='Inspect this artifact');
  $('request').value=JSON.stringify({repoRoot:'C:/sibling/repo'});const inspecting=inspect.onclick();
  const input=JSON.parse(pending.at(-1).options.body);assert.equal(pending.at(-1).url,'/map/artifact');
  assert.deepEqual(input,{repoRoot:'C:/selected/repo',...selection,name:'chunk_meta',generation});
  pending.at(-1).resolve(response({kind:'artifact-page',generation,graphCapability,selection,name:'chunk_meta',mode:'rows',rows:[{name:'original row'}],cursor:null}));await inspecting;
  assert.match($('tree').textContent,/original row/);assert.match($('generation').textContent,/graph-only/);
  const count=pending.length;assert.equal((await inspect.onclick()).reason,'superseded');assert.equal(pending.length,count);
}finally{window.dispatchEvent(new window.Event('pagehide'));globalThis.fetch=previous;await window.happyDOM.close();}
console.log('Actual graph artifact picker preserves its original repository/root/capability and generation.');
