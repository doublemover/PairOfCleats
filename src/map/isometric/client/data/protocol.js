import { MAP_DATA_PROTOCOL } from './revisions.js';
import { readMapJsonBody } from './response-body.js';

export { MAP_DATA_PROTOCOL };
export const SNAPSHOT_PAGE_LIMITS=Object.freeze({rows:256,responseBytes:256*1024,requestBytes:16*1024,inFlight:2});
// Source IDs retain their type and punctuation. Dense rows and render slots are
// implementation addresses, never a serialized replacement for these keys.
export const sourceEntityKey = (type,value) => JSON.stringify([type,typeof value,value]);
export const snapshotRequest = ({snapshot,request,revision=0,kind,cursor=0,limit=80,...fields}) => {
  if(typeof snapshot!=='string'||!snapshot||snapshot.length>256)throw new Error('Pinned snapshot identity required.');
  if(!Number.isSafeInteger(request)||request<1||!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid snapshot request/revision.');
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>SNAPSHOT_PAGE_LIMITS.rows)throw new Error('Invalid bounded snapshot cursor/limit.');
  return {protocol:MAP_DATA_PROTOCOL,snapshot,request,revision,kind,cursor,limit,...fields};
};
export const acceptSnapshotResponse = (response,request) => {
  if(!response||response.protocol!==MAP_DATA_PROTOCOL||response.snapshot!==request.snapshot
    ||response.request!==request.request||response.revision!==request.revision||response.kind!==request.kind)throw new Error('Stale or mismatched map snapshot response.');
  if(response.error)throw new Error(response.error);
  return response;
};

export const readBoundedJsonResponse = (response,{signal,maxBytes=SNAPSHOT_PAGE_LIMITS.responseBytes}={}) => readMapJsonBody(response, {
  signal, maxBytes, budgetMessage: 'Snapshot response exceeds its byte budget.',
  assertResponse: original => { if (!/^application\/json(?:;|$)/i.test(original.headers.get('content-type') || '')) throw new Error('Snapshot transport requires JSON.'); },
  assertValue: (value, original) => { if (!original.ok) throw new Error(typeof value?.error === 'string' ? value.error : `Snapshot transport returned ${original.status}.`); }
});
