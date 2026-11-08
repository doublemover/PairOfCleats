import assert from 'node:assert/strict';
import { loadViewerSettingsSession } from '../../src/map/isometric/client/settings-client.js';
import { emptyViewerPreferences } from '../../src/map/isometric/client/effective-settings.js';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const config=()=>({preferences:{repoId:'selected-repo',endpoint:'/map-preferences',token:'original-session-token'}});
const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
{
  const original=config(),requests=[];let deliver;
  const sessionFlight=loadViewerSettingsSession(original,{fetchImpl:(url,options)=>{
    requests.push({url,options});return requests.length===1?new Promise(resolve=>{deliver=resolve;}):Promise.resolve(json({...JSON.parse(options.body),revision:1}));
  }});
  original.preferences.repoId='sibling-repo';original.preferences.endpoint='/sibling-endpoint';original.preferences.token='sibling-token';
  requests[0].options.headers['X-Map-Session']='mutated-fetch-input';
  deliver(json(emptyViewerPreferences('selected-repo')));const session=await sessionFlight;
  session.update({appearance:{palette:'crisp'}});await session.save();
  assert.equal(requests[1].url,'/map-preferences');assert.equal(requests[1].options.headers['X-Map-Session'],'original-session-token');
  assert.equal(JSON.parse(requests[1].options.body).repoId,'selected-repo');await session.dispose();
}
for(const original of [undefined,null,false,0,'']){
  const session=await loadViewerSettingsSession(config(),{fetchImpl:async()=>{throw original;}});
  assert.equal(session.availabilityFailed,true);assert.equal(session.availabilityFailure,original);assert.equal(session.status,'session-only');
  assert.equal(typeof session.availabilityError,'string');await session.dispose();
}
{
  let releases=0,cancels=0,reads=0;
  const response={ok:true,status:200,headers:{get:()=> 'application/json'},body:{getReader:()=>({
    async read(){reads++;return{done:false,value:new Uint8Array(65537)};},async cancel(){cancels++;},releaseLock(){releases++;}
  })},text(){assert.fail('unbounded text buffering is not an admitted settings path');},json(){assert.fail('unbounded JSON buffering is not an admitted settings path');}};
  const session=await loadViewerSettingsSession(config(),{fetchImpl:async()=>response});
  assert.equal(session.availabilityFailed,true);assert.match(session.availabilityError,/byte budget/);
  assert.equal(reads,1);assert.equal(cancels,1);assert.equal(releases,1);await session.dispose();
}
{
  const diagnostic=Object.freeze(new Error('unavailable status callback failed'));
  const result=await outcome(loadViewerSettingsSession(config(),{fetchImpl:async()=>{throw undefined;},onStatus(){throw diagnostic;}}));
  assert.equal(result.ok,false);assert.equal(result.error.cause,undefined);assert(result.error.errors.includes(diagnostic));
}
console.log('Actual settings client captures selected authority and bounds GET/PUT response admission.');
