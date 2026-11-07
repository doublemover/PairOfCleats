// Renderer-neutral semantic and composition tokens. Quality never changes scope.
export const APPEARANCE_COMPONENTS = Object.freeze({
  palettes:{
    tron:{background:'#050B16',tray:'#102039',grid:'#18334C',
      kinds:{callable:'#37E6FF',type:'#B68CFF',value:'#FFBD5C',other:'#93ABC7'},
      files:{source:'#326BFF',test:'#B68CFF',config:'#37E6FF',docs:'#FFBD5C',generated:'#526079',other:'#67829D'}},
    crisp:{background:'#07111D',tray:'#16283B',grid:'#24384C',
      kinds:{callable:'#69DDD0',type:'#C0B0FF',value:'#FFD080',other:'#C3D0DF'},
      files:{source:'#74A7EB',test:'#B8A0E0',config:'#73CDBE',docs:'#E7BC84',generated:'#8D9BAE',other:'#9EB3CC'}}
  },
  materials:{neon:{roughness:0.48,metalness:0.2,emissive:0.18},crisp:{roughness:0.75,metalness:0.06,emissive:0.04}},
  lighting:{night:{exposure:1.1,key:1.1,sun:0.5,ambient:0.5},studio:{exposure:1.25,key:1.2,sun:0.35,ambient:0.75}},
  motion:['system','off','on'],quality:['balanced','high','low-power']
});
export const TRON_APPEARANCE = Object.freeze({palette:'tron',material:'neon',lighting:'night',motion:'system',quality:'balanced'});

export const resolveAppearance = (requested={}, {layout='stacks',reducedMotion=false}={}) => {
  const choice={...TRON_APPEARANCE,...requested},unavailable=[];
  for(const key of ['palette','material','lighting'])if(!APPEARANCE_COMPONENTS[`${key}s`]?.[choice[key]] && !(key==='lighting'&&APPEARANCE_COMPONENTS.lighting[choice[key]])){
    unavailable.push(`${key}: ${choice[key]} is unavailable; using the built-in composition.`);choice[key]=TRON_APPEARANCE[key];
  }
  if(!APPEARANCE_COMPONENTS.motion.includes(choice.motion))choice.motion='system';
  if(!APPEARANCE_COMPONENTS.quality.includes(choice.quality))choice.quality='balanced';
  if(choice.quality==='high')unavailable.push('Selective bloom/refraction is not qualified for this backend; high currently uses the balanced material path.');
  return {choice,palette:APPEARANCE_COMPONENTS.palettes[choice.palette],material:APPEARANCE_COMPONENTS.materials[choice.material],
    lighting:APPEARANCE_COMPONENTS.lighting[choice.lighting],motion:choice.motion==='on'||(choice.motion==='system'&&!reducedMotion),
    pixelRatioCap:choice.quality==='low-power'?1:1.25,unavailable,
    capabilities:{layout,solidSemanticCores:true,selectiveBloom:false,refractiveCapture:false,spatialBatchQualification:false}};
};
