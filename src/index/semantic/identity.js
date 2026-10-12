import { createHash } from 'node:crypto';

/** Canonical JSON for semantic identities; never silently drops unsupported values. */
export const canonicalSemanticJson = (value) => {
  const active = new Set();
  const encode = (item) => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) {
        throw new TypeError('Semantic identity numbers must be finite and must not be negative zero.');
      }
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('Semantic identities require explicit JSON values.');
    if (active.has(item)) throw new TypeError('Semantic identities cannot contain cycles.');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype
      && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected a plain JSON object.');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Symbol keys are not JSON.');
    active.add(item);
    try {
      if (array) {
        if (Object.keys(item).length !== item.length) throw new TypeError('Sparse or decorated arrays are not JSON.');
        const parts = [];
        for (let i = 0; i < item.length; i += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Identity getters are not JSON.');
          parts.push(encode(descriptor.value));
        }
        return '[' + parts.join(',') + ']';
      }
      return '{' + Object.keys(item).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Identity getters are not JSON.');
        return JSON.stringify(key) + ':' + encode(descriptor.value);
      }).join(',') + '}';
    } finally {
      active.delete(item);
    }
  };
  return encode(value);
};

export const semanticHash = (domain, inputs) => {
  if (typeof domain !== 'string' || !domain || domain.includes('\0')) {
    throw new TypeError('A nonempty semantic hash domain is required.');
  }
  return createHash('sha256').update(domain + '\0', 'utf8')
    .update(canonicalSemanticJson(inputs), 'utf8').digest('hex');
};

const identity = (prefix, domain, fields, inputs) => {
  if (!inputs || Object.keys(inputs).length !== fields.length
    || fields.some((field) => !Object.hasOwn(inputs, field))) {
    throw new TypeError('Identity requires exactly: ' + fields.join(', '));
  }
  return prefix + ':' + semanticHash(domain, inputs);
};

export const createSourceUnitId = (inputs) => {
  const file = inputs?.path;
  if (typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/')
    || /^[A-Za-z]:/.test(file) || file.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Source path must be canonical case-preserving repository-relative POSIX.');
  }
  if (typeof inputs.repositoryNamespace !== 'string' || !inputs.repositoryNamespace
    || typeof inputs.byteHash !== 'string' || !/^[a-f0-9]{64}$/.test(inputs.byteHash)
    || typeof inputs.language !== 'string' || !inputs.language
    || typeof inputs.decoding !== 'string' || !inputs.decoding) throw new TypeError('Source namespace and SHA-256 are required.');
  return identity('su1', 'pairofcleats.semantic.source.v1',
    ['repositoryNamespace', 'path', 'byteHash', 'decoding', 'language', 'dialect', 'mapping'], inputs);
};

export const createSyntaxPartitionId = (inputs) => identity('sy1', 'pairofcleats.semantic.syntax.v1',
  ['sourceUnitId', 'parser', 'extractor', 'structuralPolicy'], inputs);

export const createAnalysisPartitionId = (inputs) => identity('sa1', 'pairofcleats.semantic.analysis.v1',
  ['pass', 'inputPartitionHashes', 'compilerContext', 'dependencySummaryHashes', 'analysisPolicy'], {
    ...inputs,
    inputPartitionHashes: [...inputs.inputPartitionHashes].sort(),
    dependencySummaryHashes: [...inputs.dependencySummaryHashes].sort()
  });

export const createSemanticTaskId = (inputs) => identity('st1', 'pairofcleats.semantic.task.v1',
  ['kind', 'inputHashes', 'policyHash', 'targetSetHash'], {
    ...inputs, inputHashes: [...inputs.inputHashes].sort()
  });

export const createSymbolGroupId = ({ contextKey, declarations }) => 'sg1:' + semanticHash(
  'pairofcleats.semantic.symbol-group.v1',
  { contextKey, declarations: [...declarations].sort((a, b) => (
    a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : a.localId - b.localId
  )) }
);
