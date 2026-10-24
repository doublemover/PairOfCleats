import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { initViewerShell } from '../../src/map/isometric/client/workspace-shell.js';
const fixture=()=>{
  const window=new Window({url:'http://127.0.0.1:12345',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(renderIsometricHtml({mapModel:{nodes:[],edges:[]},threeUrl:'/three/three.module.js'}).replace(/<script[\s\S]*?<\/script>/g,''));
  const state={};return{window,state,shell:initViewerShell(state,window.document)};
};
const turn=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
{
  const f=fixture();let complete,calls=0;
  const original={dispose(){assert.equal(this,original);calls++;return new Promise(resolve=>{complete=resolve;});}};
  assert.equal(f.shell.adoptSettings(original),true);
  f.state.settingsSession={dispose(){assert.fail('current sibling state cannot replace the original settings owner');}};
  original.dispose=()=>assert.fail('later disposer cannot acquire original session authority');
  const status=f.window.document.getElementById('viewer-save-status'),before=status.textContent;
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.shell.retired,true);await turn();assert.equal(calls,1);f.shell.setSaveStatus('stale saved');assert.equal(status.textContent,before);
  assert.equal(f.shell.choose('Appearance'),false);
  const owner=f.shell.pendingOwners.find(owner=>owner.resource.originalResource===original);assert(owner);
  complete();await owner.releaseAsync();await f.shell.dispose();assert.equal(calls,1);assert.equal(owner.pending,false);await f.window.happyDOM.close();
}
{
  const f=fixture();f.window.dispatchEvent(new f.window.Event('pagehide'));let calls=0;
  const late={dispose(){calls++;}};
  assert.equal(f.shell.adoptSettings(late),false,'actual viewer initializer cannot continue after a late settings acquisition in a retired shell');
  assert.equal(calls,1);await f.shell.dispose();await f.window.happyDOM.close();
}
{
  const f=fixture(),sibling={accepted:true};let calls=0;
  f.state.viewerShell=sibling;
  const late={dispose(){calls++;}};
  assert.equal(f.shell.adoptSettings(late),false,'late initializer cannot continue through a replaced shell publication');
  assert.equal(calls,1);await f.shell.dispose();assert.equal(f.state.viewerShell,sibling);await f.window.happyDOM.close();
}
{
  const f=fixture();let calls=0;
  const original={dispose(){assert.equal(this,original);calls++;}};
  assert.equal(f.shell.adoptSource(original),true);
  f.state.remoteSource={dispose(){assert.fail('current source cannot become the shell original source');}};
  original.dispose=()=>assert.fail('original source disposer replacement cannot acquire authority');
  await f.shell.dispose();assert.equal(calls,1);await f.window.happyDOM.close();
}
{
  const f=fixture(),sibling={accepted:true};let calls=0;
  f.state.viewerShell=sibling;
  assert.equal(f.shell.adoptSource({dispose(){calls++;}}),false);
  assert.equal(calls,1);await f.shell.dispose();assert.equal(f.state.viewerShell,sibling);await f.window.happyDOM.close();
}
console.log('Actual viewer shell retires original and late settings sessions without sibling callback adoption.');
