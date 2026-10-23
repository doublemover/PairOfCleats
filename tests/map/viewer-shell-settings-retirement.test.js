import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { initViewerShell } from '../../src/map/isometric/client/workspace-shell.js';
const fixture=()=>{
  const window=new Window({url:'http://127.0.0.1:12345',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  window.document.write(renderIsometricHtml({mapModel:{nodes:[],edges:[]},threeUrl:'/three/three.module.js'}).replace(/<script[\s\S]*?<\/script>/g,''));
  const state={};return{window,state,shell:initViewerShell(state,window.document)};
};
{
  const f=fixture();let complete,calls=0;
  const original={dispose(){assert.equal(this,original);calls++;return new Promise(resolve=>{complete=resolve;});}};
  assert.equal(f.shell.adoptSettings(original),true);
  f.state.settingsSession={dispose(){assert.fail('current sibling state cannot replace the original settings owner');}};
  original.dispose=()=>assert.fail('later disposer cannot acquire original session authority');
  const before=f.window.document.getElementById('viewer-save-status').textContent;
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.shell.retired,true);assert.equal(calls,1);f.shell.setSaveStatus('stale saved');assert.equal(f.window.document.getElementById('viewer-save-status').textContent,before);
  assert.equal(f.shell.choose('Appearance'),false);
  const owner=f.shell.pendingOwners.find(owner=>owner.resource===original);assert(owner);
  complete();await owner.releaseAsync();assert.equal(calls,1);assert.equal(owner.pending,false);await f.window.happyDOM.close();
}
{
  const f=fixture();f.window.dispatchEvent(new f.window.Event('pagehide'));let calls=0;
  const late={dispose(){calls++;}};
  assert.equal(f.shell.adoptSettings(late),false,'actual viewer initializer cannot continue after a late settings acquisition in a retired shell');
  assert.equal(calls,1);await f.window.happyDOM.close();
}
console.log('Actual viewer shell retires original and late settings sessions without sibling callback adoption.');
