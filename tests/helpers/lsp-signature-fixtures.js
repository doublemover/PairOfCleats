import fs from 'node:fs/promises';

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse signatures like:
 * - `add` (incomplete symbol-only shape)
 * - `int add(int a, int b)` (fully typed C-like function)
 *
 * @param {unknown} detailText
 * @param {{bareNames?:string[],bareReturnType?:string,allowUnnamedPrototype?:boolean}} [options]
 * @returns {{signature:string,returnType:string,paramTypes:Record<string,string>,paramNames:string[]}|null}
 */
export const parseCppTwoIntParamSignature = (detailText, options = {}) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  const bareNames = Array.isArray(options?.bareNames)
    ? options.bareNames.map((entry) => String(entry || '').trim()).filter(Boolean)
    : ['add'];
  const bareReturnType = typeof options?.bareReturnType === 'string' && options.bareReturnType.trim()
    ? options.bareReturnType.trim()
    : 'unknown';
  if (bareNames.includes(detail)) {
    return {
      signature: detail,
      returnType: bareReturnType,
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  if (options?.allowUnnamedPrototype && detail === 'int (int, int)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  const namePattern = bareNames.length ? bareNames.map((name) => escapeRegex(name)).join('|') : '[A-Za-z_]\\w*';
  const typed = detail.match(new RegExp(
    `^int\\s+(${namePattern})\\s*\\(\\s*int\\s+([A-Za-z_]\\w*)\\s*,\\s*int\\s+([A-Za-z_]\\w*)\\s*\\)$`
  ));
  if (!typed) return null;
  return {
    signature: detail,
    returnType: 'int',
    paramTypes: {
      [typed[2]]: 'int',
      [typed[3]]: 'int'
    },
    paramNames: [typed[2], typed[3]]
  };
};

export const parseJsonLinesFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

export const countNonEmptyLines = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.split(/\r?\n/u).filter(Boolean).length;
  } catch {
    return 0;
  }
};
