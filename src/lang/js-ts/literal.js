import { semanticLiteralScalar } from '../../index/semantic/semantic-literal.js';
import { LITERAL_EVIDENCE_VERSION, MAX_LITERAL_REPRESENTATION } from '../../contracts/literal-evidence.js';

const data = (object, key) => {
  const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};

/** Normalize real ESTree/Babel scalar nodes without serializing parser objects. */
export const projectJsTsLiteral = (node, source = null) => {
  if (!node || typeof node !== 'object') return null;
  let operand = node, sign = null;
  if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) {
    sign = node.operator; operand = node.argument;
  }
  if (!operand) return null;
  const type = operand.type, value = data(operand, 'value');
  let kind = null;
  if (type === 'BigIntLiteral' || type === 'Literal' && (typeof value === 'bigint' || typeof data(operand, 'bigint') === 'string')) kind = 'bigint';
  else if (type === 'RegExpLiteral' || type === 'Literal' && data(operand, 'regex')) kind = 'regexp';
  else if (type === 'NullLiteral' || type === 'Literal' && value === null) kind = 'null';
  else if (type === 'StringLiteral' || type === 'Literal' && typeof value === 'string') kind = 'string';
  else if (type === 'NumericLiteral' || type === 'Literal' && typeof value === 'number') kind = 'number';
  else if (type === 'BooleanLiteral' || type === 'Literal' && typeof value === 'boolean') kind = 'boolean';
  else if (type === 'Literal' || type === 'DecimalLiteral') kind = 'unsupported';
  if (!kind) return null;
  if (sign && (kind !== 'number' && kind !== 'bigint' || kind === 'bigint' && sign === '+')) kind = 'unsupported';
  const start = data(node, 'start') ?? data(node, 'range')?.[0];
  const end = data(node, 'end') ?? data(node, 'range')?.[1];
  const range = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start
    && (typeof source !== 'string' || end <= source.length) ? { start, end } : null;
  let raw = typeof source === 'string' && range
    ? source.slice(start, Math.min(end, start + 81))
    : data(node, 'raw') ?? data(data(node, 'extra'), 'raw');
  if (typeof raw !== 'string') raw = '';
  const rawTruncated = raw.length > 80 || typeof source === 'string' && range && end - start > 80;
  let scalar = null;
  if (kind === 'bigint') {
    let token = data(operand, 'bigint') ?? (typeof value === 'string' ? value : data(operand, 'raw') ?? data(data(operand, 'extra'), 'raw'));
    if (typeof token === 'string' && token.length <= MAX_LITERAL_REPRESENTATION) {
      token = token.replace(/_/g, '').replace(/n$/, '');
      scalar = semanticLiteralScalar({ kind: 'BigIntLiteral', value: token });
      if (scalar && sign === '-') scalar.representation = BigInt(scalar.representation) === 0n ? '0'
        : scalar.representation.startsWith('-') ? scalar.representation.slice(1) : `-${scalar.representation}`;
    }
  } else if (kind === 'number' && typeof value === 'number') {
    scalar = semanticLiteralScalar({ kind: 'NumericLiteral', value: sign === '-' ? -value : value });
  } else if (kind === 'null') scalar = semanticLiteralScalar({ kind: 'NullLiteral', value: null });
  else if (kind === 'boolean' && typeof value === 'boolean') scalar = semanticLiteralScalar({ kind: 'BooleanLiteral', value });
  else if (kind === 'string' && typeof value === 'string') scalar = semanticLiteralScalar({ kind: 'StringLiteral', value });
  if (scalar?.representation.length > MAX_LITERAL_REPRESENTATION) scalar = null;
  return { version: LITERAL_EVIDENCE_VERSION, kind, valueState: scalar ? 'qualified' : 'unavailable',
    scalar, range, rawPreview: raw.slice(0, 80), rawTruncated: !!rawTruncated };
};

export const formatJsTsLiteral = evidence => {
  if (!evidence) return null;
  if (evidence.scalar) return `${evidence.scalar.representation}${evidence.kind === 'bigint' ? 'n' : ''}`;
  return evidence.rawPreview ? `${evidence.rawPreview}${evidence.rawTruncated ? '...' : ''}` : '...';
};

// Mirrors the bounded display slots; later argument coverage is independent.
export const collectCallLiteralEvidence = (nodes, source, limit = 5) => Array.isArray(nodes)
  ? nodes.slice(0, limit).map(node => projectJsTsLiteral(node, source)) : [];
