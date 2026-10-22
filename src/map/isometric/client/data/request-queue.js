import { SNAPSHOT_PAGE_LIMITS } from './protocol.js';

const cancelled=message=>new DOMException(message,'AbortError');

/** Bounded physical concurrency; cancelled work keeps its slot until settled. */
export const createSnapshotRequestQueue = ({inFlight=SNAPSHOT_PAGE_LIMITS.inFlight,queued=16}={}) => {
  if(!Number.isInteger(inFlight)||inFlight<1||!Number.isInteger(queued)||queued<0)throw new Error('Finite snapshot request budgets required.');
  const queue=[],entries=new Set(),lanes=new Map();
  const metrics={started:0,settled:0,superseded:0,rejectedAtCapacity:0,peakRunning:0,peakQueued:0};
  let running=0,retired=false;
  const settle=(entry,error,value)=>{
    if(entry.settled)return;entry.settled=true;entry.cleanup();
    if(lanes.get(entry.lane)===entry)lanes.delete(entry.lane);
    if(error)entry.reject(error);else entry.resolve(value);
  };
  const cancel=(entry,reason)=>{
    if(entry.settled)return;entry.controller.abort(reason);settle(entry,reason);
    if(!entry.running){const position=queue.indexOf(entry);if(position>=0)queue.splice(position,1);entries.delete(entry);}
  };
  const execute=async entry=>{
    try{entry.controller.signal.throwIfAborted();settle(entry,null,await entry.run(entry.controller.signal));}
    catch(error){settle(entry,error);}
    finally{running--;metrics.settled++;entries.delete(entry);pump();}
  };
  const pump=()=>{
    if(retired)return;
    while(running<inFlight&&queue.length){
      const entry=queue.shift();if(entry.settled)continue;
      entry.running=true;running++;metrics.started++;metrics.peakRunning=Math.max(metrics.peakRunning,running);void execute(entry);
    }
  };
  return {
    request({lane,signal,run}){
      if(retired)return Promise.reject(new Error('Snapshot request queue has retired.'));
      if(typeof lane!=='string'||!lane||typeof run!=='function')return Promise.reject(new Error('Snapshot operation lane and runner required.'));
      if(signal?.aborted)return Promise.reject(signal.reason||cancelled('Snapshot request cancelled.'));
      const previous=lanes.get(lane);if(previous){metrics.superseded++;cancel(previous,cancelled('Superseded snapshot operation.'));}
      if(running>=inFlight&&queue.length>=queued){metrics.rejectedAtCapacity++;return Promise.reject(new Error('Snapshot request queue is full. Close a pending source panel or retry after it settles.'));}
      return new Promise((resolve,reject)=>{
        const entry={lane,run,resolve,reject,controller:new AbortController(),settled:false,running:false,cleanup:()=>signal?.removeEventListener('abort',abort)};
        const abort=()=>{cancel(entry,signal.reason||cancelled('Snapshot request cancelled.'));pump();};
        signal?.addEventListener('abort',abort,{once:true});entries.add(entry);lanes.set(lane,entry);queue.push(entry);
        pump();metrics.peakQueued=Math.max(metrics.peakQueued,queue.length);
      });
    },
    stats(){return {...metrics,running,queued:queue.length,inFlightBudget:inFlight,queueBudget:queued};},
    dispose(reason=cancelled('Snapshot request owner retired.')){if(retired)return;retired=true;for(const entry of entries)cancel(entry,reason);queue.length=0;lanes.clear();}
  };
};
