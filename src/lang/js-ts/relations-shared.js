export const normalizeCallText = (value) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/\s/.test(trimmed)) return trimmed;
  return trimmed.replace(/\s+/g, ' ');
};

export const truncateCallText = (value, maxLen) => {
  const normalized = normalizeCallText(value);
  if (!normalized) return '';
  const resolvedMax = Number(maxLen);
  if (!Number.isFinite(resolvedMax) || resolvedMax <= 0 || normalized.length <= resolvedMax) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, resolvedMax - 3))}...`;
};

export const resolveCalleeParts = (calleeName) => {
  if (!calleeName) return { calleeRaw: null, calleeNormalized: null, receiver: null };
  const raw = String(calleeName);
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === raw.length - 1) {
    return { calleeRaw: raw, calleeNormalized: raw, receiver: null };
  }
  const calleeNormalized = raw.slice(lastDot + 1);
  const receiver = raw.slice(0, lastDot);
  return {
    calleeRaw: raw,
    calleeNormalized,
    receiver
  };
};

export const resolveCallLocation = (node) => {
  if (!node || typeof node !== 'object') return null;
  const start = Number.isFinite(node.start)
    ? node.start
    : (Array.isArray(node.range) ? node.range[0] : null);
  const end = Number.isFinite(node.end)
    ? node.end
    : (Array.isArray(node.range) ? node.range[1] : null);
  const loc = node.loc || null;
  const startLine = Number.isFinite(loc?.start?.line) ? loc.start.line : null;
  const startCol = Number.isFinite(loc?.start?.column) ? loc.start.column + 1 : null;
  const endLine = Number.isFinite(loc?.end?.line) ? loc.end.line : null;
  const endCol = Number.isFinite(loc?.end?.column) ? loc.end.column + 1 : null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start,
    end,
    startLine,
    startCol,
    endLine,
    endCol
  };
};

export const resolveAstMemberName = (node, options = {}) => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'PrivateName' && node.id?.name) return `#${node.id.name}`;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'Super') return 'super';
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const obj = resolveAstMemberName(node.object, options);
    const prop = node.computed
      ? (node.property?.type === 'StringLiteral' || node.property?.type === 'Literal'
        ? String(node.property.value)
        : null)
      : (node.property?.name || node.property?.id?.name || null);
    if (obj && prop) return `${obj}.${prop}`;
    return obj || prop;
  }
  if (options.includeTsQualifiedName && node.type === 'TSQualifiedName') {
    const left = resolveAstMemberName(node.left, options);
    const right = resolveAstMemberName(node.right, options);
    if (left && right) return `${left}.${right}`;
    return left || right;
  }
  return null;
};

export const formatJsTsCallArg = (arg, options = {}) => {
  const depth = Number.isFinite(options.depth) ? options.depth : 0;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 2;
  if (!arg || depth > maxDepth) return '...';
  if (arg.type === 'Identifier') return arg.name;
  if (arg.type === 'Literal') return JSON.stringify(arg.value);
  if (arg.type === 'StringLiteral' || arg.type === 'NumericLiteral' || arg.type === 'BooleanLiteral') {
    return JSON.stringify(arg.value);
  }
  if (arg.type === 'MemberExpression' || arg.type === 'OptionalMemberExpression') {
    const memberName = options.getMemberName || ((node) => resolveAstMemberName(node, options));
    return memberName(arg) || 'member';
  }
  if (arg.type === 'CallExpression' || arg.type === 'OptionalCallExpression') {
    const callee = typeof options.getCalleeName === 'function' ? options.getCalleeName(arg.callee) : null;
    return callee ? `${callee}(...)` : 'call(...)';
  }
  if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') return 'fn(...)';
  if (arg.type === 'ObjectExpression') return '{...}';
  if (arg.type === 'ArrayExpression') return '[...]';
  if (arg.type === 'TemplateLiteral') return '`...`';
  if (arg.type === 'SpreadElement') {
    const inner = formatJsTsCallArg(arg.argument, { ...options, depth: depth + 1 });
    return inner ? `...${inner}` : '...';
  }
  return '...';
};

export const buildCallDetail = ({ callerName, calleeName, args, location }) => {
  const calleeParts = resolveCalleeParts(calleeName);
  const detail = {
    caller: callerName,
    callee: calleeName,
    calleeRaw: calleeParts.calleeRaw || calleeName,
    calleeNormalized: calleeParts.calleeNormalized || calleeName,
    receiver: calleeParts.receiver || null,
    args
  };
  if (location) {
    detail.start = location.start;
    detail.end = location.end;
    detail.startLine = location.startLine;
    detail.startCol = location.startCol;
    detail.endLine = location.endLine;
    detail.endCol = location.endCol;
  }
  return detail;
};
