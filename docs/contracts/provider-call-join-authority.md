# Provider call join authority

Provider target edges can supplement compiler summaries only for an actual caller-owned invocation in the same retained source as the provider partition. The edge origin must equal its call site, and its context must equal the owning partition's context. A matching callee name or foreign call-site reference does not supply origin authority.

Target and declaration-alias edges require a real retained evidence record whose owning partition has the same context and source, with the evidence's source reference agreeing. External declaration endpoints also retain their own context: an alias graph cannot carry an external declaration from one context through another context's edge. A canonical syntax declaration remains the explicit source-qualified boundary that can connect independent provider/compiler evidence; contexts are not compared by display name or URI.

The existing directional alias resolver, bounded scan/work/depth policy, candidate deduplication and call-versus-construct distinction remain unchanged. Accepted provider targets still supplement an unknown runtime remainder and never establish unique dispatch. When valid supplementation is emitted alongside rejected claims, coverage retains `provider_call_join_unqualified_evidence`. Rejected claims alone cannot manufacture a replacement complete summary.

The shared call-flow producer identity must advance because qualified target admission changes derived summary channels. Compiler bindings, request caches and provider response contents are unchanged by this consumer repair.

Authored actual retained-partition/atomic-merge/provider-join regressions add mismatched call origins/contexts, absent or wrong-kind evidence, mismatched evidence source and external-context bridges, alongside valid directional aliases, depth boundaries, cycles, uncertainty and invocation-kind controls. All are **UNVALIDATED**; no tests, syntax, lint, format, bootstrap, compiler/server/native/source execution or benchmark was run.
