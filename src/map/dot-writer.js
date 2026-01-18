import { FILE_CATEGORY_COLORS, DEFAULT_LEGEND } from './constants.js';
import { sortBy } from './utils.js';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escapeDot = (value) => String(value || '').replace(/"/g, '\\"');

const dotId = (value) => `"${escapeDot(value)}"`;

const truncate = (value, max) => {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const buildMemberRow = (member) => {
  const name = escapeHtml(member.name || '(anonymous)');
  const signature = escapeHtml(truncate(member.signature || '', 60));
  const badges = [];
  if (member.modifiers?.async) badges.push('async');
  if (member.modifiers?.static) badges.push('static');
  if (member.modifiers?.generator) badges.push('gen');
  if (member.returns) badges.push('returns');
  const reads = member.dataflow?.reads?.length || 0;
  const writes = member.dataflow?.writes?.length || 0;
  const mutations = member.dataflow?.mutations?.length || 0;
  const aliases = member.dataflow?.aliases?.length || 0;
  if (reads) badges.push(`r${reads}`);
  if (writes) badges.push(`w${writes}`);
  if (mutations) badges.push(`m${mutations}`);
  if (aliases) badges.push(`a${aliases}`);
  const branches = member.controlFlow?.branches || 0;
  const loops = member.controlFlow?.loops || 0;
  const throws = member.controlFlow?.throws || 0;
  const awaits = member.controlFlow?.awaits || 0;
  const yields = member.controlFlow?.yields || 0;
  if (branches) badges.push(`b${branches}`);
  if (loops) badges.push(`l${loops}`);
  if (throws) badges.push(`t${throws}`);
  if (awaits) badges.push(`aw${awaits}`);
  if (yields) badges.push(`y${yields}`);
  const badgeText = escapeHtml(badges.join(' '));

  return `  <TR><TD PORT="${escapeHtml(member.port)}" ALIGN="LEFT">${name}</TD>`
    + `<TD ALIGN="LEFT">${signature}</TD>`
    + `<TD ALIGN="RIGHT">${badgeText}</TD></TR>`;
};

const buildFileLabel = (node) => {
  const header = escapeHtml(node.path || node.name || '');
  const rows = (node.members || []).map((member) => buildMemberRow(member));
  return [
    '<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">',
    `  <TR><TD BGCOLOR="#f0f0f0" COLSPAN="3" ALIGN="LEFT"><B>${header}</B></TD></TR>`,
    ...rows,
    '</TABLE>'
  ].join('\n');
};

export function renderDot(mapModel) {
  const legend = mapModel.legend || DEFAULT_LEGEND;
  const memberPorts = new Map();
  for (const node of mapModel.nodes || []) {
    for (const member of node.members || []) {
      memberPorts.set(member.id, { file: node.path, port: member.port });
    }
  }

  const lines = [];
  lines.push('digraph CodeMap {');
  lines.push('  rankdir=LR;');
  lines.push('  graph [fontsize=10];');
  lines.push('  node [fontsize=10, fontname="Helvetica"];');
  lines.push('  edge [fontsize=9, fontname="Helvetica"];');

  const nodes = sortBy(mapModel.nodes || [], (node) => node.path);
  for (const node of nodes) {
    const shape = legend.fileShapes?.[node.category] || 'box';
    const color = FILE_CATEGORY_COLORS[node.category] || FILE_CATEGORY_COLORS.other;
    const style = node.category === 'test' ? 'dashed' : 'solid';
    const label = buildFileLabel(node);
    lines.push(
      `  ${dotId(node.path)} [shape=${shape}, style="${style}", color="${color}", label=<${label}>];`
    );
  }

  const edges = sortBy(mapModel.edges || [], (edge) => {
    const from = edge.from?.member || edge.from?.file || '';
    const to = edge.to?.member || edge.to?.file || '';
    return `${edge.type}:${from}->${to}:${edge.label || ''}`;
  });

  for (const edge of edges) {
    const style = legend.edgeStyles?.[edge.type] || {};
    const attrs = [];
    if (style.style) attrs.push(`style="${style.style}"`);
    if (style.color) attrs.push(`color="${style.color}"`);
    if (edge.label) attrs.push(`label="${escapeDot(edge.label)}"`);

    const fromMember = edge.from?.member;
    const toMember = edge.to?.member;
    let fromId = edge.from?.file ? dotId(edge.from.file) : null;
    let toId = edge.to?.file ? dotId(edge.to.file) : null;
    if (fromMember && memberPorts.has(fromMember)) {
      const meta = memberPorts.get(fromMember);
      fromId = `${dotId(meta.file)}:${meta.port}`;
    }
    if (toMember && memberPorts.has(toMember)) {
      const meta = memberPorts.get(toMember);
      toId = `${dotId(meta.file)}:${meta.port}`;
    }
    if (!fromId || !toId) continue;
    lines.push(`  ${fromId} -> ${toId} [${attrs.join(', ')}];`);
  }

  lines.push('}');
  return lines.join('\n');
}
