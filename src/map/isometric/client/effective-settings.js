import { mergeConfig } from '../../../shared/config.js';
import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';
import { captureSceneFailure } from './scene-failure-inspection.js';

export const VIEWER_SETTINGS_VERSION = 1;
export const VIEWER_SETTINGS_MAX_BYTES = 64 * 1024;
const roots = new Set(['layout','scoring','colors','controls','visuals','performance','appearance']);
const forbidden = new Set(['__proto__','prototype','constructor']);
const clone = value => JSON.parse(JSON.stringify(value));
const assertLayout = layout => {
  if (typeof layout !== 'string' || !/^[a-z][a-z-]{0,30}$/.test(layout) || forbidden.has(layout)) throw new Error('Unsupported viewer layout preference key.');
  return layout;
};

export const sanitizeViewerSettings = (input) => {
  let count=0;
  const visit=(value,depth)=>{
    if(++count>1024||depth>8)throw new Error('Viewer settings exceed their structural budget.');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Viewer settings require finite numbers.');return value;}
    if(typeof value==='string'){if(value.length>2048)throw new Error('Viewer setting text is too long.');return value;}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Viewer settings require bounded scalar/object values.');
    const result={};
    for(const [key,entry]of Object.entries(value)){
      if(forbidden.has(key)||key.length>80)throw new Error('Unsupported viewer settings key.');
      result[key]=visit(entry,depth+1);
    }
    return result;
  };
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Viewer settings must be an object.');
  for(const key of Object.keys(input))if(!roots.has(key))throw new Error(`Unsupported viewer settings family: ${key}`);
  const result=visit(input,0);
  if(new TextEncoder().encode(JSON.stringify(result)).length>VIEWER_SETTINGS_MAX_BYTES)throw new Error('Viewer settings exceed 64 KiB.');
  return result;
};

export const mergeViewerSettings = (...layers) => {
  const assertKeys=source=>{
    for(const [key,value]of Object.entries(source||{})){
      if(forbidden.has(key))throw new Error('Unsupported viewer settings key.');
      if(value&&typeof value==='object'&&!Array.isArray(value))assertKeys(value);
    }
  };
  for(const layer of layers)assertKeys(layer);
  return layers.reduce((result,layer)=>mergeConfig(result,layer||{}),{});
};

export const emptyViewerPreferences = repoId => ({schemaVersion:VIEWER_SETTINGS_VERSION,repoId,revision:0,preferences:{base:{},layouts:{}}});
export const validateViewerPreferences = (input, repoId) => {
  if(input?.schemaVersion!==VIEWER_SETTINGS_VERSION||input.repoId!==repoId||!Number.isSafeInteger(input.revision)||input.revision<0)throw new Error('Viewer preferences have an unsupported version, repository or revision.');
  const base=sanitizeViewerSettings(input.preferences?.base||{}),layouts={};
  for(const [layout,settings]of Object.entries(input.preferences?.layouts||{})){
    assertLayout(layout);
    layouts[layout]=sanitizeViewerSettings(settings);
  }
  const document={schemaVersion:VIEWER_SETTINGS_VERSION,repoId,revision:input.revision,preferences:{base,layouts}};
  if(new TextEncoder().encode(JSON.stringify(document)).length>VIEWER_SETTINGS_MAX_BYTES)throw new Error('Viewer preferences exceed 64 KiB.');
  return document;
};

/** Defaults < report < durable repository base < selected-layout override. */
export const resolveEffectiveViewerSettings = ({defaults={},report={},document=null,layout='stacks'}) =>
  mergeViewerSettings(defaults,report,document?.preferences.base,document?.preferences.layouts?.[assertLayout(layout)]);

const preferenceKey = value => JSON.stringify((function stable(entry) {
  return entry && typeof entry === 'object' ? Object.keys(entry).sort().map(key => [key, stable(entry[key])]) : entry;
})(value));
const retiredSettings = () => new DOMException('Viewer settings session retired.', 'AbortError');

