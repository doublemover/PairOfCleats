#!/usr/bin/env node
import { buildRelationGraphs } from '../../../src/index/build/graphs.js';

const chunks = [
  {
    file: 'src/a.js',
    name: 'alpha',
    kind: 'FunctionDeclaration',
    chunkUid: 'chunk-a',
    codeRelations: {
      callLinks: [
        { to: { status: 'resolved', resolved: { chunkUid: 'chunk-b' } } }
      ],
      usageLinks: [],
      callDetails: [
        { targetChunkUid: 'chunk-b' }
      ]
    }
  },
  {
    file: 'src/b.js',
    name: 'beta',
    kind: 'FunctionDeclaration',
    chunkUid: 'chunk-b',
    codeRelations: {}
  }
];

const graphs = buildRelationGraphs({ chunks });
const nodeA = graphs.callGraph.nodes.find((node) => node.id === 'chunk-a');
if (!nodeA || !Array.isArray(nodeA.out) || !nodeA.out.includes('chunk-b')) {
  console.error('relations memory release test failed: expected call edge from callDetails/callLinks.');
  process.exit(1);
}

const callSites = [
  { callerChunkUid: 'chunk-a', targetChunkUid: 'chunk-b' }
];
const graphsWithCallSites = buildRelationGraphs({ chunks, callSites });
const nodeCallSites = graphsWithCallSites.callGraph.nodes.find((node) => node.id === 'chunk-a');
if (!nodeCallSites || !Array.isArray(nodeCallSites.out) || !nodeCallSites.out.includes('chunk-b')) {
  console.error('relations memory release test failed: expected call edge from callSites.');
  process.exit(1);
}

console.log('relations memory release test passed');
