import assert from 'node:assert/strict';
import * as THREE from 'three';
import { usableViewport, fitOrthographicBounds } from '../../src/map/isometric/client/camera-fit.js';

for(const [width,height] of [[1903,936],[1366,768],[390,844]]){
  const obstacles=[{left:0,right:width,top:0,bottom:70},
    {left:0,right:Math.min(310,width*0.25),top:70,bottom:height-35},
    {left:width-Math.min(330,width*0.25),right:width,top:70,bottom:height-35},
    {left:0,right:width,top:height-35,bottom:height}];
  const usable=usableViewport({width,height,obstacles});
  for(const box of [new THREE.Box3(new THREE.Vector3(-1700,-4,20),new THREE.Vector3(700,180,400)),
    new THREE.Box3(new THREE.Vector3(50,0,-12),new THREE.Vector3(51,1000,400)),
    new THREE.Box3(new THREE.Vector3(3,3,3),new THREE.Vector3(3,3,3))]){
    const camera=new THREE.OrthographicCamera(-40*width/height,40*width/height,40,-40,0.1,2000);
    camera.quaternion.setFromEuler(new THREE.Euler(-Math.atan(1/Math.sqrt(2)),Math.PI/4,0,'YXZ'));
    const result=fitOrthographicBounds({THREE,camera,bounds:box,viewport:{width,height},usable,requestedMin:1,requestedMax:2});
    assert.ok(result.min<result.zoom,'fit has further zoom-out room despite old persisted min');
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new THREE.Vector3(x,y,z).project(camera),pixelX=(point.x+1)*width/2,pixelY=(1-point.y)*height/2;
      assert.ok(pixelX>=usable.left-0.01&&pixelX<=usable.right+0.01);
      assert.ok(pixelY>=usable.top-0.01&&pixelY<=usable.bottom+0.01);
      assert.ok(point.z>=-1&&point.z<=1,'included geometry remains inside near/far');
    }
  }
}
console.log('Orthographic bounds fit the actual unoccluded viewport with adaptive range and clipping planes.');
