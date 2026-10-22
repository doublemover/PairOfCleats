/** DOM emulation only: does not qualify browser layout, graphics or real Worker isolation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { parse, resolve, render, DARK_THEME } from 'reladraw';
const window=new Window({url:'http://localhost/map/workspace',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
for(const key of ['window','document','DOMParser','Option','HTMLElement','SVGElement'])globalThis[key]=key==='window'?window:window[key];
globalThis.Option=function(text,value){const option=document.createElement('option');option.textContent=text;option.value=value;return option;};
const workers=[];
globalThis.Worker=class {
  constructor(){workers.push(this);this.terminated=false;}
  terminate(){this.terminated=true;}
  postMessage({source,id}){queueMicrotask(()=>{if(this.terminated)return;try{
    const layout=resolve(parse(source));this.onmessage({data:{id,svg:render(layout,{theme:DARK_THEME}),layout:{width:layout.width,height:layout.height,nodes:layout.nodes.map(({name,x,y,width,height})=>({name,x,y,width,height}))}}});
  }catch(error){this.onmessage({data:{id,error:error.message}});}});}
};
const html=await fs.readFile(new URL('../../../src/map/workspace/index.html',import.meta.url),'utf8');
document.write(html.replace(/<script[\s\S]*?<\/script>/g,''));
await import('../../../src/map/workspace/app.js');
const $=id=>document.getElementById(id);
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
const load=async data=>{await $('open').onchange({target:{files:[{name:'fixture.json',size:JSON.stringify(data).length,text:async()=>JSON.stringify(data)}],value:''}});await settle();};
const map={options:{},summary:{},nodes:[{path:'a.js',name:'A',members:[{id:0,name:'receive',kind:'function',range:{startLine:1,endLine:3}}]},{path:'b.js',name:'B',members:[{id:1,name:'emit',kind:'function'}]}],edges:[{type:'call',from:{file:'a.js',member:0},to:{file:'b.js',member:1},certainty:'inferred'}]};
await load(map);
assert.equal($('family').textContent,'map');assert.equal(document.querySelectorAll('.pick-target').length,4);
const target=document.querySelector('[data-entity-id="member:0"]');
target.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
assert.equal($('selection').textContent,'receive');assert.match($('detail').textContent,/member:0/);
const relation=[...$('detail').querySelectorAll('button')].find(button=>button.textContent.includes('call'));
relation.click();assert.match($('selection').textContent,/source evidence/);
[...$('detail').querySelectorAll('button')].find(button=>button.textContent==='Go to target').click();
assert.equal($('selection').textContent,'emit');$('back').click();assert.equal($('selection').textContent,'receive');
$('filter').value='emit';$('filter').dispatchEvent(new window.Event('input'));assert.match($('tree').textContent,/emit/);assert.doesNotMatch($('tree').textContent,/receive/);
$('filter').value='';$('filter').dispatchEvent(new window.Event('input'));
$('relation').value='call';$('relation').dispatchEvent(new window.Event('change'));await settle();assert.equal(document.querySelectorAll('.pick-target').length,4);
const validSvg=$('diagram').innerHTML;
$('editor-toggle').click();$('source').value='INVALID ???';$('compile').click();await settle();
assert.equal($('diagram').innerHTML,validSvg,'invalid edit retains last valid geometry');assert.ok($('compile-status').textContent);
$('reset-source').click();await settle();assert.match($('compile-status').textContent,/4 shapes/);
$('data-view').click();assert.ok($('diagram').querySelector('button'));$('data-view').click();await settle();
await load({code:[{id:1,name:'ranked',score:0.5}]});assert.equal($('family').textContent,'search');assert.equal($('diagram').querySelectorAll('svg').length,0);
await load({...map,nodes:Array.from({length:250},(_,i)=>({path:`${i}.js`,members:[]})),edges:[]});
assert.equal(document.querySelectorAll('.pick-target').length,200);$('next').click();await settle();assert.equal(document.querySelectorAll('.pick-target').length,50);assert.equal($('page').textContent,'2');
$('previous').click();await settle();assert.equal(document.querySelectorAll('.pick-target').length,200);
await load({options:{},summary:{},nodes:Array.from({length:202},(_,i)=>({path:`${i}.js`,name:`File ${i}`,members:[]})),edges:[
  {type:'call',from:{file:'0.js'},to:{file:'1.js'}},
  {type:'import',from:{file:'200.js'},to:{file:'201.js'}}
]});
[...$('tree').querySelectorAll('button')].find(button=>button.textContent.startsWith('File 0')).click();
assert.equal($('selection').textContent,'File 0');assert.match($('detail').textContent,/→ call/);
assert.deepEqual([...$('relation').options].map(option=>option.value),['','call','import']);
$('next').click();await settle();assert.match($('selection').textContent,/outside this page/);
assert.ok([...$('relation').options].some(option=>option.value==='import'),'a later-page relation remains selectable');
$('previous').click();await settle();assert.equal($('selection').textContent,'File 0');
assert.ok($('detail').querySelector('dl'),'returning to the selected page restores its current overview');
assert.match($('detail').textContent,/→ call/);assert.equal($('back').disabled,true,'rebuild does not record another selection');
$('relation').value='import';$('relation').dispatchEvent(new window.Event('change'));await settle();
assert.doesNotMatch($('detail').textContent,/→ call/,'retained inspectors use the current relationship filter');
$('next').click();await settle();assert.equal($('relation').value,'import');
assert.ok([...$('relation').options].some(option=>option.value==='call'),'filtering cannot hide the clearing/changing vocabulary');
$('previous').click();await settle();assert.equal($('selection').textContent,'File 0');
assert.ok(workers.every(worker=>worker.terminated),'compiled workers are disposed');
let releaseOld;
const older=$('open').onchange({target:{files:[{name:'older.json',size:20,text:()=>new Promise(resolve=>{releaseOld=resolve;})}],value:''}});
await load({code:[{id:2,name:'latest response'}]});releaseOld(JSON.stringify(map));await older;await settle();
assert.equal($('family').textContent,'search');assert.match($('diagram').textContent,/latest response/);
await $('open').onchange({target:{files:[{name:'too-big.json',size:3*1024*1024,text:async()=>{throw new Error('must not read');}}],value:''}});
assert.match($('notice').textContent,/exceeds 2 MiB/);assert.equal($('family').textContent,'search');
await load({code:Array.from({length:601},(_,index)=>({name:index===0||index===400||index===600?'duplicate needle':`row-${index}`,file:`src/${index}.js`}))});
$('find-scope').value='loaded';$('filter').value='duplicate needle';await $('filter').oninput();
assert.match($('find-status').textContent,/3 matches in loaded response only/);
assert.equal($('find-matches').querySelectorAll('button').length,3);
assert.match($('find-matches').textContent,/src\/400.js/);
$('find-next').click();assert.equal($('page').textContent,'1');assert.match($('detail').textContent,/hit:code:0/);
$('find-next').click();await settle();assert.equal($('page').textContent,'3');assert.match($('detail').textContent,/hit:code:400/);
$('find-next').click();await settle();assert.equal($('page').textContent,'4');assert.match($('detail').textContent,/hit:code:600/);
$('back').click();await settle();assert.equal($('page').textContent,'3');assert.match($('detail').textContent,/hit:code:400/);
$('forward').click();await settle();assert.equal($('page').textContent,'4');assert.match($('detail').textContent,/hit:code:600/);
assert.equal($('diagram').querySelectorAll('.evidence-card').length,1,'navigation keeps the admitted local page bound');
await load({code:[{name:'new generation',file:'new.js'}]});
assert.equal($('filter').value,'');assert.equal($('find-matches').children.length,0);assert.equal($('find-next').disabled,true);
const {safeSvg}=await import('../../../src/map/workspace/svg.js');
const inert=safeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><a href="https://example.com"><rect onload="bad()" fill="url(https://example.com/x)" width="4"/></a></svg>');
assert.equal(inert.querySelectorAll('script,a').length,0);assert.equal(inert.querySelector('rect').hasAttribute('onload'),false);assert.equal(inert.querySelector('rect').hasAttribute('fill'),false);
window.dispatchEvent(new window.Event('pagehide'));await window.happyDOM.close();
console.log('DOM-emulated selection, keyboard, relationships/history, filters, invalid-edit recovery, renderer replacement, repeated pagination and inert SVG passed; no visual/browser claim.');
