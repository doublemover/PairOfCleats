export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';
export const DEFAULT_TRIAGE_PROMOTE_FIELDS = [
  'recordType',
  'source',
  'recordId',
  'service',
  'env',
  'team',
  'owner',
  'vulnId',
  'cve',
  'packageName',
  'packageEcosystem',
  'severity',
  'status',
  'assetId'
];

export const DEFAULT_DP_MAX_BY_FILE_COUNT = [
  { maxFiles: 5000, dpMaxTokenLength: 32 },
  { maxFiles: 20000, dpMaxTokenLength: 24 },
  { maxFiles: Number.POSITIVE_INFINITY, dpMaxTokenLength: 16 }
];
