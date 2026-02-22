export const RECORDS_INCREMENTAL_CAPABILITY_FLAG = 'bundleRecordsIncremental';

export const hasRecordsIncrementalCapability = (manifest) => (
  Boolean(
    manifest
    && typeof manifest === 'object'
    && manifest[RECORDS_INCREMENTAL_CAPABILITY_FLAG] === true
  )
);

export const setRecordsIncrementalCapability = (manifest, supported = true) => {
  if (!manifest || typeof manifest !== 'object') return manifest;
  manifest[RECORDS_INCREMENTAL_CAPABILITY_FLAG] = supported === true;
  return manifest;
};

export const resolveRecordsIncrementalCapability = (manifest) => {
  if (!manifest || typeof manifest !== 'object') {
    return {
      supported: false,
      explicit: false,
      reason: 'records incremental bundles unsupported (manifest missing).'
    };
  }
  if (manifest[RECORDS_INCREMENTAL_CAPABILITY_FLAG] === true) {
    return {
      supported: true,
      explicit: true,
      reason: null
    };
  }
  if (manifest[RECORDS_INCREMENTAL_CAPABILITY_FLAG] === false) {
    return {
      supported: false,
      explicit: true,
      reason: 'records incremental bundles unsupported by manifest capability.'
    };
  }
  return {
    supported: false,
    explicit: false,
    reason: `records incremental bundles unsupported (manifest missing ${RECORDS_INCREMENTAL_CAPABILITY_FLAG}=true).`
  };
};
