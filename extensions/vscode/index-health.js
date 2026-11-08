// Present the canonical health owner's selected capability facts. Inventory
// absence is not a repair requirement and omitted health evidence is unknown.
function summarizeIndexHealth(payload) {
  const health = payload?.health;
  const issues = Array.isArray(health?.issues) ? health.issues : null;
  const integrity = payload?.corruption?.ok;
  const status = issues?.length || integrity === false ? 'issues' : issues || integrity === true ? 'ok' : 'unknown';
  const lines = [`- status: ${status}`, `- repo: ${payload?.repo?.root || 'unknown'}`,
    `- cache root: ${payload?.repo?.cacheRoot || 'unknown'}`, `- total cache bytes: ${payload?.repo?.totalBytes ?? 'n/a'}`];
  if (typeof health?.selection === 'string') lines.push(`- selection evidence: ${health.selection.slice(0, 256)}`);
  for (const mode of ['code', 'prose', 'extracted-prose', 'records']) {
    const selected = health?.modes?.[mode];
    if (selected) lines.push(`- file ${mode}: ${String(selected.status || 'unknown').slice(0, 128)}; selected: ${selected.selected === true}`);
    const sqlite = health?.backends?.sqlite?.[mode];
    const legacy = payload?.repo?.sqlite?.[mode === 'extracted-prose' ? 'extractedProse' : mode];
    if (sqlite) lines.push(`- sqlite ${mode}: ${String(sqlite.status || 'unknown').slice(0, 128)}; selected: ${sqlite.selected === true}`);
    else if (typeof legacy === 'boolean') lines.push(`- sqlite ${mode}: ${legacy ? 'present' : 'not observed'} (inventory only; selection unknown)`);
    const lmdb = health?.backends?.lmdb?.[mode];
    if (lmdb) lines.push(`- lmdb ${mode}: ${String(lmdb.status || 'unknown').slice(0, 128)}; selected: ${lmdb.selected === true}`);
  }
  if (payload?.corruption) lines.push(`- integrity: ${integrity === true ? 'ok' : integrity === false ? 'issues' : 'unknown'}`);
  if (issues?.length) lines.push(`- health issues: ${issues.length}`);
  for (const hint of Array.isArray(health?.hints) ? health.hints.slice(0, 3) : []) lines.push(`- recorded hint: ${String(hint).slice(0, 2048)}`);
  lines.push(status === 'issues' ? '- next: inspect the recorded selected-capability issue and choose a scoped recovery for this repository'
    : status === 'unknown' ? '- next: obtain admitted Index Health evidence before choosing a repair'
      : '- optional capabilities remain deliberate choices; no additional build is required by inventory absence');
  return lines;
}

module.exports = { summarizeIndexHealth };