export const createViewerSettingsSession = ({repoId,report={},document=emptyViewerPreferences(repoId),persist=null,onStatus=()=>{}}) => {
  let accepted=validateViewerPreferences(document,repoId),preferences=clone(accepted.preferences),epoch=0,timer=null,queue=Promise.resolve();
  let status=persist?'saved':'session-only',retired=false,retirement=null,lastFailure=null;
  const setStatus=next=>{if(!retired){status=next;try{onStatus(next);}catch(error){retain(error);throw error;}}};
  const assertCurrent=()=>{if(retired||resourceOwner.lastError!==null)throw retiredSettings();};
  const clearSaveTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const retireIntent=()=>{if(!retired){retired=true;epoch++;status='retired';}clearSaveTimer();};
  const resourceOwner=captureSceneResource({async dispose(){retireIntent();await queue.catch(()=>{});}},'original viewer preference operations');
  const retain=error=>{lastFailure=error;resourceOwner.retainFailure(error);};
  const save=()=>{
    if(retired)return Promise.reject(retiredSettings());
    clearSaveTimer();
    if(!persist){try{setStatus('session-only');return Promise.resolve(null);}catch(error){return Promise.reject(error);}}
    const requested=clone(preferences),requestedKey=preferenceKey(requested),version=epoch;
    queue=queue.catch(()=>{}).then(async()=>{
      assertCurrent();let committed=false,revision=null;
      try{
        setStatus('saving');assertCurrent();
        const before=accepted.revision;
        if(before===Number.MAX_SAFE_INTEGER)throw new Error('Viewer preference revision is exhausted.');
        const next=validateViewerPreferences(await persist({schemaVersion:VIEWER_SETTINGS_VERSION,repoId,revision:before,preferences:requested}),repoId);
        if(next.revision!==before+1||preferenceKey(next.preferences)!==requestedKey)throw new Error('Viewer preference response does not confirm the original requested update.');
        committed=true;revision=next.revision;
        if(retired)return next;
        accepted=next;
        if(version===epoch)setStatus('saved');else setStatus('modified');
        return next;
      }catch(error){
        retain(error);const captured=captureSceneFailure(error),errors=[];
        if(!retired){
          status=`save-failed: ${captured.message}`;
          try{onStatus(status);}catch(diagnostic){errors.push(diagnostic);retain(diagnostic);}
        }
        const failure=preserveSceneCleanupFailures(error,errors,{hasPrimary:true,forceAggregate:true});
        if(committed)Object.defineProperties(failure,{viewerPreferencesCommitted:{value:true},viewerPreferencesRevision:{value:revision}});
        retain(failure);throw failure;
      }
    });
    return queue;
  };
  return {
    get status(){return status;},
    get retired(){return retired;},
    get lastFailure(){return lastFailure;},
    resourceOwner,
    get document(){return {...accepted,preferences:clone(preferences)};},
    effective(layout){return resolveEffectiveViewerSettings({report,document:{preferences},layout});},
    update(settings,{layout=null}={}){
      assertCurrent();if(layout!==null)assertLayout(layout);
      const next=sanitizeViewerSettings(settings);
      if(layout!==null)preferences.layouts[layout]=next;else preferences.base=next;
      epoch++;setStatus(persist?'modified':'session-only');
    },
    reset({layout=null}={}){
      assertCurrent();if(layout!==null)assertLayout(layout);clearSaveTimer();
      if(layout!==null)delete preferences.layouts[layout];else preferences={base:{},layouts:{}};
      epoch++;setStatus(persist?'modified':'session-only');
    },
    scheduleSave(delay=200){assertCurrent();clearSaveTimer();timer=setTimeout(()=>{timer=null;save().catch(()=>{});},delay);},
    save,
    dispose(){
      retireIntent();
      if(!retirement)retirement=Promise.resolve().then(()=>resourceOwner.retireAsync());
      return retirement;
    }
  };
};

