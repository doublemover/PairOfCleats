import assert from 'node:assert/strict';
import { createViewportInputOwner } from '../../src/map/isometric/client/input-ownership.js';

class Surface {
  events=new Map();
  addEventListener(name,callback){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(callback);}
  removeEventListener(name,callback){this.events.get(name)?.delete(callback);}
  fire(name,event={}){event.target??=this;event.preventDefault=()=>{event.prevented=true;};for(const callback of this.events.get(name)||[])callback(event);return event;}
}
const window=new Surface(),document=new Surface(),viewport=new Surface(),canvas=new Surface(),input=new Surface();
viewport.focus=()=>{document.activeElement=viewport;document.fire('focusin',{target:viewport});};
let cancelled=0,shortcuts=0;
const owner=createViewportInputOwner({window,document,viewport,canvas,cancelMotion:()=>{cancelled++;},invalidate(){},shortcut:()=>{shortcuts++;return false;}});
viewport.focus();
assert.equal(window.fire('keydown',{target:viewport,code:'KeyW'}).prevented,true);
assert.equal(owner.keys.KeyW,true);
window.fire('blur');window.fire('keyup',{target:input,code:'KeyW'});viewport.focus();assert.equal(owner.keys.KeyW,undefined);
window.fire('keydown',{target:viewport,code:'KeyW'});document.fire('focusin',{target:input});assert.equal(owner.keys.KeyW,undefined);
const before=shortcuts;window.fire('keydown',{target:input,code:'Home'});assert.equal(shortcuts,before);
viewport.focus();window.fire('keydown',{target:viewport,code:'KeyW',ctrlKey:true});assert.equal(owner.keys.KeyW,undefined);
window.fire('keydown',{target:viewport,code:'KeyD'});canvas.fire('pointercancel');assert.equal(owner.keys.KeyD,undefined);
assert.ok(cancelled>=3);owner.dispose();assert.equal([...window.events.values()].reduce((sum,values)=>sum+values.size,0),0);
console.log('Viewport keyboard ownership retires keys and motion across focus, blur, modifiers and pointer cancellation.');
