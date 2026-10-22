import { captureSceneResource, observeSceneOwnership, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { clearGroup } from '../scene-utils.js';

/** Construction acquires real returned objects only. A throwing native
 * constructor's inaccessible internal children remain outside this contract. */
export const createSceneConstructionOwner = () => {
  const resources=new Set(),captured=new WeakMap(),failures=new Map(),shadows=new Set();let installed=null;
  const capture=(resource,label,method='dispose',args=[])=>{
    const reusable=resource&&(typeof resource==='object'||typeof resource==='function'),key=`${method}\0${label}`;
    let methods=reusable?captured.get(resource):null;
    if(methods?.has(key))return methods.get(key);
    const owner=captureSceneResource(resource,label,method,args);resources.add(owner);
    if(reusable){if(!methods){methods=new Map();captured.set(resource,methods);}methods.set(key,owner);}
    return owner;
  };
  const retire=()=>{
    if(installed)return installed.retire();
    const errors=[];
    for(const [error,observe] of failures)if(!observe())errors.push(error);
    if(errors.length)throw preserveSceneCleanupFailures(null,errors,{forceAggregate:true});
    for(const owner of [...resources].reverse())try{owner.retire();}catch(error){errors.push(error);}
    const failure=preserveSceneCleanupFailures(null,errors);if(failure)throw failure;
  };
  const owner=captureSceneResource({dispose:retire},'scene partial construction');
  return Object.freeze({capture,
    light:light=>{const shadow=light?.shadow;if(shadow)shadows.add(capture(shadow,'scene light shadow'));return light;},
    get shadowOwners(){return Object.freeze([...shadows]);},
    scene:scene=>{capture({dispose:()=>clearGroup(scene)},'scene partial groups');return scene;},
    retainFailure:error=>{const observe=observeSceneOwnership(error);if(observe&&!failures.has(error))failures.set(error,observe);},
    install:(dispose,receiver)=>{installed=captureSceneResource({dispose:()=>dispose.call(receiver)},'scene installed construction');},
    retire:()=>owner.retire()});
};
