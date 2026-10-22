import assert from 'node:assert/strict';
import { projectPipeRows, projectViewerCoverage } from '../../src/map/isometric/client/coverage.js';
import { settingSupported } from '../../src/map/isometric/client/setting-capabilities.js';

const rows=[{fromFile:'a',toFile:'b',fromMember:'0',toMember:'id:b',count:1},
  {fromFile:'b',toFile:'a',fromMember:'id:b',toMember:'0',count:2}];
const options={level:'segments',tier:'segments',selected:{type:'member',id:0}};
assert.equal(projectPipeRows(rows,options).length,2);
assert.deepEqual(projectPipeRows(rows,{...options,typeVisible:false}),[]);
assert.deepEqual(projectPipeRows(rows,{...options,globalVisible:false}),[]);
assert.deepEqual(projectPipeRows(rows,{...options,selected:null}),[]);
assert.equal(projectPipeRows(rows,{...options,selected:null,allConnections:true}),rows);
const coverage=projectViewerCoverage({sourceIndex:{counts:{files:501,members:12001,edges:16001}},
  drawCounts:{files:500,members:12000,edges:16000},stackModel:{coverage:{omittedFiles:1,omittedMembers:1,omittedEdges:1}},
  edgeGroup:{visible:false}},{pipes:0,relations:0});
assert.equal(coverage.available.files,501);assert.equal(coverage.draw.omissions.omittedFiles,1);
assert.equal(coverage.visible.edgesHidden,true);assert.equal(coverage.visible.pipes,0);
assert.equal(settingSupported('visuals.glass.roughness','stacks'),false);
assert.equal(settingSupported('scoring.params','stacks'),false);
assert.equal(settingSupported('visuals.memberOpacity','stacks'),true);
console.log('Pipe inspection and coverage use the same visible filters while unsupported stack controls remain inert.');
