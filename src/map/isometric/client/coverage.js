export const projectPipeRows = (rows, { level, tier, globalVisible = true, typeVisible = true,
  allConnections = false, selected = null }) => {
  if (!globalVisible || !typeVisible || level !== tier) return [];
  if (tier !== 'segments' || allConnections) return rows;
  if (!selected) return [];
  return rows.filter(row => selected.type === 'member'
    ? row.fromMember === String(selected.id) || row.toMember === String(selected.id)
    : row.fromFile === selected.file || row.toFile === selected.file);
};

export const projectViewerCoverage = (state, { pipes = 0, relations = 0 } = {}) => ({
  sourceScope: 'available saved payload',
  available: state.sourceIndex?.counts || null,
  upstream: state.rawMap?.coverage?.source || state.rawMap?.summary || null,
  display: state.map?.coverage?.display || { counts: state.map?.summary?.counts || null },
  draw: { counts: state.drawCounts || null, omissions: state.stackModel?.coverage || null },
  visible: { pipes, sourceRelations: relations, filesHidden: state.fileGroup?.visible === false,
    membersHidden: state.memberGroup?.visible === false, edgesHidden: state.edgeGroup?.visible === false },
  completeness: 'A saved export is not proof of complete repository coverage.'
});
