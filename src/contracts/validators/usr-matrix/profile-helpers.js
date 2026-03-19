export const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : []
);

export const sortedStrings = (value) => [...asStringArray(value)].sort((left, right) => left.localeCompare(right));

export const equalStringSets = (left, right) => {
  const leftSorted = sortedStrings(left);
  const rightSorted = sortedStrings(right);
  if (leftSorted.length !== rightSorted.length) return false;
  return leftSorted.every((entry, index) => entry === rightSorted[index]);
};

export const findRiskOverlap = (left, right) => {
  const leftSet = new Set(asStringArray(left));
  return asStringArray(right).filter((entry) => leftSet.has(entry));
};

export const normalizeObservedResultMap = (observedResults, keyField = 'id') => {
  if (observedResults instanceof Map) {
    return new Map(observedResults.entries());
  }

  if (Array.isArray(observedResults)) {
    return new Map(
      observedResults
        .filter((row) => row && typeof row === 'object' && typeof row[keyField] === 'string')
        .map((row) => [row[keyField], row])
    );
  }

  if (observedResults && typeof observedResults === 'object') {
    return new Map(Object.entries(observedResults));
  }

  return new Map();
};

export const resolveObservedGatePass = (observed) => {
  if (typeof observed === 'boolean') {
    return observed;
  }
  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return observed.pass;
    }
    if (typeof observed.status === 'string') {
      return observed.status.toLowerCase() === 'pass';
    }
  }
  return null;
};

export const resolveObservedRedactionResult = (observed) => {
  if (typeof observed === 'boolean') {
    return {
      pass: observed,
      misses: observed ? 0 : null
    };
  }
  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return {
        pass: observed.pass,
        misses: Number.isFinite(observed.misses) ? observed.misses : null
      };
    }
    if (Number.isFinite(observed.misses)) {
      return {
        pass: observed.misses <= 0,
        misses: observed.misses
      };
    }
  }
  return {
    pass: null,
    misses: null
  };
};
