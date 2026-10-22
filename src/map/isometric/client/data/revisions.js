export const MAP_DATA_PROTOCOL = 1;
const families=['source','query','layout','residency','style','visibility','selection','camera'];

export const createViewRevisions = snapshot => {
  const revisions=Object.fromEntries(families.map(key=>[key,0])),pending=new Map();
  let serial=0,retired=false;
  const matches=stamp=>!retired&&stamp.protocol===MAP_DATA_PROTOCOL&&stamp.snapshot===snapshot
    &&Object.entries(stamp.dependencies).every(([key,value])=>revisions[key]===value);
  return {
    snapshot,
    bump(family){if(!(family in revisions))throw new Error(`Unknown map revision family ${family}`);return ++revisions[family];},
    capture(dependencies=families){return {protocol:MAP_DATA_PROTOCOL,snapshot,request:++serial,
      dependencies:Object.fromEntries(dependencies.map(key=>[key,revisions[key]]))};},
    begin(lane,dependencies){
      pending.get(lane)?.controller.abort();
      const operation={stamp:this.capture(dependencies),controller:new AbortController()};pending.set(lane,operation);
      return {stamp:operation.stamp,signal:operation.controller.signal,
        cancel:()=>operation.controller.abort(),
        current:()=>pending.get(lane)===operation&&!operation.controller.signal.aborted&&matches(operation.stamp),
        finish:()=>{if(pending.get(lane)===operation)pending.delete(lane);}};
    },
    matches,
    dispose(){if(retired)return;retired=true;for(const operation of pending.values())operation.controller.abort();pending.clear();}
  };
};
