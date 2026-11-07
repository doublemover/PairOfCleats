/** Native analysis format is unchanged. Reconstructed analysis has a separate
 * semantic producer identity so earlier kind scans cannot silently replay.
 */
export const BENCH_ANALYSIS_SCHEMA_VERSION = 1;
export const BENCH_ANALYSIS_RECONSTRUCTION_VERSION = 2;
export const BENCH_REPO_MAP_KIND_COUNTER_VERSION = 2;
export const isCurrentBenchAnalysisReconstruction = analysis => analysis?.derivation?.producer === 'show-throughput-live-analysis'
  && analysis.derivation.version === BENCH_ANALYSIS_RECONSTRUCTION_VERSION
  && analysis.derivation.kindCounterVersion === BENCH_REPO_MAP_KIND_COUNTER_VERSION;
