let serial=0;
const documents=new WeakMap();

/** One removal observer per document, shared by bounded source-panel owners. */
const observeRemoval=(host,removed)=>{
  const document=host.ownerDocument,Observer=document.defaultView?.MutationObserver;
  if(typeof Observer!=='function')return ()=>{};
  let registry=documents.get(document);
  if(!registry){
    const entries=new Set(),observer=new Observer(()=>{
      for(const entry of entries){
        if(entry.host.isConnected)entry.connected=true;
        else if(entry.connected)entry.removed();
      }
    });
    registry={entries,observer};documents.set(document,registry);observer.observe(document,{childList:true,subtree:true});
  }
  const entry={host,removed,connected:host.isConnected};registry.entries.add(entry);
  return ()=>{registry.entries.delete(entry);if(!registry.entries.size){registry.observer.disconnect();documents.delete(document);}};
};

/** Operation lanes belong to the actual panel, not to a globally shared kind. */
export const createSourceViewRequestOwner = ({host,request}) => {
  const id=++serial,controller=new AbortController();let retired=false;
  let unregister=()=>{};
  const dispose=()=>{if(retired)return;retired=true;controller.abort(new DOMException('Source panel retired.','AbortError'));unregister();};
  unregister=observeRemoval(host,dispose);
  return {
    query(kind,payload,options={}){
      if(retired)return Promise.reject(new DOMException('Source panel retired.','AbortError'));
      return request(kind,payload,{...options,lane:`source-view:${id}:${kind}`,signal:controller.signal});
    },
    get retired(){return retired;},
    dispose
  };
};
