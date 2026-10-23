import { captureSceneResource } from './scene-retirement.js';

const button=(document,label,action)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=action;return node;};

/** Existing controls move into one active task surface; the semantic owners stay shared. */
export const initViewerShell = (state, document) => {
  if(state.viewerShell)return state.viewerShell;
  const app=document.getElementById('app'),bar=document.getElementById('stack-bar'),menu=document.getElementById('menu'),inspector=document.getElementById('hud');
  const scope=document.getElementById('summary');scope.classList.add('viewer-scope-chip');bar.append(scope);
  const surface=document.createElement('div');surface.className='viewer-task-content';
  const heading=document.createElement('div');heading.className='viewer-task-heading';
  const title=document.createElement('strong'),status=document.createElement('div');status.id='viewer-save-status';status.setAttribute('role','status');status.textContent='Session settings';
  const panels={Explore:document.createElement('section'),Appearance:document.createElement('section'),Performance:document.createElement('section')};
  const movable=[...menu.children];
  for(const node of movable){
    const ids=[node.id,...[...node.querySelectorAll('[id]')].map(child=>child.id)];
    const task=ids.some(id=>['menu-visuals','menu-effects','menu-actions','menu-score','menu-colors','menu-color-mode'].includes(id))?'Appearance':
      ids.some(id=>['menu-performance','menu-controls'].includes(id))?'Performance':'Explore';
    panels[task].append(node);
  }
  menu.replaceChildren(heading,surface,status);
  for(const panel of Object.values(panels)){panel.hidden=true;surface.append(panel);}
  let active=null,pinned=false,opener=null,inspectDismissed=false,retired=false,settingsOwner=null;
  const retirementFailures=[];
  const retire=owner=>{owner?.retireAsync().catch(error=>retirementFailures.push(error));};
  const triggers=new Map();
  const choose=(name,{focus=false}={})=>{
    if(retired)return false;
    active=name;menu.hidden=!name||name==='Inspect';inspector.hidden=name!=='Inspect';title.textContent=name||'';
    for(const [task,panel]of Object.entries(panels))panel.hidden=task!==name;
    for(const [task,trigger]of triggers)trigger.setAttribute('aria-expanded',String(task===name));
    state.invalidateRender?.();
    if(focus){const target=name==='Explore'?document.getElementById('stack-search'):name==='Inspect'?inspector:panels[name];target?.focus?.({preventScroll:true});}
  };
  const close=()=>{
    if(retired)return;
    const host=active==='Inspect'?inspector:menu,restore=host.contains(document.activeElement);
    if(active==='Inspect')inspectDismissed=true;
    choose(null);if(restore)opener?.focus?.({preventScroll:true});
  };
  heading.append(title,button(document,'Close panel',close),button(document,'Pin panel',event=>{
    pinned=!pinned;event.currentTarget.setAttribute('aria-pressed',String(pinned));event.currentTarget.textContent=pinned?'Unpin panel':'Pin panel';
  }));
  const inspectorClose=button(document,'Close inspector',close);inspector.prepend(inspectorClose);inspector.tabIndex=-1;
  for(const name of ['Explore','Inspect','Appearance','Performance']){
    panels[name]?.setAttribute('aria-label',name);
    if(panels[name])panels[name].tabIndex=-1;
    const trigger=button(document,name,()=>{opener=trigger;if(active===name&&!pinned)close();else{if(name==='Inspect')inspectDismissed=false;choose(name,{focus:name==='Explore'});}});
    trigger.setAttribute('aria-expanded','false');triggers.set(name,trigger);bar.append(trigger);
  }
  const help=document.createElement('dialog');help.id='viewer-help';
  const helpTitle=document.createElement('h2');helpTitle.textContent='Explore the available map snapshot';
  const helpText=document.createElement('p');helpText.textContent='Explore searches and pages all available saved files and members. Selection and source inspection work outside drawn scope. Fit all fits represented visible geometry; Detail chooses semantic relationship resolution. Drag or WASD pans, wheel zooms. With the viewport focused: F focuses selection, Home fits, Escape clears, Enter opens configured source. Motion follows your system unless changed. Pipes represent directed source relationships, not runtime execution.';
  help.append(helpTitle,helpText,button(document,'Close help',()=>help.close()));app.append(help);
  bar.append(button(document,'Help',()=>help.showModal()));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active&&(menu.contains(event.target)||inspector.contains(event.target))){event.preventDefault();event.stopPropagation();close();}});
  app.classList.add('scene-first-workspace');
  const measure=()=>{if(!retired)app.style.setProperty('--viewer-header-height',`${Math.max(56,bar.getBoundingClientRect().height)}px`);};
  const ResizeObserver=document.defaultView?.ResizeObserver;
  const observer=ResizeObserver?new ResizeObserver(measure):null;
  const observerOwner=observer?captureSceneResource(observer,'original viewer shell resize observation','disconnect',[],{required:true}):null;
  observer?.observe(bar);measure();
  document.defaultView?.addEventListener('pagehide',()=>{retired=true;retire(observerOwner);retire(settingsOwner);},{once:true});
  const detail=document.getElementById('stack-mode')?.parentElement;if(detail?.firstChild?.nodeType===3)detail.firstChild.textContent='Detail ';
  state.revealInspector=()=>{if(!active&&!inspectDismissed&&!pinned)choose('Inspect');};
  state.viewerShell={choose,close,setSaveStatus:value=>{if(!retired)status.textContent=value;},get active(){return active;},get retired(){return retired;},
    get retirementFailures(){return Object.freeze([...retirementFailures]);},
    get pendingOwners(){return Object.freeze([observerOwner,settingsOwner].filter(owner=>owner?.pending));},
    adoptSettings(session){
      if(settingsOwner&&settingsOwner.resource!==session)throw new Error('Viewer shell already owns its original settings session.');
      if(!settingsOwner)settingsOwner=captureSceneResource(session,'original viewer shell settings session','dispose',[],{required:true});
      if(retired){retire(settingsOwner);return false;}
      settingsOwner.assertCaptured();return true;
    }};
  choose(null);
  return state.viewerShell;
};
