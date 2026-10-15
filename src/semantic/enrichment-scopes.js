const scope = (values, key) => {
  const ordered = [...new Set(values)].sort();
  return { [key]: ordered.slice(0, 32), count: ordered.length, truncated: ordered.length > 32 };
};
export const createEnrichmentWorkScopes = tasks => ({
  requested: scope(tasks.flatMap(task => task.sourceUnits), 'sourceUnits'), widened: null, retainedSyntax: null,
  compilerParseReused: null, compilerParsed: null, sourceBytesReused: 0, peakRetainedBytes: 0,
  retainedByteBasis: 'source-bytes-times-16-estimate', retainedSyntaxVerifiedBytes: 0,
  replayReceiptsComplete: false, droppedReplayReceipts: 0
});
export const recordCompilerReuseScopes = (scopes, receipt) => {
  scopes.compilerParseReused = scope(receipt.parseReusedFiles, 'paths');
  scopes.compilerParsed = scope(receipt.parsedFiles, 'paths');
  scopes.sourceBytesReused = receipt.sourceBytesReused;
  scopes.peakRetainedBytes = receipt.peakRetainedBytes;
};
/** Immutable replay receipts identify verified reuse, never compiler closure.
 * Missing/evicted receipts cannot be counted as fresh syntax recomputation.
 */
export const recordPublishedWorkScopes = (scopes, tasks, inventory, runtime) => {
  const requested = new Set(tasks.flatMap(task => task.sourceUnits));
  scopes.widened = scope([...inventory.sources.keys()].filter(id => !requested.has(id)), 'sourceUnits');
  const context = runtime.semanticReplayVerification;
  if (!context) return;
  const receipts = context.snapshotReceipts();
  const unique = new Map(receipts.map(receipt => [receipt.sourceUnitId, receipt]));
  scopes.retainedSyntax = scope([...unique.keys()], 'sourceUnits');
  scopes.retainedSyntaxVerifiedBytes = [...unique.values()].reduce((sum, receipt) => sum + receipt.verifiedBytes, 0);
  scopes.droppedReplayReceipts = context.metrics.droppedReceipts;
  scopes.replayReceiptsComplete = context.metrics.droppedReceipts === 0
    && context.metrics.consumedReplays === receipts.length;
};

export const trimEnrichmentWorkScopes = (result, maxBytes) => {
  const scopes = result.workScopes;
  if (!scopes) return;
  const arrays = Object.values(scopes).filter(value => value && typeof value === 'object')
    .map(value => ({ value, key: value.sourceUnits ? 'sourceUnits' : 'paths' }));
  while (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    const largest = arrays.filter(row => row.value[row.key].length).sort((a, b) =>
      JSON.stringify(b.value[b.key]).length - JSON.stringify(a.value[a.key]).length)[0];
    if (!largest) return;
    largest.value[largest.key].pop(); largest.value.truncated = true;
  }
};
