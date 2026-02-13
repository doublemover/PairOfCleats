export const normalizeEol = (value) => String(value ?? '').replace(/\r\n?/g, '\n');

export const equalsIgnoringEol = (left, right) => normalizeEol(left) === normalizeEol(right);

export const splitNormalizedLines = (value) => normalizeEol(value).split('\n');
