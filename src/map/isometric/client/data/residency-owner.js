import { state } from '../state.js';
import { createViewRevisions } from './revisions.js';
import { planSourceResidency } from './residency.js';
import { createRendererBoundary, rendererCapabilities } from '../rendering/boundary.js';
import { prepareResidentScene, commitResidentScene, retireResidentScene } from '../rendering/resident-scene.js';
import { focusStack } from '../stack-navigation.js';
import { hydrateSnapshotLayout } from './hydrate-layout.js';

export const initResidencyOwner = () => {
  state.disposeResidency?.();
  const source=state.sourceIndex;
  const revisions=createViewRevisions(source.snapshot);
  const boundary=createRendererBoundary({prepare:prepareResidentScene,commit:commitResidentScene,retire:retireResidentScene,
    capabilities:rendererCapabilities({renderer:state.renderer})});
  state.viewRevisions=revisions;state.rendererBoundary=boundary;
  const reveal=async(selection=state.selectedInfo)=>{
    const owned=revisions.begin('resident-reveal',['source','layout','residency','selection','camera']);
    const operation={...owned,current:()=>owned.current()&&state.sourceIndex===source&&state.layoutStyle==='stacks'};
    const oldStatus=state.dom.summary.textContent;
    state.dom.summary.textContent='Preparing selected source evidence in the bounded render working set…';
    try{
      const plan=planSourceResidency(source,selection,{current:state.stackModel?.files.map(file=>file.key)||[],
        files:Math.min(state.performance.drawCaps.files,state.displayLimits.maxFiles),members:state.performance.drawCaps.members,
        membersPerFile:state.displayLimits.maxMembersPerFile,edges:state.performance.drawCaps.edges});
      if(state.graphWorkerReady){
        const result=await state.graphWorkerClient.request('layout',{selection,budgets:{...plan.limits,current:state.stackModel?.files.map(file=>file.key)||[]},
          layout:{scale:state.scaleFactor||1,groupDepth:state.layout.groupDepth||1}},{revision:operation.stamp.request,signal:operation.signal});
        operation.signal.throwIfAborted();
        if(!operation.current())return {committed:false,reason:'superseded'};
        plan.model=hydrateSnapshotLayout(result.model,source,plan);
      }
      if(state.sourceIndex!==source)throw new Error('Source snapshot changed before reveal.');
      const result=await boundary.transact(operation,plan);
      if(result.committed){revisions.bump('residency');focusStack(plan.selected);state.dom.summary.textContent=`Available snapshot ${source.counts.files} files / ${source.counts.members} members. Resident ${plan.coverage.resident.files} files / ${plan.coverage.resident.members} members; nonresident evidence remains searchable.`;}
      else if(state.dom.summary.textContent.startsWith('Preparing selected'))state.dom.summary.textContent=oldStatus;
      return result;
    }catch(error){
      if(!operation.signal.aborted)state.dom.summary.textContent=`Reveal did not replace the prior scene: ${error.message}`;
      return {committed:false,reason:operation.signal.aborted?'cancelled':error.message};
    }finally{if(operation.signal.aborted&&state.dom.summary.textContent.startsWith('Preparing selected'))state.dom.summary.textContent=oldStatus;operation.finish();}
  };
  state.revealSourceSelection=reveal;
  state.cancelResidentPreparation=()=>{revisions.bump('layout');};
  state.resetResidency=()=>{revisions.bump('residency');state.residentFiles=null;state.residentEdges=null;state.residencyCoverage=null;};
  state.disposeResidency=()=>{boundary.dispose();revisions.dispose();if(state.viewRevisions===revisions){state.viewRevisions=null;state.revealSourceSelection=null;state.cancelResidentPreparation=null;state.resetResidency=null;}};
  state.rendererCapabilities=boundary.capabilities;
  if(state.selectedInfo){const info=state.selectedInfo;state.onSelectionChanged?.(info);}
  return {reveal,dispose:state.disposeResidency,revisions,boundary};
};
