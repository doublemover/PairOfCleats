import { canonicalSemanticJson } from './identity.js';
import { compilerClassDefinitions, compilerConstructorCandidates, compilerReturnExpressions } from './compiler-object-model.js';
import { compilerPropertyKeys, propertyKeySetsOverlap } from './compiler-property-paths.js';

/** Group-owned immutable structural queries; final dispatch remains per call. */
export const createCompilerStructuralQueries = ({ ts, checker, assignments = new Map(), maxMemberBytes = 8 * 1024 * 1024 }) => {
  const classes = new WeakMap(), constructors = new WeakMap(), returns = new WeakMap(), members = new WeakMap();
  const stats = { classQueries: 0, constructorQueries: 0, accessorScans: 0, memberBuilds: 0,
    membersVisited: 0, matchedMemberRows: 0, memberBytes: 0 };
  const cached = (cache, node, build, reasons, counter, cacheKey = node) => {
    let summary = cache.get(cacheKey);
    if (!summary) {
      const foundReasons = new Set(); stats[counter]++;
      summary = { values: Object.freeze(build(foundReasons)), reasons: Object.freeze([...foundReasons]) };
      cache.set(cacheKey, summary);
    }
    for (const reason of summary.reasons) reasons.add(reason);
    return summary.values;
  };
  const sourceRows = (owner, staticMember) => {
    const object = ts.isObjectLiteralExpression(owner);
    return (object ? owner.properties : owner.members || []).filter(member => object
      || Boolean(member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) === staticMember && member.name);
  };
  const rowFor = (member, ordinal) => {
    stats.membersVisited++;
    const reasons = new Set(), spread = ts.isSpreadAssignment(member);
    const keys = spread ? [] : compilerPropertyKeys({ ts, checker, node: member.name, reasons });
    return { member, ordinal, keys, spread, reasons: [...reasons] };
  };
  const indexFor = (owner, staticMember) => {
    let modes = members.get(owner);
    if (!modes) { modes = new Map(); members.set(owner, modes); }
    const mode = ts.isObjectLiteralExpression(owner) ? 'object' : staticMember;
    if (modes.has(mode)) return modes.get(mode);
    stats.memberBuilds++;
    const rows = [], byKey = new Map(), widened = [], reasonRows = [], spreads = [];
    let bytes = 0;
    for (const member of sourceRows(owner, staticMember)) {
      const row = rowFor(member, rows.length);
      bytes += 192 + row.keys.reduce((sum, value) => sum + Buffer.byteLength(canonicalSemanticJson(value)) + 24, 0);
      if (stats.memberBytes + bytes > maxMemberBytes) { modes.set(mode, null); return null; }
      rows.push(row);
      if (row.spread) spreads.push(row);
      if (row.reasons.length) reasonRows.push(row);
      for (const value of row.keys) {
        if (value === null) { widened.push(row); continue; }
        const key = canonicalSemanticJson(value);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(row);
      }
    }
    stats.memberBytes += bytes;
    const index = { rows, byKey, widened, reasonRows, spreads };
    modes.set(mode, index); return index;
  };
  return {
    stats,
    classes(node, reasons) {
      // Plain identifier roots all start at depth zero. Wrapper/path-sensitive
      // roots retain their exact node key and therefore their own depth budget.
      let symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : null;
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      return cached(classes, node, local => compilerClassDefinitions({ ts, checker, node, reasons: local, assignments }), reasons, 'classQueries', symbol || node);
    },
    constructors(definition, reasons) { return cached(constructors, definition, local => compilerConstructorCandidates({ ts, checker, definition, reasons: local, assignments }), reasons, 'constructorQueries'); },
    returns(owner, reasons) { return cached(returns, owner, local => compilerReturnExpressions({ ts, owner, reasons: local }), reasons, 'accessorScans'); },
    *members(owner, names, staticMember, reasons) {
      const index = indexFor(owner, staticMember);
      let rows;
      if (!index) rows = sourceRows(owner, staticMember).map(rowFor);
      else if (names.includes(null)) rows = index.rows;
      else {
        const selected = new Set([...index.widened, ...index.spreads, ...index.reasonRows]);
        for (const name of names) for (const row of index.byKey.get(canonicalSemanticJson(name)) || []) selected.add(row);
        rows = [...selected].sort((a, b) => a.ordinal - b.ordinal);
      }
      for (const row of rows) {
        for (const reason of row.reasons) reasons.add(reason);
        if (row.spread || propertyKeySetsOverlap(row.keys, names)) { stats.matchedMemberRows++; yield row.member; }
      }
    }
  };
};
