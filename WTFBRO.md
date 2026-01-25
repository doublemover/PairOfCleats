# WTFBRO
- CODEBASE_STATIC_REVIEW_FINDINGS_BUILD_FILEPROCESSOR_MISC.md: comment tokenization fast-path suggestion (file-processor.js). Skipped for now: current flow uses token counts to enforce minTokens and commentSegments, and changing tokenization behavior risks altering comment inclusion semantics without a clear spec; needs design decision before optimization.
