export const DEFAULT_USER_CONFIG = {
  sqlite: {
    use: true
  },
  lmdb: {
    use: true
  },
  search: {
    annDefault: true,
    denseVectorMode: 'merged',
    regex: {
      maxPatternLength: 512,
      maxInputLength: 10000,
      maxProgramSize: 2000,
      timeoutMs: 25,
      flags: ''
    }
  },
  indexing: {
    postings: {
      enablePhraseNgrams: true,
      phraseMinN: 2,
      phraseMaxN: 4,
      enableChargrams: true,
      chargramMinN: 3,
      chargramMaxN: 5,
      chargramSource: 'fields',
      chargramMaxTokenLength: 48,
      fielded: true
    },
    importScan: 'post',
    astDataflow: true,
    controlFlow: true,
    riskAnalysis: true,
    riskAnalysisCrossFile: true,
    riskRegex: {
      maxPatternLength: 512,
      maxInputLength: 10000,
      maxProgramSize: 2000,
      timeoutMs: 25,
      flags: 'i'
    },
    typeInference: false,
    typeInferenceCrossFile: false,
    gitBlame: true,
    lint: true,
    complexity: true,
    pythonAst: { enabled: true },
    treeSitter: { enabled: true }
  }
};
