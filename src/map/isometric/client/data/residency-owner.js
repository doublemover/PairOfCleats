import { state } from '../state.js';
import { createViewRevisions } from './revisions.js';
import { planSourceResidency } from './residency.js';
import { createRendererBoundary, rendererCapabilities } from '../rendering/boundary.js';
import { prepareResidentScene, commitResidentScene, retireResidentScene } from '../rendering/resident-scene.js';
import { focusStack } from '../stack-navigation.js';
import { hydrateSnapshotLayout } from './hydrate-layout.js';
import { getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { describeRendererFailure } from '../rendering/failure-state.js';

export const initResidencyOwner = () => {
  state.disposeResidency?.();
  const source=state.sourceIndex;
  const revisions=createViewRevisions(source.snapshot);
  const boundary=createRendererBoundary({prepare:prepareResidentScene,commit:commitResidentScene,retire:retireResidentScene,
    capabilities:rendererCapabilities({renderer:state.renderer,packetPolicy:state.stackPacketPolicy})});
  state.viewRevisions=revisions;state.rendererBoundary=boundary;
  const ownsView=()=>state.viewRevisions===revisions&&state.sourceIndex===source;
  let statusOwner=null;
  const reveal=async(selection=state.selectedInfo)=>{
    if(!ownsView())return {committed:false,reason:'superseded'};
    const owned=revisions.begin('resident-reveal',['source','layout','residency','selection','camera']);
    let finished=false;
    const operation={...owned,current:()=>owned.current()&&state.sourceIndex===source&&state.layoutStyle==='stacks',
      finish:()=>{if(finished)return;finished=true;owned.finish();}};
    const status={baseline:statusOwner?.baseline??state.dom.summary.textContent};statusOwner=status;
    const ownsStatus=()=>statusOwner===status&&ownsView();
    let published=false,residencyBumped=false;
    state.dom.summary.textContent='Preparing selected source evidence in the bounded render working set…';
    try{
      const budgets={current:state.stackModel?.files.map(file=>file.key)||[],
        files:Math.min(state.performance.drawCaps.files,state.displayLimits.maxFiles),members:state.performance.drawCaps.members,
        membersPerFile:state.displayLimits.maxMembersPerFile,edges:state.performance.drawCaps.edges};
      let plan;
      if(state.remoteSource){
        const result=await state.remoteSource.request('layout',{selection,budgets,layout:{scale:state.scaleFactor||1,groupDepth:state.layout.groupDepth||1}},
          {revision:operation.stamp.request,signal:operation.signal});
        operation.signal.throwIfAborted();if(!operation.current())return {committed:false,reason:'superseded'};
        plan={...result.plan,model:result.model};
      }else plan=planSourceResidency(source,selection,budgets);
      if(!state.remoteSource&&state.graphWorkerReady){
        const result=await state.graphWorkerClient.request('layout',{selection,budgets:{...plan.limits,current:state.stackModel?.files.map(file=>file.key)||[]},
          layout:{scale:state.scaleFactor||1,groupDepth:state.layout.groupDepth||1}},{revision:operation.stamp.request,signal:operation.signal});
        operation.signal.throwIfAborted();
        if(!operation.current())return {committed:false,reason:'superseded'};
        plan.model=hydrateSnapshotLayout(result.model,source,plan);
      }
      if(state.sourceIndex!==source)throw new Error('Source snapshot changed before reveal.');
      const result=await boundary.transact(operation,plan);
      published=result.committed;
      if(!ownsView())return result;
      if(published){revisions.bump('residency');residencyBumped=true;focusStack(plan.selected);if(ownsStatus())state.dom.summary.textContent=`Available snapshot ${source.counts.files} files / ${source.counts.members} members. Resident ${plan.coverage.resident.files} files / ${plan.coverage.resident.members} members; nonresident evidence remains searchable.`;}
      else if(ownsStatus()&&state.dom.summary.textContent.startsWith('Preparing selected'))state.dom.summary.textContent=status.baseline;
      return result;
    }catch(error){
      const committed=published||error?.rendererTransactionCommitted===true,description=describeRendererFailure(error);
      if(ownsView()){
        state.rendererFailure=error;
        if(error?.sceneOwnershipPending===true){state.sceneRetirementFailure=error;state.sceneRetirementError=description;state.sceneRetirementOwners=getPendingSceneResourceOwners();}
        if(committed&&!residencyBumped)revisions.bump('residency');
      }
      if(ownsStatus()&&(committed||!operation.signal.aborted))state.dom.summary.textContent=committed
        ?`Resident evidence committed; renderer follow-up failed: ${description}`:`Reveal did not replace the prior scene: ${description}`;
      return {committed,reason:committed?'renderer-follow-up':operation.signal.aborted?'cancelled':description,error,stamp:operation.stamp};
    }finally{
      if(statusOwner===status){if(ownsView()&&state.dom.summary.textContent.startsWith('Preparing selected'))state.dom.summary.textContent=status.baseline;statusOwner=null;}
      operation.finish();
    }
  };
  state.revealSourceSelection=reveal;
  state.cancelResidentPreparation=()=>{revisions.bump('layout');};
  state.resetResidency=()=>{revisions.bump('residency');state.residentFiles=null;state.residentEdges=null;state.residencyCoverage=null;state.remoteSource?.registerPlan({nodes:[]});};
  const dispose=()=>{
    statusOwner=null;const errors=[];
    try{boundary.dispose();}catch(error){errors.push(error);}
    try{revisions.dispose();}catch(error){errors.push(error);}
    if(state.viewRevisions===revisions){state.viewRevisions=null;state.revealSourceSelection=null;state.cancelResidentPreparation=null;state.resetResidency=null;}
    if(state.rendererBoundary===boundary)state.rendererBoundary=null;
    if(state.disposeResidency===dispose)state.disposeResidency=null;
    const failure=preserveSceneCleanupFailures(null,errors);if(failure)throw failure;
  };
  state.disposeResidency=dispose;
  state.rendererCapabilities=boundary.capabilities;
  if(state.selectedInfo){const info=state.selectedInfo;state.onSelectionChanged?.(info);}
  return {reveal,dispose,revisions,boundary};
};
