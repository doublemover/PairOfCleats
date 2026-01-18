export const DEFAULT_USER_CONFIG_TEMPLATE = `{
  // Enable sqlite index artifacts for search backends.
  // Speed impact: adds sqlite build time when stage4 runs.
  "sqlite": {
    // Toggle sqlite index usage/artifact generation.
    // Speed impact: enabling adds some indexing time and disk usage.
    "use": true
  },
  // Enable LMDB artifacts for embeddings/cache backends.
  // Speed impact: adds LMDB build time and disk usage during indexing.
  "lmdb": {
    // Toggle LMDB index usage/artifact generation.
    // Speed impact: enabling adds some indexing time and disk usage.
    "use": true
  },
  // Enable Tantivy sparse backend support.
  // Speed impact: adds Tantivy index build time and disk usage when used.
  "tantivy": {
    // Toggle Tantivy backend enablement.
    "enabled": false,
    // Optional override for Tantivy index root (use {mode} placeholder if needed).
    "path": "",
    // Auto-build Tantivy index if missing when backend is requested.
    "autoBuild": false
  },
  // Search defaults for query-time behavior.
  // Speed impact: no direct impact on indexing speed.
  "search": {
    // Prefer ANN search by default when multiple backends exist.
    // Speed impact: no impact on indexing; affects query latency/recall.
    "annDefault": true,
    // Preferred ANN backend for dense vector search.
    // Speed impact: affects index artifacts and query latency.
    "annBackend": "lancedb",
    // Dense vector combination strategy for search.
    // Speed impact: minor impact on embedding/storage cost during indexing.
    "denseVectorMode": "merged",
    // Regex search guardrails.
    // Speed impact: no impact on indexing; affects regex query cost.
    "regex": {
      // Max regex pattern length accepted.
      // Speed impact: no impact on indexing; caps regex compile cost.
      "maxPatternLength": 512,
      // Max regex input length scanned.
      // Speed impact: no impact on indexing; caps regex runtime cost.
      "maxInputLength": 10000,
      // Max regex program size after compilation.
      // Speed impact: no impact on indexing; caps regex execution cost.
      "maxProgramSize": 2000,
      // Regex timeout in milliseconds.
      // Speed impact: no impact on indexing; limits regex runtime.
      "timeoutMs": 25,
      // Regex flags to apply by default.
      // Speed impact: no impact on indexing; affects regex behavior.
      "flags": ""
    }
  },
  // Index build pipeline options.
  // Speed impact: many flags here change CPU/IO per file.
  "indexing": {
    // Embeddings storage configuration.
    // Speed impact: enabling LanceDB adds indexing IO and disk usage.
    "embeddings": {
      // LanceDB vector storage options.
      // Speed impact: additional artifact writes at stage3.
      "lancedb": {
        // Toggle LanceDB artifact generation.
        // Speed impact: adds LanceDB write time and disk usage.
        "enabled": true,
        // LanceDB table name.
        "table": "vectors",
        // Column name for embedding vectors.
        "embeddingColumn": "vector",
        // Column name for chunk ids.
        "idColumn": "id",
        // Distance metric for ANN queries.
        // Speed impact: affects ANN scoring semantics.
        "metric": "cosine",
        // Max rows per insert batch.
        // Speed impact: higher values increase memory during build.
        "batchSize": 1024
      }
    },
    // Sparse postings generation settings.
    // Speed impact: heavier postings settings increase indexing time/size.
    "postings": {
      // Build phrase n-gram postings.
      // Speed impact: increases indexing time and index size.
      "enablePhraseNgrams": true,
      // Smallest phrase n-gram length.
      // Speed impact: lower values add more n-grams and cost.
      "phraseMinN": 2,
      // Largest phrase n-gram length.
      // Speed impact: higher values increase indexing time and size.
      "phraseMaxN": 4,
      // Build chargram postings for fuzzy matching.
      // Speed impact: noticeable extra CPU and disk usage.
      "enableChargrams": true,
      // Smallest chargram length.
      // Speed impact: lower values increase chargram volume and cost.
      "chargramMinN": 3,
      // Largest chargram length.
      // Speed impact: higher values increase chargram volume and cost.
      "chargramMaxN": 5,
      // Choose which fields contribute chargrams.
      // Speed impact: more fields increase indexing work.
      "chargramSource": "fields",
      // Cap token length eligible for chargrams.
      // Speed impact: higher caps increase CPU on long identifiers.
      "chargramMaxTokenLength": 48,
      // Track postings per field (name, path, body, etc).
      // Speed impact: slight overhead for richer scoring.
      "fielded": true
    },
    // When to scan imports ("pre" or "post" indexing).
    // Speed impact: small; "post" avoids extra upfront work.
    "importScan": "post",
    // Enable AST dataflow analysis.
    // Speed impact: moderate CPU cost on large codebases.
    "astDataflow": true,
    // Enable control-flow analysis.
    // Speed impact: moderate CPU cost on large codebases.
    "controlFlow": true,
    // Enable risk analysis rules.
    // Speed impact: moderate CPU cost; can be heavy on huge repos.
    "riskAnalysis": true,
    // Enable cross-file risk correlation.
    // Speed impact: heavy extra work on large repos.
    "riskAnalysisCrossFile": true,
    // Risk regex guardrails for analysis.
    // Speed impact: tighter caps can reduce analysis time.
    "riskRegex": {
      // Max regex pattern length accepted.
      // Speed impact: lower caps reduce risk regex compile time.
      "maxPatternLength": 512,
      // Max regex input length scanned.
      // Speed impact: lower caps reduce risk regex runtime cost.
      "maxInputLength": 10000,
      // Max regex program size after compilation.
      // Speed impact: lower caps reduce risk regex execution cost.
      "maxProgramSize": 2000,
      // Regex timeout in milliseconds.
      // Speed impact: lower timeouts reduce risk regex runtime cost.
      "timeoutMs": 25,
      // Regex flags to apply by default.
      // Speed impact: minimal; affects risk regex behavior.
      "flags": "i"
    },
    // Enable type inference.
    // Speed impact: moderate to heavy CPU cost.
    "typeInference": false,
    // Enable cross-file type inference.
    // Speed impact: heavy extra work on large repos.
    "typeInferenceCrossFile": false,
    // Collect git blame/churn metadata per file.
    // Speed impact: heavy IO/CPU; can dominate indexing time.
    "gitBlame": true,
    // Run linting pass for diagnostics.
    // Speed impact: extra CPU per file.
    "lint": true,
    // Compute complexity metrics.
    // Speed impact: extra CPU per file.
    "complexity": true,
    // Python AST parsing options.
    // Speed impact: small to moderate CPU on Python files.
    "pythonAst": {
      // Enable Python AST parsing.
      // Speed impact: small to moderate on Python-heavy repos.
      "enabled": true
    },
    // Tree-sitter parsing options.
    // Speed impact: moderate CPU, improved chunking accuracy.
    "treeSitter": {
      // Enable tree-sitter parsing.
      // Speed impact: moderate CPU on supported languages.
      "enabled": true
    }
  }
}`;
