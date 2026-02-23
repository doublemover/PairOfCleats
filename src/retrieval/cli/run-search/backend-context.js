import { createBackendContext } from '../backend-context.js';

/**
 * Build backend runtime context and consistently attribute timing samples.
 *
 * @param {{
 *   stageTracker:{mark:()=>number,record:(name:string,start:number,meta:object)=>void},
 *   contextInput:object,
 *   stageName?:string
 * }} input
 * @returns {Promise<object>}
 */
export const createBackendContextWithTracking = async ({
  stageTracker,
  contextInput,
  stageName = 'startup.backend'
}) => {
  const backendStart = stageTracker.mark();
  const context = await createBackendContext(contextInput);
  stageTracker.record(stageName, backendStart, { mode: 'all' });
  return context;
};
