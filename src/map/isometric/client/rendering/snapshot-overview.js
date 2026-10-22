import { state } from '../state.js';
import { createShapeGeometry } from '../layout.js';
import { createTextPlane, applyHeightFog } from '../materials.js';

/** Real directory aggregates, explicitly distinct from source file/member geometry. */
export const buildSnapshotOverview = (manifest,{createLabel=createTextPlane}={}) => {
  if(state.residentFiles||!state.THREE)return;
  const rows=manifest.overview||[],columns=Math.max(1,Math.ceil(Math.sqrt(rows.length))),spacing=14*(state.scaleFactor||1);
  rows.forEach((row,ordinal)=>{
    const x=(ordinal%columns-(columns-1)/2)*spacing,z=(Math.floor(ordinal/columns)-(Math.ceil(rows.length/columns)-1)/2)*spacing;
    const height=Math.max(1,Math.log2(1+row.files))*0.4*(state.scaleFactor||1);
    const material=new state.THREE.MeshStandardMaterial({color:'#163d66',emissive:'#103653',emissiveIntensity:0.15,roughness:0.7});applyHeightFog(material);
    const mesh=new state.THREE.Mesh(createShapeGeometry('square'),material);mesh.position.set(x,height/2,z);mesh.scale.set(spacing*.7,height,spacing*.7);
    mesh.userData={type:'snapshotAggregate',directory:row.key,all:row.all===true,availableFiles:row.files,availableMembers:row.members,snapshot:manifest.snapshot};
    state.fileGroup.add(mesh);state.fileMeshes.push(mesh);
    const label=createLabel(`${row.label} · ${row.files} files / ${row.members} members`,{size:spacing*.8});label.position.set(x,height+2,z);label.quaternion.copy(state.camera.quaternion);label.userData.stackLabelLevel='pipeline';state.labelGroup.add(label);
  });
  state.drawCounts={files:0,members:0,edges:0,labels:rows.length,aggregateProxies:rows.length};
  state.overviewVisible=true;state.invalidateHover?.();state.invalidateRender?.();
};
