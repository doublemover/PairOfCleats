const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** Completeness includes every manifest entry, including unread or invalid bundles. */
export const summarizeBundleEmbeddingCoverage = ({ totalFiles, processedFiles, eligibleFiles,
  coveredFiles, missingChunks, invalidBundles } = {}) => {
  const metricsValid = [totalFiles, processedFiles, eligibleFiles, coveredFiles, missingChunks, invalidBundles].every(validCount)
    && processedFiles <= totalFiles && coveredFiles <= eligibleFiles && eligibleFiles <= processedFiles;
  const unexaminedFiles = metricsValid ? totalFiles - processedFiles : null;
  const missingFiles = metricsValid ? eligibleFiles - coveredFiles : null;
  return {
    metricsValid, totalFiles, processedFiles, eligibleFiles, coveredFiles, missingChunks, invalidBundles,
    unexaminedFiles, missingFiles,
    complete: metricsValid && totalFiles > 0 && unexaminedFiles === 0 && invalidBundles === 0
      && missingFiles === 0 && missingChunks === 0,
    scope: 'manifest-bundle entries; eligible and covered counts are observed nonempty bundles'
  };
};

export const stampBundleEmbeddingCoverage = (manifest, coverage) => {
  manifest.bundleEmbeddings = coverage.complete;
  manifest.bundleEmbeddingCoverageEligible = coverage.eligibleFiles;
  manifest.bundleEmbeddingCoverageCovered = coverage.coveredFiles;
  manifest.bundleEmbeddingCoverageMissingFiles = coverage.missingFiles;
  manifest.bundleEmbeddingCoverageMissingChunks = coverage.missingChunks;
  manifest.bundleEmbeddingCoverageTotalFiles = coverage.totalFiles;
  manifest.bundleEmbeddingCoverageProcessedFiles = coverage.processedFiles;
  manifest.bundleEmbeddingCoverageUnexaminedFiles = coverage.unexaminedFiles;
  manifest.bundleEmbeddingCoverageInvalidBundles = coverage.invalidBundles;
  manifest.bundleEmbeddingCoverageComplete = coverage.complete;
};
