import { getOwn, setOwn } from '../../../shared/object-record.js';

const keys = value => value && typeof value === 'object' ? Object.keys(value) : [];
export const collectFieldPostingNames = (postings, lengths) => new Set([...keys(postings), ...keys(lengths)]);
export const getFieldPostingLengths = (lengths, field) => {
  const value = getOwn(lengths || {}, field);
  return Array.isArray(value) ? value : [];
};

/** Both zero-document and populated assembly publish the same safe record.
 * Length normalization stays with each caller's bounded work owner. */
export const setFieldPostingRecord = (fields, field, { vocab = [], postings = [], docLengths, avgDocLen = 0 }) =>
  setOwn(fields, field, { vocab, postings, docLengths, avgDocLen, totalDocs: docLengths.length });
