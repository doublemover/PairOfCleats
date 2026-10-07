import {
  compareGraphEdges,
  compareGraphNodes,
  compareWitnessPaths
} from '../../graph/ordering.js';
import { formatRiskNodeRef } from '../../shared/risk-explain-model.js';
import { formatTruncationRecord } from './report-sections.js';

const formatNode = (node) => {
  const parts = [];
  if (node?.name) parts.push(node.name);
  if (node?.kind) parts.push(node.kind);
  if (node?.file) parts.push(node.file);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `${formatRiskNodeRef(node?.ref)}${suffix}`;
};

const formatEdge = (edge) => {
  const graph = edge?.graph ? `, ${edge.graph}` : '';
  return `${formatRiskNodeRef(edge?.from)} -> ${formatRiskNodeRef(edge?.to)} (${edge?.edgeType || 'edge'}${graph})`;
};

export const renderGraphContextPack = (pack) => {
  if (!pack || typeof pack !== 'object') return '';
  const lines = [];
  lines.push('# Graph Context Pack');
  lines.push('');
  lines.push('## Seed');
  lines.push(`- ${formatRiskNodeRef(pack.seed)}`);

  const isSorted = pack?.stats?.sorted === true;
  const nodes = Array.isArray(pack.nodes) ? pack.nodes.slice() : [];
  if (!isSorted) nodes.sort(compareGraphNodes);
  lines.push('');
  lines.push('## Nodes');
  if (!nodes.length) {
    lines.push('- (none)');
  } else {
    for (const node of nodes) {
      const distance = Number.isFinite(node?.distance) ? node.distance : 0;
      lines.push(`- [${distance}] ${formatNode(node)}`);
    }
  }

  const edges = Array.isArray(pack.edges) ? pack.edges.slice() : [];
  if (!isSorted) edges.sort(compareGraphEdges);
  lines.push('');
  lines.push('## Edges');
  if (!edges.length) {
    lines.push('- (none)');
  } else {
    for (const edge of edges) {
      lines.push(`- ${formatEdge(edge)}`);
    }
  }

  const paths = Array.isArray(pack.paths) ? pack.paths.slice() : [];
  if (paths.length) {
    if (!isSorted) paths.sort(compareWitnessPaths);
    lines.push('');
    lines.push('## Witness Paths');
    for (const path of paths) {
      const nodesText = Array.isArray(path?.nodes)
        ? path.nodes.map(formatRef).join(' -> ')
        : '';
      lines.push(`- ${formatRef(path?.to)} (${path?.distance ?? 0}): ${nodesText}`);
    }
  }

  if (Array.isArray(pack.truncation) && pack.truncation.length) {
    lines.push('');
    lines.push('## Truncation');
    for (const record of pack.truncation) {
      lines.push(`- ${formatTruncationRecord(record)}`);
    }
  }

  if (Array.isArray(pack.warnings) && pack.warnings.length) {
    lines.push('');
    lines.push('## Warnings');
    for (const warning of pack.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
};

