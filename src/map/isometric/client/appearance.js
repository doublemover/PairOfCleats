import { resolveAppearance, TRON_APPEARANCE, APPEARANCE_COMPONENTS } from './appearance-presets.js';
import { segmentKind } from './stack-model.js';
import { applyHighlights } from './selection.js';

export const applyViewerAppearance = (state, requested = state.appearance || TRON_APPEARANCE) => {
  const resolved=resolveAppearance(requested,{layout:state.layout.style,reducedMotion:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  state.appearance={...resolved.choice};state.effectiveAppearance=resolved;state.motionOverride=resolved.choice.motion;
  const {THREE}=state;
  if(!THREE)return resolved;
  if(state.scene)state.scene.background=new THREE.Color(resolved.palette.background);
  if(state.renderer)state.renderer.toneMappingExposure=resolved.lighting.exposure;
  if(state.mainLight)state.mainLight.intensity=resolved.lighting.key;
  if(state.sunLight)state.sunLight.intensity=resolved.lighting.sun;
  if(state.ambientLight)state.ambientLight.intensity=resolved.lighting.ambient;
  const material=(mesh,color)=>{
    const value=mesh.material;if(!value?.isMeshStandardMaterial)return;
    value.roughness=resolved.material.roughness;value.metalness=resolved.material.metalness;
    value.emissive.set(value.userData?.packetOwned?'#ffffff':color);value.emissiveIntensity=resolved.material.emissive;
  };
  if(state.layoutStyle==='stacks'){
    for(const mesh of [...state.fileInstancedMeshes,...state.memberInstancedMeshes]){
      for(const [index,info]of (mesh.userData.instanceInfo||[]).entries()){
        if(!info)continue;
        const source=state.sourceIndex?.files.get(info.file),member=(state.sourceIndex?.member?.(info.id)||state.sourceIndex?.members.get(String(info.id)))?.member;
        const color=info.type==='member'?resolved.palette.kinds[member?segmentKind(member):info.semanticKind||'other']:resolved.palette.files[source?.category]||resolved.palette.files.other;
        const value=new THREE.Color(color);mesh.setColorAt(index,value);info.baseColor=value.clone();
        if(info.type==='member'&&info.id!=null)state.memberColorById.set(info.id,value);else if(info.type==='file')state.fileColorByPath.set(info.file,value);
        material(mesh,color);
      }
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
    for(const child of state.fileGroup?.children||[])if(child.userData?.type==='directory'){
      child.material.color.set(resolved.palette.tray);child.material.emissive.set(resolved.palette.tray);child.material.emissiveIntensity=0.05;
    }
  }
  for(const value of state.gridLineMaterials||[])value.color.set(resolved.palette.grid);
  for(const item of globalThis.document?.querySelectorAll?.('[data-stack-kind]')||[])item.style.color=resolved.palette.kinds[item.dataset.stackKind];
  if(state.renderer&&state.getViewport){
    const viewport=state.getViewport();state.renderer.setPixelRatio(Math.min(resolved.pixelRatioCap,state.visuals.pixelRatioCap||resolved.pixelRatioCap,window.devicePixelRatio||1));
    state.renderer.setSize(viewport.width,viewport.height);
  }
  state.invalidateRender?.();
  if(state.selectedInfo||state.hoveredRef||state.hovered)applyHighlights();
  return resolved;
};

export const initAppearanceEditor = (state, document, container) => {
  const panel=document.createElement('section');panel.className='appearance-composition';
  const heading=document.createElement('h3');heading.textContent='Tron composition';panel.append(heading);
  const explanation=document.createElement('p');explanation.textContent='Choose each component independently. Quality changes decorative cost and leaves source scope intact.';panel.append(explanation);
  const effective=document.createElement('p');effective.setAttribute('role','status');
  let before={...(state.appearance||TRON_APPEARANCE)};
  const refresh=()=>{effective.textContent=state.effectiveAppearance?.unavailable.join(' ')||`Effective ${state.appearance?.quality||'balanced'} · solid semantic cores · static direction arrows`;};
  const controls=[];
  for(const family of ['palette','material','lighting','motion','quality']){
    const label=document.createElement('label');label.textContent=`${family[0].toUpperCase()+family.slice(1)} `;
    const select=document.createElement('select');
    const values=family==='palette'?Object.keys(APPEARANCE_COMPONENTS.palettes):family==='material'?Object.keys(APPEARANCE_COMPONENTS.materials):family==='lighting'?Object.keys(APPEARANCE_COMPONENTS.lighting):APPEARANCE_COMPONENTS[family];
    for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
    select.value=state.appearance?.[family]||TRON_APPEARANCE[family];
    select.onchange=()=>{before={...state.appearance};state.setAppearance?.({...state.appearance,[family]:select.value});refresh();};
    label.append(select);panel.append(label);controls.push([family,select]);
  }
  const revert=document.createElement('button');revert.type='button';revert.textContent='Undo last appearance edit';revert.onclick=()=>{const current={...state.appearance};state.setAppearance?.(before);before=current;for(const [family,select]of controls)select.value=state.appearance[family];refresh();};
  panel.append(revert,effective);container.prepend(panel);refresh();
};
