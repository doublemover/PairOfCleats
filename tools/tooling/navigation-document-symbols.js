/** Native document symbols use canonical declaration/occurrence/operand records.
 * Chunk line numbers remain available only through unqualified indexed evidence.
 * An identifier is the exact fallback range when no unique structural container
 * is retained; neither source text parsing nor line-number guessing occurs here. */
export async function projectQualifiedDocumentSymbols({ result, store, syntax, source, rows,
  position, resultLimit, signal, budget }) {
  const declarations = [], occurrences = new Map(), expressions = new Map(), names = new Map();
  const spanKey = row => JSON.stringify([row.span, row.data?.nameId]);
  const validSpan = span => Array.isArray(span) && span.length === 2
    && span.every(Number.isSafeInteger) && span[0] >= 0 && span[1] > span[0] && span[1] <= source.textLength;
  for await (const row of rows(syntax, 'semantic_records')) {
    if (row.kind === 'declaration') declarations.push(row);
    if (row.kind === 'occurrence' && row.data?.roles?.includes('definition')) {
      const key = spanKey(row);
      if (!occurrences.has(key)) occurrences.set(key, []);
      occurrences.get(key).push(row);
    }
    if (row.kind === 'expression') expressions.set(row.id, row);
  }
  for await (const row of rows(syntax, 'semantic_lookup')) {
    if (row.kind === 'name') names.set(row.id, row.value);
  }
  const parents = new Map();
  for await (const row of rows(syntax, 'semantic_operands')) {
    if (row.child?.partitionId !== syntax.partitionId || row.parent?.partitionId !== syntax.partitionId) continue;
    if (!parents.has(row.child.localId)) parents.set(row.child.localId, new Set());
    parents.get(row.child.localId).add(row.parent.localId);
  }
  declarations.sort((left, right) => (left.span?.[0] ?? Infinity) - (right.span?.[0] ?? Infinity) || left.id - right.id);
  for (const row of declarations) {
    budget();
    const name = names.get(row.data.nameId);
    if (!validSpan(row.span) || typeof name !== 'string' || !name
      || row.data.flags?.some(flag => ['recoveredSyntax', 'unsupportedSyntax'].includes(flag))) {
      result.degraded.push('document_symbol_source_span_unavailable'); continue;
    }
    let container = row.span;
    const matching = occurrences.get(spanKey(row)) || [];
    if (matching.length === 1 && matching[0].data.expression?.partitionId === syntax.partitionId) {
      const candidates = [...(parents.get(matching[0].data.expression.localId) || [])]
        .map(id => expressions.get(id)).filter(parent => parent?.data.astKind === row.data.declarationKind
          && validSpan(parent.span) && parent.span[0] <= row.span[0] && parent.span[1] >= row.span[1]);
      if (candidates.length === 1) container = candidates[0].span;
    }
    const start = position(source, container[0]), end = position(source, container[1]);
    const selectedStart = position(source, row.span[0]), selectedEnd = position(source, row.span[1]);
    const location = { name, qualifiedName: name, kind: row.data.declarationKind, file: source.path,
      virtualPath: source.path, ref: { partitionId: syntax.partitionId, localId: row.id },
      sourceHash: source.byteHash, coordinateUnit: 'utf16', role: 'declaration',
      startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col,
      selectionRange: { startLine: selectedStart.line, startCol: selectedStart.col,
        endLine: selectedEnd.line, endCol: selectedEnd.col }, score: 0 };
    if (result.results.length < resultLimit) result.results.push(location);
    else result.coverage.omittedResults++;
  }
  const coverage = await store.getCoverage([syntax.partitionId], { signal }); budget();
  const syntaxCoverage = coverage.filter(row => row.phase === 'syntax');
  if (!syntaxCoverage.length || syntaxCoverage.some(row => row.state !== 'complete')) {
    result.degraded.push('document_symbol_syntax_coverage_incomplete');
  }
  result.status = result.degraded.length || result.coverage.omittedResults ? 'partial' : 'resolved';
  result.binding.status = 'not-applicable';
  result.coverage.state = result.status === 'resolved' ? 'complete' : 'partial';
}
