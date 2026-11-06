import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';

/** Observe the actual helper on both sides of its original cooperative lock. */
export const createFixtureHealthLifecycleObservation=()=>{
  const key='fixture.health-lifecycle.'+randomUUID(),access='globalThis[Symbol.for('+JSON.stringify(key)+')]';
  const owner=new URL('./fixture-index.js',import.meta.url);owner.searchParams.set('health-lifecycle',key);
  const health=new URL('./fixture-health-snapshot.js',import.meta.url).href,lock=new URL('./directory-lock.js',import.meta.url).href;
  const healthModule='fixture:'+key+':health',lockModule='fixture:'+key+':lock';
  const state={snapshots:[],locks:0,beforeLocked:null,
    record(value){if(state.snapshots.length>=32)throw Error('Health lifecycle observation budget');state.snapshots.push(value);return value;}};
  globalThis[Symbol.for(key)]=state;
  const hooks=registerHooks({resolve(specifier,context,next){
    const result=next(specifier,context);
    if(context.parentURL===owner.href&&result.url===health)return {url:healthModule,shortCircuit:true};
    if(context.parentURL===owner.href&&result.url===lock)return {url:lockModule,shortCircuit:true};return result;
  },load(url,context,next){
    if(url===healthModule)return {format:'module',shortCircuit:true,source:
      'import {readFixtureHealthSnapshot as actual} from '+JSON.stringify(health)+';'+
      'export async function readFixtureHealthSnapshot(input){const metrics={};return '+access+'.record(await actual({...input,metrics}));}'};
    if(url===lockModule)return {format:'module',shortCircuit:true,source:
      'import {withDirectoryLock as actual} from '+JSON.stringify(lock)+';'+
      'export const withDirectoryLock=(dir,callback,options)=>actual(dir,async()=>{const state='+access+';state.locks++;if(state.beforeLocked)await state.beforeLocked(dir);return callback();},options);'};
    return next(url,context);
  }});
  return {state,load:()=>import(owner.href),close(){hooks.deregister();delete globalThis[Symbol.for(key)];}};
};
