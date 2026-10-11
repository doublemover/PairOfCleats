# PairOfCleats enrichment architecture and scaling requirements

Prepared 11 October 2026. This is an engineering design, source review and experimental implementation report. The finite-string slice described below is implemented; the broader proposed backend and complete feasibility claim are not established.

## Conclusion

Whether the full requested enrichment can be completed within the required time, RAM, and disk envelope is still open. We have evidence of avoidable expansion and concrete defects; we do not yet have a proof or measured implementation meeting all those constraints. File batches, larger heaps, and spilling an expanded graph do not establish feasibility. A few lines of conditional or recursive types can create more work than thousands of ordinary files.

A shared, typed, cyclic intermediate graph; symbolic type applications and call effects; context-correct memoization; and explicit, verifiable passes are a serious research and implementation direction. A multi-level IR is an appropriate architectural model to investigate. None of those techniques alone proves that the complete required answers can be obtained affordably.

There are two separate requirements:

1. Retain every required source fact and semantic operation without repeatedly copying shared structure or enumerating every implied combination.
2. Compute the requested semantic answers without making the TypeScript checker eagerly construct the expansion that the new representation was supposed to avoid.

Many sharing improvements for the first requirement can be implemented in PairOfCleats. Avoiding expansion inside the checker itself requires changes below the current TypeScript API boundary, or a genuinely different compiler backend with demonstrated TypeScript compatibility. Putting an IR after `getTypeAtLocation`, `getResolvedSignature`, or `typeToString` cannot prevent an explosion that already happened inside those calls.

The candidate design below specifies intermediates, lifetime and storage accounting, reconstruction contracts, counterexamples, and acceptance tests. Its feasibility must be established separately for each required operation and then end to end. It aims to eliminate identifiable, avoidable expansion and expose remaining costs. It does not promise constant memory or linear running time for arbitrary exact TypeScript questions.

## The feasibility question must specify the output

These are different requirements, not interchangeable descriptions of “everything”:

1. All source, structural, binding, and directly represented semantic facts.
2. A finite representation from which all facts of a stated analysis can be derived.
3. All requested query answers already computed, or obtainable within a stated latency bound.
4. Every pair in a transitive relation, every instantiated alternative, or every possible path explicitly enumerated.

The existing legacy output is closest to a finite list of target answers; the semantic API combines stored direct facts and bounded trace queries. A proposed factorized store can preserve a relation's denotation while changing the latency of accessing it. That change needs explicit acceptance; it is not automatically equivalent to precomputing the required answers. Storing source plus an interpreter is a compact description of many answers, but plainly does not satisfy a precomputed semantic-index or query-latency requirement.

No specific end-to-end time/RAM/disk acceptance envelope was supplied for this design review. Before an actual feasibility verdict, the required fact families, exactness reference, export/query obligations, and resource envelope must be fixed. “Same answers as TypeScript 5.9.3, including its diagnostics” also differs from “unbounded evaluation of all type-level expressions.” Neither should be silently substituted for the other.

There are unconditional lower bounds. Writing `O` output bytes takes at least proportional output work and storage if the bytes must remain stored. For an arbitrary relation on `n` independent entities, there are `2^(n*n)` possible adjacency matrices, so some relations require proportional to `n*n` bits to distinguish exactly. Dense but regular relations may compress well; arbitrary independent evidence need not. This is an information-content argument, not a claim that a tiny source file contains that many independent bits. A compact source can describe a huge derived result, but decoding and answering it may still exceed the time bound.

The output bound rules out fitting an arbitrarily large explicitly enumerated result into a fixed smaller storage allocation. It does **not** establish that an exact compact answer or fast query algorithm is impossible. For example, membership in the set of all `k`-bit strings is easy without enumerating its `2^k` members. A valid equivalence or suitable symbolic representation can make a seemingly astronomical space tractable. The actual SuperSlopRoad workload has no feasibility verdict yet. Establishing one requires identifying its unique information, exploitable sharing, required operations, and irreducible evaluation costs. The proposed architecture is a way to test those hypotheses, not a proof that they will succeed.

### Query-specific complexity rather than a universal impossibility claim

The relevant established perspective is **knowledge compilation**: choose a representation by both its succinctness and the queries/transformations it supports. A compact representation does not grant every query the same complexity. Darwiche and Marquis make these dimensions explicit; their paper was published in 2002, although the linked arXiv upload is from 2011. [A Knowledge Compilation Map](https://arxiv.org/pdf/1106.1819)

The following are direct reductions for the finite-string model used here. They are analysis of this restricted IR, not claims that these papers prove PairOfCleats or bounded TypeScript enrichment impossible.

Fix alphabet `{0,1}` and permit only `Literal`, finite `Union` and `Concat`. Given a DNF Boolean formula `D` on `n` variables, encode each consistent term as a concatenation of `n` positions: a positive literal fixes its position to `1`, a negative literal fixes it to `0`, and an absent variable contributes `Union("0", "1")`. Omit contradictory terms. Union the term languages to obtain `L(D)`, using O(n times the number of terms) structure. Its words are exactly the satisfying assignments of `D`. The compact all-assignments language `A(n)` is `Concat(Union("0", "1"), …)` with `n` positions. Therefore:

- `L(D) = A(n)` exactly when `D` is a tautology.
- `A(n)` is included in `L(D)` under the same condition.

Negating a CNF formula gives a DNF formula of polynomial size, so deciding either language question decides CNF unsatisfiability. Thus unrestricted equality and this direction of inclusion in this finite-language model are coNP-hard. This is a query distinction, not a hardness claim for membership of one supplied word. The classical propositional reduction foundation is Cook's 1971 result. [The Complexity of Theorem-Proving Procedures](https://www.cs.utoronto.ca/~sacook/homepage/1971.pdf)

For exact distinct counting, start with a CNF formula `F`. Encode the assignments that violate each clause using the same fixed/free-position construction and union them into `V`. Then `#SAT(F) = 2^n − |V|`. One exact language-cardinality query plus polynomial-time subtraction therefore computes #SAT. This proves #SAT-hardness under that reduction. It is not valid to replace `|V|` with a sum of clause counts: the same assignment may violate multiple clauses. Valiant's counting framework supplies the established complexity foundation. [The Complexity of Enumeration and Reliability Problems](https://www.math.cmu.edu/~af1p/Teaching/MCC17/Papers/enumerate.pdf)

These reductions do not prove unconditional exponential running time, do not classify the measured repository, and do not rule out fast exact algorithms on its exploitable structure. They show precisely why adding arbitrary equality/inclusion/distinct-count queries would be a stronger obligation than the implemented explicit-word membership and zero/one/many-with-witness operations. Compiling to a representation with easier queries can move work into construction or increase stored size; those costs must be measured, not erased from the accounting.


## What is established and what remains proposed

### Separate concrete defects

The current investigation established physical-file and virtual-file duplication in legacy TypeScript program roots. The related change canonicalizes eligible full-file aliases. A separate controlled investigation reported a 2,000-document fixture dropping from 4,000 to 2,000 source files, with checker heap approximately 420 to 221 MiB and post-target heap approximately 635 to 436 MiB. These are reported fixture results, not measurements of SuperSlopRoad, and they do not establish that pathological types are solved.

The stage-transition investigation separately found and repaired a finish/checkpoint race. Its real-tracker regression reproduces loss of the final 8,118-to-8,168 completion update while heartbeats continue. The regression failed before the fix in 2.64 seconds; the six focused fixtures passed afterward in 1.76 seconds, and the final gate was reported passing in 7.96 seconds after the preceding checks. These are investigation receipts, not a direct observation proving this race caused the production retry's wait.

During the investigated retry, recorded RSS decreased from approximately 3.63 to 1.80 GB with only 1.83 seconds of additional CPU, followed by deliberate exit status 1. That evidence does not show a second OOM. The checkpoint repair and the compiler representation problem must be evaluated separately.

The original recorded failing legacy run used 8,621 documents and 48,806 targets, with semantic mode disabled, and exhausted a 4 GiB JavaScript heap. The larger-heap retry's pre-enrichment wait and the first run's OOM have different evidence and must not be conflated.

### Small type shape measurements

The investigation also ran nine fresh-process fixtures under TypeScript 5.9.3 and Node 26.11.1, each with a 768 MiB heap cap and a 29-second process timeout. All nine completed successfully with clean semantic diagnostics. They retained the real default libraries and an ambient declaration, producing the same 53-source-file program inventory. The successful receipt files were read for this report; initial invalid-instrumentation attempts are excluded.

| Type shape | Width | User source bytes | Source AST nodes | Union alternatives | Final type count | Final generic instantiations | Signature and parameter query time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Four-axis distributive product | 4 | 351 | 89 | 256 | 448 | 681 | 16.60 ms |
| Four-axis distributive product | 12 | 399 | 105 | 20,736 | 22,744 | 45,241 | 133.13 ms |
| Recursive permutation | 4 | 272 | 69 | 24 | 273 | 533 | 20.69 ms |
| Recursive permutation | 7 | 290 | 75 | 5,040 | 14,651 | 8,498 | 75.03 ms |
| Four-axis template product | 4 | 183 | 50 | 256 | 439 | 0 | 13.78 ms |
| Four-axis template product | 12 | 231 | 66 | 20,736 | 22,735 | 0 | 52.32 ms |

These establish amplification from type shape with tiny inputs; they do not reproduce the production OOM or prove a replacement solves it. Distributive-product post-query heap rose from approximately 55.5 to 66.0 MiB. The template case is especially useful: generic-instantiation count stays zero while type alternatives grow dramatically. The distributive case ultimately formats only 159 bytes of display text despite constructing over twenty thousand alternatives. Required answer size and intermediate checker work are already visibly different quantities.

### Review scope

The code review used the cloud checkout of PairOfCleats on `fix/enrichment-resource-diagnosis`, initially based on `bee75cc882f81988b34340451d261c1cefa936b7`, including the root-alias changes. The completed fix batch is now committed at `679573bd885bb0047f5760db0608ff13a7590020` (`Register enrichment regressions and refresh generated test governance`). Relevant source locations below refer to the reviewed files. The initial architecture review was read-only. Subsequent authorized implementation added the finite-string/frontend/storage slice and the runtime bridge described below; these should be evaluated separately from that original fix batch. No production full index was run for this report.

The source-repository configuration evidence supplied to this investigation is SuperSlopRoad commit `f4c65261bcfe1995c6ac3bb6340a770629de60f1`: `customConditions: ["development"]`, `moduleDetection: "force"`, composite/declaration settings, NodeNext package configurations, a Bundler web configuration, and several package exports selecting source TypeScript under `types` or `development`. These are important semantic inputs. It is not valid to assume that a package or project reference bounds the actual compiler closure. Official TypeScript project references can use declaration outputs, but actual resolution and source redirection must be established for this repository and configuration. [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)

## The existing contracts

### Legacy enrichment

`src/index/tooling/typescript-provider.js` creates a whole TypeScript `Program` for each nearest-config group, obtains its checker, and visits the group's document targets. The actual closure includes resolved dependencies; root count is not the closure size.

The result contract is a provider envelope plus `byChunkUid`. Function-like targets receive:

- Return type text
- Parameter names and type text, confidence, and source
- Signature text
- Heuristic symbol identity and defining chunk
- Provider provenance
- Diagnostics distinguishing unavailable runtime, target mismatch, and skipped work

See `typescript-provider.js:102–128, 345–351, 408–432`. These outputs do not require storing all transitive relationships between all symbols. They do require preserving target matching, lexical formatting context, source/config semantics, and the same type answers. Formatting itself can force costly checker work. The current calls do not request `TypeFormatFlags.NoTruncation`; current display strings are not a complete structural type representation.

### Opt-in semantic enrichment

`src/contracts/schemas/semantic.js` defines source-qualified records and explicit edges. Important semantic families include declarations, occurrences, operands, bindings and candidates, references and aliases, control flow, value/storage flow, calls and parameter/return channels, worker/boundary channels, provenance, ownership, coverage, and runtime joins.

An edge carries its kind, source and destination, call site, operand ordinal, context, condition, evidence, and certainty. `exact-static`, `modeled`, and `heuristic` are different claims. They must remain different after any representation change. A shared callee is not permission to merge different callers' execution contexts.

Partitions have immutable content hashes. Source bytes, mapping identity, parser/extractor version, producer versions, compiler context, and analysis policy contribute to identity. Completed partitions are published as a whole generation; detail and trace requests pin that generation. Existing trace logic balances argument/return call crossings to avoid entering through one call and leaving through another. See `identity.js`, `file-ref.js`, `reconcile.js`, `src/semantic/trace.js`, and `trace-context.js`.

These are valuable contracts to preserve. The new architecture must also preserve currently supported local/storage/value flow, worker/channel/boundary evidence, embedded source mapping, LSP and runtime evidence, and legacy chunk enrichment. Replacing the system with only a call graph would silently remove capabilities.

### Why the current semantic store is insufficient

The store bounds writer batches and query hydration; it does not bound compiler state or all producer state:

- `compiler-session.js:30–79` reads and retains every admitted source's text and inventories declarations.
- `compiler-session.js:160–182` uses the same whole-closure TypeScript program context.
- `compiler-session.js:362–377` retains flow edges, calls, summaries, bytes, and a second set of per-document worker observations containing AST/checker references until `finishGroup`.
- `compiler-call-summaries.js:23–45` builds a group-wide reverse flow graph and call graph. It constructs a new document-alias map for each function summary in that document; this can itself multiply memory by functions per document.
- Binding and flow producers build arrays and deduplication maps before writing. A bounded sink does not bound those already-created arrays.
- `compiler-cross-file-flow.js:71–95` instantiates call effects against following reads. Its unknown-call fallback can materialize a call-by-read product.
- `compiler-session.js:161–169` keys context on the whole program inventory; each cross-file partition also includes all group flow hashes and policies. This is conservative but causes broad invalidation.

The existing SCC solver is a useful starting point, not a full solution. It has a global one-million-work limit and iteration limits; recursive field paths can be widened/dropped with partial coverage. Defaults are eight SCC rounds and field depth two, or twelve rounds and depth four under `rich`; `callContextDepth` defaults to zero or one. Increasing these numbers does not change the expansion model.

The admission mechanism correctly describes its reservation as policy admission, not a hard process-memory bound. Default limits include 10,000 closure files, 128 MiB of closure bytes, 32 projects, and a 512 MiB resident reservation. Those limits may defer work; they cannot turn a large or pathological computation into a completed equivalent result. See `compiler-admission.js` and `config.js`.

## What the older graph literature actually contributes

These techniques address different costs and should be applied at the correct layer.

### Schorr and Waite

The 1967 algorithm marks shared and cyclic list structures using pointer reversal to remember the traversal route, restoring pointers afterward. It avoids an unbounded separate traversal stack by using the representation itself and mark state. This directly supports treating enrichment as graph traversal rather than repeatedly recursively unfolding aliases, cycles, or shared subgraphs. [Original paper](https://www.cs.purdue.edu/homes/hosking/690M/p501-schorr.pdf)

Its limit is equally important: reducing traversal auxiliary storage does not reduce the live graph, shrink genuinely distinct generic instantiations, or compress an explicitly requested output. PairOfCleats cannot reverse pointers in immutable published facts or a concurrently read graph. Pointer reversal is suitable only in an exclusively owned mutable arena with restoration guarantees, or a dedicated mutable traversal representation whose cost is counted. For immutable/shared storage, compact visitation state and iterative cursors are the safer initial implementation. Copying the entire graph merely to reverse its pointers would defeat the intended saving.

### Ershov and shared expressions

Ershov's 1958 construction identifies repeated operations from operation codes and operand identities instead of generating duplicate expression computations. The applicable idea is canonical operation interning, commonly implemented as hash-consing. [Original translated paper](https://www.cs.utexas.edu/~hunt/research/hash-cons/hash-cons-papers/ershov-8-1958.pdf)

For this system, intern immutable structural type terms, substitutions, field paths, candidate sets, and effect expressions. Equality must include semantic context and identity-bearing declarations where required. Textual equality alone is not sufficient, and interning has its own storage cost. Cycles need explicit recursive binders or SCC handles; they cannot be hashed by recursively serializing their unfolded trees.

### Tarjan and recursive components

SCC decomposition makes recursive dependencies explicit and permits processing the condensation DAG in dependency order. Its graph-processing bound is linear in the represented vertices and edges. It says nothing about how many instantiated vertices a type evaluator will create, how large one component can be, or how hard the component's transfer functions are. [Tarjan 1972](https://doi.org/10.1137/0201010)

### Reps Horwitz and Sagiv

IFDS gives precise interprocedural valid-call/return-path analysis for a finite fact domain and transfer functions distributive over the chosen confluence operator. Its general time bound includes a cubic fact-domain term, `O(E D^3)`, rather than being simply linear in source size. [Original paper](https://www.cs.cornell.edu/courses/cs711/2005fa/papers/rhs-popl95.pdf)

This is a concrete candidate for qualified dependency/taint/reaching-definition dialects. It replaces unbounded call-string copying with shared summaries. Before selecting it, each flow pass must state its fact universe and prove distributivity; stateful heap aliasing, arbitrary type-level computation, and unrestricted field paths do not automatically qualify. Applying IFDS to the whole TypeScript checker without that proof would be an unsupported claim.

### MLIR and incremental query systems

The useful MLIR pattern is multiple verified dialects over one graph, explicit operations/regions, analysis dependencies, and controlled lowering. Its representation and pass infrastructure do not by themselves supply a TypeScript evaluator or a bounded-memory guarantee. The design can follow those principles without introducing the entire LLVM/MLIR toolchain. [MLIR language reference](https://mlir.llvm.org/docs/LangRef/) and [pass infrastructure](https://mlir.llvm.org/docs/PassManagement/)

Shared indexes should serve multiple analyses rather than each analysis rebuilding the same reverse graph. That is the relevant idea behind differential-dataflow shared arrangements; it does not mean every derived relation should be eagerly materialized. [Shared Arrangements](https://arxiv.org/abs/1812.02639)

### Demand-driven compositional symbolic execution

Anand, Godefroid and Tillmann (2008) compose intraprocedural execution summaries through first-order formulas, uninterpreted function symbols and calling-context predicates. Partial summaries explicitly retain dangling-path flags. Their first solver query disables unresolved paths to seek a target using known behavior; if unsuccessful, a second query admits those paths to guide refinement. First-query unsatisfiability alone does not establish unreachability; second-query satisfiability need not produce an input that reaches the target. [Demand-Driven Compositional Symbolic Execution, sections 4.2–4.3](https://www.microsoft.com/en-us/research/wp-content/uploads/2008/01/fulltext.pdf)

Their relative-completeness/progress results assume perfectly precise constraint generation and solving. Termination additionally requires finitely many paths; the presentation excludes recursive calls. Formula size is linear in the **explored execution trees**, not necessarily source size, and solving remains costly. Heap-effect summarization was ongoing work. [Same paper, sections 2, 4–7](https://www.microsoft.com/en-us/research/wp-content/uploads/2008/01/fulltext.pdf)

For this design, the useful lesson is explicit query demand, reusable summaries and unresolved obligations. A solver timeout/unknown, unsupported effect or unrefined summary cannot become an exact negative answer. The implemented finite-string kernel is not compositional symbolic execution: it has no program-path summaries or SMT solver. “Demand-driven compositional program analysis” names the broader approach, not a guarantee of efficiency or completeness.

### The supplied persistent e graph paper

The supplied February 2026 paper embeds an `eqsat` dialect in xDSL/MLIR so discovered equivalences survive across abstraction levels, with constructive rewriting, cyclic graph regions, analyses, and partial extraction. Its example warns that eager scalar rewriting can grow the e-graph exponentially before simplification; a helpful high-level rewrite in one example harms sharing in another. The described extraction assumes pure operations. Its Herbie case study reaches the e-node limit in every benchmark, so it does not demonstrate unrestricted saturation or a universal resource bound. [E-Graphs as a Persistent Compiler Abstraction v1, sections 2, 4 and 5](https://arxiv.org/pdf/2602.16707v1)

For PairOfCleats, the research opportunity is to retain proved equivalences and high-level operations without repeatedly lowering and reconstructing them. Equality saturation is optional search over alternative representations, not a requirement to enumerate all enrichments. An e-class denotes equivalent expressions; a binding candidate set or may-flow union contains alternatives that need not be equivalent. Conflating these would be unsound. Neither this paper nor compact e-graphs establish that all required TypeScript answers fit the budget.

## Proposed multi-level representation

The following is proposed implementation work.

### Level 0 Source and structural IR

Retain immutable source blobs, source maps, full syntax/operands, declaration anchors, lexical scopes, import/export operations, and direct containment/ownership. Preserve every source construct, including constructs not yet understood by a higher analysis. Parse each distinct source/dialect/config-sensitive syntax input once. Retain no checker object as a durable fact.

A source operation has an immutable source identity and stable local anchor. Whole-file physical and VFS aliases may share storage only when exact content, mapping, and resolution origin justify it. Equal bytes from distinct paths do not make declarations the same symbol. Symlink behavior must follow the active resolution semantics.

### Level 1 Resolution and symbol IR

Represent module-resolution results, export/alias equations, ordered declaration sets, overload sets, ambient contributions, nominal/private origins, and merged symbols. Direct occurrences refer to shared symbol/candidate-set nodes rather than copying candidate arrays at every occurrence.

The resolver records actual dependencies: configuration, package exports/imports, custom conditions, resolution mode at the import site, `types`/`typeRoots`, libraries, source mappings, realpath behavior, successful lookups, and failed probes whose answers affect resolution. A newly created previously missing module can change a result, so negative dependencies matter.

Do not collapse a file compiled under NodeNext and Bundler into one semantic context merely because its source bytes match. Syntax may be shared; resolved meaning may differ.

### Level 2 Symbolic type IR

Represent types as typed operations with handles:

- Primitive and literal types; declaration and type-parameter references
- Ordered signatures and overloads; tuple/object/member constructors
- Unions/intersections with appropriate identity and ordering metadata
- Alias application, generic application, and substitution environments
- Conditional types with distribution semantics and inference binders
- Mapped types, indexed access, `keyof`, and template-literal products
- Recursive binders/back references
- Deferred evaluation obligations with source evidence and semantic context

`Apply(F, environment)` retains one definition of `F` plus a persistent substitution environment. It must not copy the entire body of `F` for every call or recursively substitute a large tree before any operation needs it. Union distribution and template products remain operations with iterator/membership semantics until a specific query needs expansion.

Canonicalize by operation, operands, binder environment, and relevant semantics. Preserve TypeScript distinctions such as fresh object behavior, private/unique-symbol identity, overload order, narrowing state, `any`/`unknown`/`never`, and context-sensitive formatting. Commutativity or alpha-renaming is allowed only where the language semantics and presentation contract justify it.

### Level 3 Control and effect IR

Represent each function body once, with CFG regions, values, guards, storage/access-path expressions, exceptional exits, captured environments, and boundary operations. Model a call as an application of a callee summary with actual-to-formal bindings, return destination, exception continuation, storage substitution, and call-site identity.

A shared callee summary has formal inputs and symbolic effects. Ten thousand callers should add ten thousand application records and their actual arguments, not ten thousand copies of the callee's body or effect graph.

For example, a summary that writes `parameter[0].field` from `parameter[1]` remains one write template. Caller-specific alias substitution identifies the receiver. Matching it to later reads uses keyed root/path/program-point indexes. Unknown calls can retain an exact relation rule denoting the existing conservative may-write set rather than eagerly writing every call/read pair. The rule's meaning must be explicit and its expansion must reproduce the intended relation; replacing many edges with an unqualified “unknown” label is not equivalent.

Recursive field-path expressions may sometimes be represented by tries, automata, or recursive equations. An automaton is appropriate only after proving that the relevant path language belongs to that representation. Arbitrary recursive type/effect computation cannot be assumed regular.

### Level 4 Query and presentation IR

Separate these operations:

- Does a relation hold?
- Which declarations can this occurrence denote?
- What is the compact type expression?
- What is a witness path with correctly matched calls/returns?
- Enumerate the next page of neighbors or expanded alternatives
- Format a target's legacy type/signature text

Each should consume the compact graph directly and materialize only its response. A complete compact relation can be stored without eagerly enumerating every answer. However, merely storing a thunk for an unanswered required type query is not completion of enrichment. Every requested answer needs either a verified answer or an explicit unresolved/blocking status; pending computations cannot be relabeled complete.

## Evaluation and memoization

Memoization must be keyed on meaning. A usable key contains the operation and canonical operands, substitution/binder environment, relevant lexical or control-flow context, resolution and ambient context, semantic producer/compiler version, and analysis policy. Formatting additionally depends on enclosing declaration, naming/alias scope, and format flags. A cache keyed only by type text, callee name, or source span is unsound.

The evaluator should expose `unseen`, `evaluating`, and `complete` states plus dependency edges and resumable continuations. Re-encountering an evaluating node discovers recursion; it is not universally evidence that the answer is true. Recursive assignability, recursive type construction, and monotone may-flow require different semantic rules.

For a finite monotone flow domain, solve each recursive component with a delta worklist until no fact changes. Propagate only newly added facts, and share indexes by the actual join key. Recomputing all reverse reachability for every function on every round is unnecessary. For deletions between snapshots, either retract derived support correctly or invalidate and recompute the affected SCC; additive propagation alone is insufficient.

For type operations, retain symbolic structure and memoize repeated obligations; do not normalize every type globally. Algebraic rewrites and sharing must have semantic preconditions. A conditional type that depends on an inference context cannot be normalized independently of that context.

Associativity, commutativity, and distributivity need explicit strategy. Where valid, use a canonical n-ary representation for associative/commutative structure instead of repeated binary reassociation and swapping. Preserve source/presentation order separately. Keep products factored unless the requested operation requires distribution. Orient normalization rewrites with a well-founded measure where possible; record already-processed rule/operand combinations, and distinguish equality discovery from mandatory semantic evaluation. Do not alternate distribution and factorization indefinitely. A congruence-closed e-graph can share equivalent terms and still admit endlessly new terms, so a visited set alone does not solve the search space.

This is not permission to choose one cheap candidate and discard required evidence. Keep original source occurrences and their provenance distinct while sharing proved-equivalent semantic cores. JavaScript addition, side effects, floating-point behavior, nominal type identity, and context-dependent type operations cannot inherit algebraic rewrite laws merely because their printed operators look familiar.

An optional representation-optimization search can stop while retaining its original, already valid representation and all required meaning. That need not reduce semantic coverage; it sacrifices further optimization. Stopping an unfinished mandatory binding/type/flow computation is different. This separation is essential: we should not require full equality saturation merely to construct a correct index, and we must not use an optimizer timeout as evidence that all required semantic answers have been computed.

Resource scheduling may pause a computation at a verified continuation and resume it. It must not replace unfinished output with `any`, shorten a field path, stop after an arbitrary number of rounds, or skip files to claim success. If the required exact answer cannot be computed within the authorized resources, that remains a blocker rather than a passed scaling test.

## Incremental invalidation

The current full-program hash is safe but coarse. Replace it only after dependency capture is complete.

Cache separate syntax, resolution, type/interface, body/effect, and presentation results. On a changed input, revalidate the dependent computation and compare its resulting fingerprint; unchanged results should stop invalidation propagating further. This resembles rustc's red-green strategy. [Rust compiler incremental compilation](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation-in-detail.html)

Important consequences:

- A body edit may leave exported type answers unchanged but alter effect summaries and provenance.
- An unchanged `.d.ts` surface is not enough to reuse interprocedural flow results.
- A configuration, ambient augmentation, library, package export condition, or failed resolution probe can affect many files legitimately.
- Cyclic dependencies need component-level invalidation or a correct dynamic dependency algorithm.
- Different requests may reuse a structural term while needing different derived answers.

Preserve the existing source pinning, producer-version invalidation, replay journal, leases, and whole-generation publication. Do not create a competing recovery protocol. New analysis meaning must change the appropriate shared producer version; a changed public fact representation also needs a schema/artifact migration.

## Exact intermediate and lifetime plan

### Durable information

Keep one authoritative copy of each required immutable source blob, structural partition, compact semantic definition, context descriptor, symbolic application/effect relation, and completed dependency fingerprint. Share them across generations by immutable object identity where the storage contract permits. A generation manifest names these objects; it does not concatenate them into a giant graph.

Stable references must survive physical repartitioning. Existing source/partition references provide a foundation. Runtime compiler pointers and global allocation counters are not durable identities. Recursive objects require explicit binders or deterministic component-local IDs plus external handles, rather than recursively hashing an infinite expansion.

### Temporary information

Use bounded parse/decode arenas, active-pass scratch, current SCC deltas, query memo state, small output pages, and writer/index-construction buffers. An intermediate can be released when its downstream consumers have either published their result or retained a sufficient canonical dependency/continuation. If multiple passes need a shared index, account for one shared index with references, not an independent map per pass or per function.

Checkpoint only canonical compact state and continuation positions. Do not persist a TypeScript heap image or an expanded per-caller graph. Bound recomputable caches separately from required source and committed graph data. Pinned evidence and active-generation objects cannot be silently evicted.

### The present disk multiplier

The current writer stores uncompressed canonical JSONL and an eight-byte offset for each row. `query-index.js:45–50` adds an adjacency-index row for both endpoints of most edges. Its bounded-fan-in sort retains original runs and all merge generations until final output succeeds (`58–76, 123–125`). Thus bounded RAM currently permits multiple full on-disk index copies. Incremental semantic cache copying can add another physical copy; it explicitly avoids hard-linking published generations.

A near-term physical improvement is to retire verified consumed merge runs as soon as their replacement is durable, with crash-safe ownership and correct accounting. That reduces sort workspace, but it still does not solve expansion of the relation itself. Shared-object publication would be a separate storage-contract change, not permission to hard-link mutable files into a published generation.

### Proposed peak accounting

Let `S` be retained source bytes, `N` structural records, `E0` direct represented edges, `C` call sites, `A` actual arguments, `U` unique symbolic terms, `I` distinct substitution environments, and `R` compact summary/relation storage. A physical representation should be charged approximately as:

`durable bytes = S + bN*N + bE*E0 + bC*C + bA*A + bU*U + bI*I + bR*R + required indexes and provenance`

The coefficients are measured encoded bytes, not guesses based on source lines. `U`, `I`, and `R` are not guaranteed linear in source size; keeping product/recursive operations symbolic is what avoids many expansions.

`peak disk = pinned old-generation objects + new unique objects + active durable intermediate/index work + journal/WAL/metadata + temporary output`

`peak RAM = process baseline + hot decoded pages + active owned IR arena + admitted query/SCC state + writer buffers + unavoidable pinned compiler state`

All categories need telemetry and one accounting owner. There must be no assumption that an 8 GiB semantic-disk setting also accounts for every unrelated index/cache artifact. If one active component exceeds memory, the new owned IR engine can page its compact structures; the current TypeScript checker cannot arbitrarily evict its internal state through the public API. Paging bounds residency but can cost substantial random I/O and does not promise a small total graph.

An honest cap prevents unsafe allocation and preserves recoverable progress. It does not prove that the requested result fits. If required compact data itself exceeds capacity, additional storage or a changed requirement is necessary.

### Proposed artifact layout and ownership

This is an **unimplemented example of a versioned backend contract**, not the layout produced by current code. The names and encoding would be reviewed with the schemas before implementation. It deliberately reuses the existing build owner, semantic-frontier control store, drain journal, and publisher rather than creating another scheduler or publication pointer.

```text
<repoCacheRoot>/semantic-ir/objects/sha256/<prefix>/<hash>.cbor
    Immutable source, syntax, symbolic-type, effect, and context objects.
    Each blob is stored once per content hash within this proposed store.

<buildRoot>/index-code/semantic/ir-work/<taskId>/<leaseFence>/
    pending/<sequence>.part       Uncommitted bounded object writes
    indexes/<indexKind>/run-*     Current task-owned sorted runs only
    continuation.cbor            Optional checkpoint of compact resumable state
    attempt.json                 Input hashes, producer versions, ownership,
                                 checksums, durable sequence and reservations

<buildRoot>/index-code/semantic/ir-indexes/<indexHash>/
    pages/*.bin                  Completed compact direct/relation indexes
    descriptor.json              Keys, ranges, lengths, hashes, codec version

<buildRoot>/index-code/semantic_manifest.json
    A future schema names source roots, IR object roots, context roots,
    indexes, coverage and completed task receipts for this generation.

<repoCacheRoot>/semantic-frontier/control.sqlite
<repoCacheRoot>/semantic-frontier/drains/<requestId>.json
    Existing lease/completion and publication-recovery owners, extended
    with the new descriptor types rather than replaced.
```

The shared object store is a proposed storage migration. Current `resolveSemanticPartPath` intentionally restricts parts to their own root; it cannot follow these proposed cross-build references. A new object resolver would accept only content hashes under a configured, realpath-verified object root, verify length/hash/codec, and reject arbitrary paths. Published readers pin manifests and reachable object roots. Mark-and-sweep reachability from pinned generations, active tasks, and retained evidence determines reclamation; simple reference counting alone does not reclaim cyclic objects. Until that migration exists, per-build immutable copies remain a real disk cost and must appear in the budget.

| Intermediate | Identity and owner | RAM residency | Durable lifetime and deletion rule |
| --- | --- | --- | --- |
| Source blob | Exact byte hash; source namespace/path/mapping remains in its manifest | One admitted decoding window | While any pinned source/generation/evidence references it |
| Syntax component | Source identity plus parser/extractor/dialect versions; extraction task | Active parse arena, then decoded pages | Immutable after verified commit; reusable independently of derived analysis |
| Resolution context | Options, resolver/compiler version, relevant package/library/probe dependencies; resolver task | Small descriptors plus admitted lookup pages | While referenced; invalidate on changed positive or negative dependencies |
| Symbolic type/effect component | Canonical component payload, external handles, semantic version and required context; pass task | Active owned component/pages | Immutable once complete; recursive local refs never trigger recursive serialization |
| Query memo and SCC deltas | Operation key plus dependency versions; leased evaluator task | Charged entries/pages with resumable iterators | Recomputable entries may be evicted; indispensable unresolved state must be checkpointed or recomputable from a declared boundary |
| Sort/index run | Task ID, lease fence, sequence, key schema, checksum; index task | Bounded merge input/output pages | Delete only after verified replacement is durable and recorded; never retain every old merge generation |
| Output page | Generation, request key, stable enumeration position; query owner | One response page and bounded continuation | Release after response/cursor lifetime; not a permanent expanded graph |
| Generation manifest | Existing build/publication identity plus new schema | Descriptor only | Publisher exposes only verified roots; retained old readers keep their old roots pinned |

### Proposed minimal component schema

The example below is structural notation. `H`, `C`, and symbolic local labels stand for actual validated IDs; they are not literal deployed IDs. A production schema would select explicit version constants rather than reuse the current `semanticSchemaVersion: 1` for a changed meaning.

```text
ComponentEnvelope {
  format: "poc-symbolic-ir-experimental-1",
  dialect: "types" | "symbols" | "effects" | "resolution",
  producer: { name, semanticVersion },
  requiredContext: C | null,
  externalInputs: [{ objectHash: H, exportOrdinal, expectedSemanticHash }],
  records: [{ localOrdinal, opcode, operandRefs, attributes }],
  exports: [localOrdinal],
  sourceAnchors: [{ localOrdinal, sourceUnitId, syntaxRecordRef, role }]
}

operandRef = { localOrdinal }
           | { externalInputOrdinal }

objectHash = SHA256(domain || canonical encoded ComponentEnvelope)
```

Local ordinals are deterministic within a component and can refer backward or forward; cyclic members are serialized once. Hash the finite component encoding, not the recursive tree obtained by chasing references. External inputs must be acyclic between the chosen component boundaries, or the mutually recursive objects must be put in one finite component. Source anchors preserve distinct occurrences even when semantic operations share. Content-addressing uses collision-resistant hashes with byte verification, not an assumption that hash equality overrides incompatible metadata.

On duplicate insertion, compare the expected codec/version, length, and canonical payload bytes with the existing object before reusing it. A hash collision or conflicting payload is an integrity failure, never permission to merge. Cyclic identity comes from explicit binders or deterministic SCC-local anchors and a finite component payload; process allocation order is not canonicalization.

Authoritative objects include exact source/configuration snapshots, preserved source anchors/evidence, published semantic results, and the manifests/receipts proving their meaning. Recomputable memo entries, uncommitted derived candidates, and replaceable physical indexes have separate owners and retention classes. “Recomputable” permits eviction only if rebuilding remains within the accepted query/resume contract; it is not authority to discard published required answers or transfer an unbounded cost to the user later.

Illustrative type records for `function id<T>(x: T): T { return x; }` are a binder `T`, a `Function([T], T)` node, and a `Lambda([T], functionNode)` export. An effect component exports `ReturnDependsOn(Formal(0))`. A call stores an `Apply` record referencing those shared exports plus its substitution environment, actual operand handles, result handle, and call-site anchor. It does not contain a copied function body.

Suppose one call is in a NodeNext group and another in a Bundler group. The resolver first proves what declaration each actually imports under its own conditions. If both denote this same context-independent identity function, the binder/body core and the proved pure effect template can be shared. The NodeNext call's environment maps `T` to `string`; the Bundler call maps it to `number`. Their binding contexts, actual operands, result sites, provenance and applications remain separate. If either resolution or required ambient meaning differs, it gets a different context-qualified result; sharing syntax is not authority to reuse the semantic answer.

To reconstruct the second call's type, resolve its application, look up its environment, and substitute only the requested return projection `T`, yielding the `number` handle. To reconstruct its flow view, apply `ReturnDependsOn(Formal(0))` to that call's actual zero and result, emitting a call-qualified virtual edge. The first call's actual must never appear in the second call's result path. A virtual result identity derives from the immutable application identity, relation/operator identity, and deterministic generated tuple or ordinal. It must not depend on page size, evaluation order, process pointers, or which query happened first. Existing numeric-only record/edge identity contracts need an explicit migration or stable mapping for these virtual objects.

This example demonstrates a plausible representation for one simple operation. It does not prove that overloaded, contextually inferred, recursive, effectful, or otherwise difficult TypeScript operations have an equally cheap projection.

### Proposed admission arithmetic

Use actual configured budgets rather than inventing a fixed successful MiB value. Let `M` be the allowed process memory envelope, `D` the allowed total disk working set in scope, and `F` the required free-disk reserve. Before admitting work, charge all pinned and active state, then compute:

```text
availableMemory = M - measuredBaseline - pinnedDecodedState
                    - activeTaskReservations - responseAndWriterReservations

availableDisk = min(D - chargedUniquePhysicalBytes - activeDiskReservations,
                    filesystemFreeBytes - F - activeDiskReservations)

admit iff nextStepMemoryUpperBound <= availableMemory
       and nextStepDiskUpperBound <= availableDisk
```

Reservations must exclude bytes already allocated/charged to avoid double-counting them. The disk ledger deduplicates existing physical objects by verified object identity, but charges distinct physical copies until they are actually removed. An object that merely has the same intended hash is not a free reuse until its bytes are verified.

For an owned paged evaluator, each resumable primitive must specify its maximum additional decoded inputs, output chunk, memo entries, and scratch. Acquire those credits before allocation, and refund the difference between reserved and actual bytes only after the step completes. If the next operation has no credible bound, it cannot be represented as a bounded primitive: split it or report that the engine has not met the envelope. This requirement is precisely why a black-box checker call cannot be covered by a guessed reservation.

Memory accounting also needs measured RSS headroom and, where supported, an actual worker/process boundary: JavaScript heap estimates alone exclude native allocations, buffers, allocator retention, and runtime overhead. Process isolation improves containment and recovery; it does not make an inherently oversized query fit.

One owner transfers charges through `reserved → written-uncommitted → committed/pinned → reclaimable → deleted`. Release disk credit after verified deletion, not when a reference is merely removed from a JavaScript map. When a task cannot reserve even its minimum progress unit, persist an honest blocked state instead of waiting forever for credits held by its own indispensable state. A checkpoint preserves progress; it does not change that feasibility failure.

### Disk traffic and crash consistency

Let `I` be the encoded size of the compact index entries, `K` the number of initial runs, `f` merge fan-in, `L` the number of intermediate merge generations, and `J` final index bytes including offsets. For an uncomplicated full merge without filtering, initial run creation and merges write approximately `(L+1)*I + J` bytes and read approximately `(L+1)*I` bytes, apart from source scans and verification. Current retention can keep roughly `(L+1)*I + J` index bytes simultaneously. Changing lifetime can bring the merge workspace toward at most two same-sized run generations, or input-plus-final-output during finalization; metadata, offsets, active buffers, and existing facts are additional. It reduces peak storage, not the repeated read/write traffic.

A factored backend should index the compact relation operands and direct facts, not first generate all implied edges and then sort them. `I` therefore has to be measured over the compact representation. If the query planner rebuilds or rescans that entire index for every request, a smaller disk footprint has only shifted the problem to I/O and latency. Measure read/write amplification as total physical bytes transferred divided by new unique committed bytes, separating verification, merge, replay, and publication.

The proposed durable sequence for each task is:

1. Acquire a lease from the existing control owner and verify pinned input/dependency identities. The proposed write contract additionally checks the lease owner and attempt/fence at commit and publication, preventing a superseded attempt from committing; current lease checks alone are not claimed to implement this entire new object-store protocol.
2. Reserve the next bounded write, write a task-owned temporary file, validate it, fsync the file, and commit its immutable content-hash object with no overwrite; fsync the parent directory.
3. Record the committed object and continuation sequence in the existing task/recovery ownership protocol. An object is reusable only after checksum and semantic identity validation.
4. For a merge replacement, durably record which old task-owned runs it supersedes, then delete those runs and release their actual charges. Recovery validates the replacement before finishing any interrupted deletion.
5. Validate every referenced object, context, source map, index, and capability status. Use the existing whole-generation publisher to expose the new manifest atomically; keep old readers pinned to the prior generation.
6. Acknowledge task completion only after publication is verified. If a crash happens between publication and acknowledgement, the existing publication reconciliation identifies and acknowledges the already published result instead of recomputing it.

A crash before an object's commit leaves only an owned temporary file; after object commit but before its receipt it leaves a verifiable unreferenced object, not a published partial answer. A crash before publication leaves the prior generation authoritative. Retry uses the same semantic task/input key and a fresh lease fence, validates any resumable state, and resumes from its last committed boundary. Corrupt or dependency-incompatible checkpoints cannot be replayed. Reclamation preserves pinned originals and evidence, and is itself bounded and recoverable. These are proposed extensions to existing owners; their crash points need fault-injection tests before implementation can be called safe.

### Why rebuilding a Program for each target window is rejected

Let `T` be the number of targets, `W` targets per window, and `b = ceil(T/W)`. If imports, ambient declarations, and tsconfig roots make every window reach the same closure `C`, the repeated-program plan costs approximately:

```text
totalWork = b * parseBindProgram(C)
            + sum of per-window checker work
            + repeated setup, resolution, formatting and serialization

peakMemory >= one Program(C) + one required query's live checker state
```

Shared checker work can be repeated up to `b` times because destroying the checker destroys its internal memo state. Logical source reads may approach `b*S(C)`; operating-system caching can reduce physical reads but not eliminate AST allocation and binding. If a single tiny target triggers the pathological expansion, lowering `W` has no benefit to that query's peak.

Snapshots and compact output can be reused, so `b` does not inherently require `b` source copies. But a naive per-window graph/cache snapshot adds repeated physical bytes, and spooling all expanded intermediates moves the same cardinality to disk. The best possible window implementation still has the monolithic closure floor and repeated compiler work; the worst adds disk duplication too. Windows can be useful as scheduling units after genuinely independent bounded queries exist. They are not the proposed solution to create that independence, and are not accepted as a substitute for representation/evaluation work.

## How results are reconstructed

Reconstruction is a logical view, not concatenation of independently analyzed batches.

1. Pin the source/configuration generation.
2. Resolve a source/chunk anchor to its canonical occurrence or declaration.
3. Load the relevant compact type, binding, or effect operation and context.
4. Apply the specific substitution/call environment symbolically.
5. Use keyed indexes to answer or enumerate the requested portion of the relation, preserving order, evidence, certainty, and call/return context.
6. Format legacy display values at the API boundary; return semantic detail/trace in bounded pages with generation-pinned continuation state.

Current schemas require explicit edge rows, numeric contiguous edge IDs, and physical member-row indexes. They cannot transparently store an arbitrary relation operator instead. A true factored store therefore needs a versioned relation/operation family and query backend capable of virtual results, with deterministic identities for generated values/edges and a defined continuation order. Artifact and SQLite backends, validators, query indexes, CLI/MCP/HTTP surfaces, and migration/replay rules must agree.

A compatibility exporter can stream the old flat representation when the resulting output is affordable. It cannot simultaneously promise full flat export and avoid storing/writing its actual output size. Existing small-fixture outputs can be compared semantically after canonical reference normalization; byte-for-byte equality is not the right criterion when storage identities deliberately change.

## Cardinality and speed claims that are defensible

A shared graph prevents repeated traversal or storage of the same fact. It does not make all possible relations small.

- A chain of `n` nodes has `n-1` direct edges and about `n*(n-1)/2` reachable ordered pairs. Store the chain; answer reachability without storing every pair.
- A sequence of binary diamonds has linear graph size but exponentially many distinct paths. Store join/branch structure and produce witnesses; do not pre-enumerate paths.
- `C` calls to a callee with `G` shared body/effect facts should use approximately `G + C + A` structural storage. Per-call expansion can instead approach `C*G`.
- `K` unknown calls and `R` later reads can induce `K*R` may-effect edges under the existing conservative model. A qualified relation rule can represent that product compactly. Listing every pair still takes at least that many outputs.
- A small template-literal type with `k` independent binary positions denotes `2^k` strings. Conditional distribution can form products of unions. Neither source-line count nor import fanout predicts this.
- One generic body applied to many environments can have many genuinely distinct answers. Interning repeated applications helps only when their keys match. Context products can also grow exponentially if every path has observably different state.
- One SCC can contain an entire program; syntactic recursion can also generate an unbounded sequence of distinct instantiation keys. “Use SCCs” alone is not a bound on type evaluation.

TypeScript's own performance guidance documents pairwise union reduction and enormous types from intersecting unions. [TypeScript performance guidance](https://github.com/microsoft/TypeScript/wiki/Performance) CodeQL likewise warns that a conservative “unknown method may access every field” relation creates a Cartesian product. [CodeQL query performance](https://codeql.github.com/docs/writing-codeql-queries/troubleshooting-query-performance/)

Expected wins are specific: parse/bind shared structure once; evaluate each distinct reusable obligation once per compatible context; avoid duplicated bodies, paths, and pairwise edge materialization; use deltas rather than repeated global rounds; and stop incremental propagation at unchanged outputs. None establishes an end-to-end seconds/GB figure yet. That requires the measurements below.

## Implemented experimental slice and the limits of its evidence

The work now includes an executable, opt-in finite-string slice, rather than only the architecture proposed above. The repaired baseline is commit `679573bd`; the experimental modules described in this section were implemented afterward in the authorized shared checkout. Their final integration commit and final-head gate belong in the delivery receipt. The broader cyclic type/effect/flow backend, universal TypeScript compatibility, and full-repository time/RAM/disk qualification remain open.

### Exact finite-string dialect and algorithms

`src/index/tooling/typescript/type-ir/` implements an immutable, context-owned DAG with three operations over **sets of JavaScript UTF-16 strings**:

- `Literal(s)` denotes the singleton containing `s`.
- `Union(children)` denotes set union; the empty union denotes the empty language.
- `Concat(children)` denotes ordered language concatenation; the empty concatenation denotes the singleton empty string.

Union canonicalization uses only associativity, commutativity and idempotence. Concatenation uses associativity, empty-language annihilation and empty-word identities. It does **not** distribute concatenation across unions, enumerate products, saturate an e-graph, or claim to decide arbitrary language equivalence. In particular, two differently segmented literal sequences may denote the same word without receiving the same node ID. The identity contract is canonical structure under the listed rewrites, not canonical denotation.

A naïve “flatten associative concatenation” implementation was rejected during review: `X(0) = "a"; X(k+1) = Concat(X(k), X(k))` would produce an exponentially long operand list. The implemented concatenation representation is a canonical persistent binary sequence. Each non-concatenation operand has weight one; a sequence of weight `n` splits at the largest power of two strictly below `n`. Explicit-stack, memoized join/split operations retain aligned doubling as one additional shared node per step. Rebalancing arbitrary insertion can still be expensive and is charged to the operation budget. Moreover, a doubling chain of depth `d` has `d+1` graph nodes but stores growing `BigInt` weights with **O(d²) total bits**. Node count alone is not a byte-memory bound.

The implemented queries are deliberately precise:

1. **Membership:** `containsTypeIr(arena, root, text)` determines whether one explicit UTF-16 string belongs to the denoted language. An explicit-stack dynamic program memoizes `(node, startOffset) → reachable endOffsets`. Union combines end sets; concatenation composes them. It retains ambiguous widths and empty alternatives, so `Concat(Union("", "a"), Union("", "a"))` accepts exactly `""`, `"a"` and `"aa"`, without incorrectly counting four distinct answers.
2. **Cardinality class with concrete witnesses:** `classifyTypeIr` returns `zero`, `one` or `many`, plus at most two distinct concrete strings. It does **not** compute the exact numeric count. A union finds up to two distinct actual witness strings, rather than adding child cardinalities. A concatenation is empty if any factor is empty. If all nonempty factors are singletons, it is a singleton. Otherwise, fix every surrounding factor's witness and vary two witnesses from one factor; cancellation in the free monoid of UTF-16 strings proves the two concatenated strings differ. No multiplication of possibly overlapping product cardinalities is used.

For a represented acyclic DAG with `V` nodes and an explicit query string of length `m`, the membership memo has at most `V(m+1)` node/start states and at most `V(m+1)²` stored end offsets. A straightforward loose bound for binary concatenation is polynomial, O((V+E)(m+1)³) work including endpoint composition, with literal comparison costs also charged. This is a bound on this abstract membership algorithm, not a promised wall time or process-resident byte limit. It does not make language equality, inclusion, distinct counting, or arbitrary TypeScript inference equally cheap.

Concrete witness output remains a real cost. An enormous singleton compressed word can be structurally tiny while its required witness is too long to materialize. The current class-plus-witness operation then fails explicitly at its allocation/string limit. A separate cardinality-only or compressed-witness contract would be additional work, not a claim already met by this implementation.

### Identity, serialization and verifier obligations

Node IDs are `tir1:` plus a SHA-256 digest of a versioned canonical payload containing the context, operation and literal/child identities. Arena interning retains the canonical payload and compares it on every repeated digest: a forced digest collision is rejected, rather than merging distinct nodes. Durable cross-artifact content addressing still relies on cryptographic collision resistance; SHA-256 is not claimed to be mathematically injective.

The implemented multi-root graph schema is:

```json
{
  "schemaVersion": 1,
  "domain": "finite-string",
  "contextKey": "ts-evaluated-v1:<context digest>",
  "rootIds": ["tir1:<sorted unique root digest>"],
  "nodes": [
    {"id": "tir1:<digest>", "kind": "Literal", "value": "a"},
    {"id": "tir1:<digest>", "kind": "Union", "children": ["tir1:<child digest>"]},
    {"id": "tir1:<digest>", "kind": "Concat", "children": ["tir1:<left digest>", "tir1:<right digest>"]}
  ]
}
```

This illustrates record fields, not a valid standalone graph: actual IDs, canonical arities and referenced nodes must verify. Roots and records are sorted. Derived sequence weights are not accepted from storage. Deserialization reconstructs them, recomputes IDs and canonical shape, rejects cycles/dangling references/noncanonical order, and checks every stored node is reachable from the declared roots. This dialect is **acyclic**. The SCC-local cyclic identity design earlier in this paper remains proposed work.

The serializer currently produces one admitted complete graph JSON string. The runtime protocol described below streams graph-node records, but does not remove this existing serializer's whole-string allocation or the corresponding parsed graph object. Both must be included in retained-state accounting.

Default logical kernel budgets are 100,000 arena nodes and 64 MiB of charged arena storage; per-operation budgets are 5,000,000 charged steps, 64 MiB cumulative charged allocation, 100,000 states, and 1,000,000 input UTF-16 code units. Cooperative abort/deadline checks are present. These are explicit admission/failure policies and logical cost accounting, not measured V8 object sizes or an OS-enforced RSS limit. They do not establish that every required input fits. Invalid input is rejected; unfinished required work raises the stable `ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE` error instead of returning an empty language or false membership answer.

### Frontend seam before eager checker evaluation

The finite-string frontend uses bound TypeScript AST declarations, `getSymbolAtLocation` and `getAliasedSymbol`, with explicit substitution environments. It avoids `getTypeFromTypeNode`, `getDeclaredTypeOfSymbol`, `typeToString` and `signatureToString` before admission. Symbol lookup was first probed on a deliberately narrow no-library fixture; subsequent frontend fixtures exercise NodeNext/Bundler, source imports, ambient context and development-condition package resolution. Results from the first no-library probe must not be generalized to those configurations without the later fixtures.

The initial supported type forms are string literals, `never`, unions, template literals, parentheses, and acyclic bound type aliases with supported concrete string arguments/defaults and `extends string` parameters. The function projection requires supported explicitly annotated declarations and rejects cases whose calling/annotation semantics are not implemented, including inference-only returns, overloaded declarations, generic functions, optional/default/rest/destructured parameters and unsupported type operators. The declaration annotation's type language is represented; this is not a proof about values produced by the function body at runtime. Every result is machine-labeled `interpretation: "declared-type-denotation"`. That contract also differs from checker recovery at complexity thresholds: on the tested `2^72` template, TypeScript 5.9.3 produces TS2590 and an `any` fallback when diagnostics are requested first; the symbolic result instead denotes the authored finite language. A query-first probe changed later diagnostic visibility. The experimental representation neither reproduces nor suppresses those diagnostics and must not be described as observational parity with the bounded checker fallback.

The unsupported cases remain required work. The symbolic provider fails the invocation with a located obligation, even if earlier targets were successfully lowered. It does not send unsupported targets to an unchecked eager fallback or silently mark them answered. Accordingly, this mode cannot yet replace the legacy provider on a general repository.

A key failed shortcut informed the design. Legacy `typeToString` output can depend on checker query order: querying a literal-return function first changes the order later printed for an unrelated union. `signatureToString` alone can create tens of thousands of type objects for a tiny template alias even when the final text is just `(x: T): T`. Printing the alias name directly would therefore neither reproduce the complete printer contract nor safely preserve later query-order-dependent strings. The experimental provider instead exposes an **explicitly versioned typed-reference contract**, rather than claiming legacy byte parity:

```json
{
  "schemaVersion": 1,
  "domain": "finite-string",
  "graphId": "stg1:<immutable complete graph content digest>",
  "contextKey": "ts-evaluated-v1:<context digest>",
  "nodeId": "tir1:<node digest>"
}
```

`payload.typeExpressions` carries return and named-parameter refs, declaration/source provenance, and a separate display field. Current symbolic display is empty; it is not a fabricated checker signature. Signature identity is separately versioned. One multi-root graph per evaluated context preserves all shared target roots without copying an overlapping graph per target. Context identity covers the loaded compiler receipt, options/config/root order, source snapshots, VFS origin metadata and observed positive/negative resolution dependencies. That evaluated identity does not authorize replay until the existing dependency owner validates the dependencies again.

The provider's opt-in `tooling.typescript.typeRepresentation = "symbolic"` route is version 3.0.0. Legacy remains the default. Carrying typed refs through metadata, caches and published queries is necessary migration work; passing those round trips is not yet proof that every legacy consumer and every requested capability has equivalent behavior.

### Implemented artifact layout, reassembly and query ownership

The initial durable implementation is narrower than the proposed general CAS layout above. Within the existing immutable `indexDir` generation it writes `symbolic_type_manifest.json` and `symbolic-types/<graph SHA-256>.json`, registered respectively as `symbolic_type_manifest` and `symbolic_type_graph` pieces. The existing writer queue and whole-build publication owner promote the family; no independent “finished” flag bypasses them. Compact refs remain in chunk metadata. The manifest pins the base build ID, semantic revision, context, graph content ID, path, checksum, encoded byte size and node count. Its `complete` status means this admitted family inventory is complete, not that all TypeScript semantics have been implemented.

On read, the existing semantic-detail entry point can execute type-only requests even in a semantic-disabled build. It pins the requested generation, checks registered pieces, confines paths to that generation, admits file size before allocation, checks content checksums and reconstructs shared nodes through the verifier. One hydrated context is retained per store; switching context releases the prior reference and loads the next graph. Those releases permit collection but do not force immediate RSS reduction. Repeated alternating queries can reread and rehydrate contexts, so I/O and query CPU include the access pattern, not just unique graph bytes. This implementation does not yet provide a persistent shared arrangement across all query processes.

Current artifact policies admit at most 16 MiB per graph, 64 MiB for the family and 256 contexts; query requests admit at most 16 type operations and a 16,384-code-unit membership string. Per-declaration metadata has its own 256 KiB allowance. These are enforced failure boundaries, not guarantees that the complete repository fits. Published graph JSON is the compact represented DAG; no language products are spooled. Reassembly reconstructs the DAG and resolves graph/node refs, rather than materializing all strings. Membership returns one boolean; classification returns its stated concrete witnesses. Query response bytes are pre-measured incrementally before retaining each result, without constructing an aggregate JSON copy. A remaining-output allowance is passed to witness construction before concatenating strings; surrogate-boundary UTF-8 accounting is tested. The selected intermediate witnesses can exhaust that allowance even if another smaller witness choice exists, so this is an explicit bounded algorithm, not a completeness claim for every feasible witness selection. Mixed semantic/type requests share one original cooperative deadline rather than receiving a fresh budget for each phase. Crash/resume, source dependency validation and final publication remain the responsibilities of the existing generation owners; symbolic persistent-cache/replay reuse is currently bypassed until the live closure-validation contract is qualified.

### Owned runtime bridge and its actual resource contract

`src/index/tooling/typescript/runtime/{index,entry,protocol,result}.js` implements a fixed application-owned child entry using existing `spawnSubprocess` tracking, ownership scopes and kill-tree cleanup. It invokes the whole provider once and preserves each existing complete config group. It does not create target windows or retry a failed computation automatically. The opt-in symbolic route enters this child before constructing a parent `Program`; the child factory has an application-code-only recursion guard.

Inputs travel as bounded NDJSON header/document/target/end records. Outputs travel as provider fields, individual chunk records, diagnostic records and graph-start/node/end records, followed by counted completion. It pre-measures inert JSON records before `JSON.stringify`, rejects callbacks/accessors/cycles, checks UTF-8 bytes including escapes, validates partial UTF-8 input across pipe chunks, and awaits each stream write. The output reader awaits an optional record consumer, so pipe backpressure reaches the child. Consumer observations are provisional until the invocation returns successfully. Missing completion, duplicate chunks, malformed/order-invalid records, byte limits and nonzero child exits cannot become a successful partial result.

Current transport defaults are 8 MiB per encoded record including newline, 256 MiB total input, 256 MiB total output, 1,000,000 records and nesting depth 64. The compatibility collector separately admits encoded output bytes, defaulting to the output allowance. These caps are configurable internal API limits, not evidence that production workloads fit. The child still retains the provider's document/target arrays and result objects; the parent collector still retains its requested result. There is no graph expansion spool on disk and no giant aggregate provider-result serialization, but object/array overhead, kernel serializer copies, buffers, compiler caches and native memory still count.

The bridge preserves the existing absolute repository root, VFS document data, tooling config, strictness, launcher working directory and launch environment, including repository trust authority. Preserving the working directory matters for relative tooling-cache paths: a regression failed when the child was incorrectly retargeted to `repoRoot` and passed after restoring the original launcher directory. Compiler/semantic callback sessions cannot cross this boundary and are rejected explicitly. Only the fixed owned entry is launched; repository configuration cannot select an arbitrary executable. Synchronous provider telemetry is admitted immediately through the same ordered protocol writer, only while the stream's pending bytes fit 64 KiB and cumulative admitted telemetry stays below 64 KiB/256 records. A backpressured stream does not accumulate an unbounded asynchronous log queue; omitted telemetry is counted at the next safe boundary. A regression blocks the actual compiler's checker seam and verifies that the parent receives `checker:start` before cancelling it. An abrupt OOM/kill can still lose pending pipe bytes or the final omission count.

The default deadline is the existing tooling policy of 60,000 ms. A caller-selected deadline can override it. External cancellation preserves `ABORT_ERR`; internal timeout, required budget exhaustion, malformed transport and child failure retain required-incomplete semantics. Required failure envelopes preserve located obligations when admitted; an error envelope too large for the record allowance is itself an explicit failure. A deadline also covers a stalled asynchronous record consumer after child exit.

The child old-heap limit inherits the configured effective `--max-old-space-size` from the shared runtime-envelope parser, with explicit runtime API override taking precedence and a documented 4096 MiB fallback only if no configured value exists. This avoids silently replacing a user's 16384 MiB setting. It is a V8 **old-generation JavaScript heap ceiling**, not a hard total RSS/native-memory limit. Scheduler reservations remain admission accounting. Without an OS/container memory mechanism, the implementation must not advertise a strict process-resident limit. An irreducible parse/bind/checker closure can still fail in the child; isolation preserves the parent's ability to report that failure but does not make the computation feasible.

### Bounded evidence and a repaired admission failure

Kernel fixtures cover independent concrete enumeration on small languages, UTF-16 boundaries, overlapping unions, ambiguous concatenation, identities, structural associativity, cross-context rejection, forced hash collision, malformed serialization, cyclic/dangling graphs, low budgets, cancellation and deep iterative traversal. The compact fixture includes a 12,000-level doubling chain with 12,001 nodes and a 2,048-level serialization round trip; it does not require emitting the exponentially long word.

The checked-in receipt `docs/archived/typescript-type-ir-scaling-2026-10-11.json` records eight fresh-process fixed cases under Node 26.11.1, default kernel budgets, a 20-second cooperative deadline and a 29-second process timeout. It includes source hashes and per-phase memory snapshots. All eight cases complete under the current default budgets. An earlier conservative serializer-work accounting failure is preserved separately in `docs/archived/typescript-type-ir-scaling-conservative-2026-10-11.json`. Selected single-sample results:

| Input family | Positions | DAG nodes | Charged arena bytes | Construct | Membership | Class/witness | Serialization |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Repeated independent binary position | 64 | 9 | 14,377 | 2.13 ms | 1.50 ms | 0.51 ms | Complete; 2,155 bytes |
| Repeated independent binary position | 4096 | 15 | 24,688 | 14.36 ms | 27.35 ms | 0.68 ms | Complete; 3,669 bytes |
| Distinct delimited binary positions | 1024 | 4,095 | 6,299,838 | 36.08 ms | 7.45 ms | 10.30 ms | Complete; 746,250 bytes |
| Distinct delimited binary positions | 4096 | 16,383 | 25,297,110 | 117.23 ms | 24.17 ms | 41.33 ms | Complete; 2,991,882 bytes |

Each family mathematically denotes `2^positions` distinct strings because the fixture's positions are independently binary and unambiguously delimited. That count is a proof about the fixture, not an exact-count result produced by the kernel. The measurements demonstrate selected answers obtained without enumerating that language; they do not establish universal TypeScript scalability. RSS/heap readings are snapshots, not measured peaks or hard bounds. These are single samples, not a throughput benchmark. The preserved earlier receipt rejected distinct-4096 serialization at the 5,000,000-step policy even though membership and classification succeeded. Review found an overly conservative output-work charge. The implementation now scans exact JSON UTF-16 escape lengths under budget before bounded stringify, while retaining the conservative allocation admission. The same default cap now admits this case; an all-65,536-code-unit fixture checks escape accounting. This is an accounting repair, not a relaxed cap or a reason to hide the earlier failure. Atomic stringify still has cooperative checks before and after, not preemption during the native call.

The runtime's two focused fixtures passed in 9.29 seconds after heap inheritance, external-abort handling, live bounded phase telemetry and launcher-working-directory preservation were added. They establish ordinary direct-versus-child provider parity with stale physical twins, authoritative VFS snapshots, imports and ambient types; per-record backpressure; record/collector limits; malformed and oversized output; pre-start cancellation; hanging consumer timeout; real child-plus-descendant termination on timeout/abort; and first-phase visibility before a deliberately blocked checker returns. No ordinary test exceeded 30 seconds. A production-scale OOM recovery run and Windows descendant cleanup are not established by these Linux fixtures. Later provider/storage tests and the final-head gate must be reported separately rather than inherited from this intermediate receipt.

### Actual build/publication regression

The end-to-end fixture `tests/indexing/artifacts/symbolic-types-build-publication.test.js` passed in **8.58 seconds**. It starts with two actual TypeScript source files and a Bundler configuration, runs the existing parser/chunking and cross-file enrichment path with semantic indexing disabled, lowers a 72-position binary template through the owned subprocess, publishes its registered shared graph and chunk refs through the normal index writer, and queries the pinned published generation. Positive and negative explicit-word membership and `many` classification succeed. It then replaces the function with a required unsupported numeric annotation: the second build rejects, the current index directory and graph manifest remain unchanged, and the previously pinned graph still answers correctly. The author-workspace receipt is `.testLogs/run-1791711347510-qfr87y`; the fixture and engineering log are the portable reproduction sources.

That fixture exposed integration defects which direct-provider tests had missed: canonical config loading dropped the new representation selection; orchestration tried to assign a non-writable provider field in place; unexpected symbolic failures entered optional-provider degradation; a legacy metadata walker treated typed references as string-inference records; and existing piece validation did not recognize the graph's SHA-256 checksum. Those paths were corrected through their owning modules. A separate canonical JSON defect ignored null-prototype dictionaries, making in-memory and JSON-decoded metadata compare differently. Its 76 ms regression covers those dictionaries and prototype-named own keys. A successful tiny build is now demonstrated, rather than inferred from successful kernel serialization.

The fixture uses a 10-second provider deadline within the normal 30-second test limit because the shared test environment's one-second provider default was shorter than cold compiler startup. It does not assert that semantic-disabled publication has no skeleton semantic manifest; the relevant invariants are registered symbolic facts and preservation of the prior generation after required failure. The final repository front gate is a separate delivery receipt. Neither this test nor that gate establishes general TypeScript coverage or acceptance on the user's large repository.

### What this does and does not establish

There is now a real technical bridge for a nontrivial subset: obtain bound declarations before expensive type expansion, lower a verified finite-string algebra, preserve shared structure, answer exact membership and zero/one/many-with-witness queries, and carry versioned references through an owned process boundary. This directly answers some tiny astronomical-denotation examples without treating enumeration as necessary.

It is not the complete requested PoC. Mixed TypeScript queries, number/object/function/conditional/intersection types, recursive aliases, inference, overload resolution, contextual typing, flow/effect summaries, general semantic sessions, and full existing display compatibility still require demonstrated implementations and qualified contracts. Even the supported slice has explicit construction/serialization/query limits and can fail. The earlier architecture and feasibility gates remain live requirements; a standalone kernel, opt-in route or process boundary does not discharge them.


## Implementation sequence

### Work that can be done in the existing backend

1. Retain the completed root identity and checkpoint/finish-race repairs at `679573bd`, with their independent regression and gate evidence. They are completed concrete fixes, not completion of the proposed IR backend or proof of full semantic feasibility.
2. Instrument target-level checker phases: signature resolution, parameter/return queries, formatting, and semantic flow passes. Record source nodes, symbols, types, instantiations, relation-cache sizes, heap/RSS, GC, duration, and the exact target/operation at growth. The inspected TypeScript 5.9.3 `Program` API exposes the relevant counters.
3. Eliminate PairOfCleats-owned duplicate alias maps, repeated canonical-string keys, retained AST worker observations where a compact observation is sufficient, and unnecessary whole-group producer arrays. Preserve output and coverage in differential tests.
4. Improve physical index-run lifetime and cache-accounting accuracy. Keep source retention and recovery integrity.
5. The experimental finite-string pass contracts, compact IR and opt-in typed-reference route are now implemented as described above. Continue qualification on small fixtures; their success does not authorize a full production switch or imply legacy display parity.

These changes are worthwhile, but they must be described as overhead/observability improvements. They do not establish a bounded checker.

### Candidate backend research gates

1. Specify one required pathological operation precisely and prototype symbolic type/resolution/control/effect forms with verifiers. Demonstrate that the required answer, not merely the source expression, is obtained without the observed expansion.
2. Establish context-correct query evaluation, dependency capture, recursive-equation handling, sharing, and invalidation for that operation. Prove rewrite conditions and measure both compact storage and answer latency.
3. Test whether the result extends across the complete capability matrix. Only then commit to factored storage, virtual query results, deterministic identities, and atomic publication/recovery.
4. Establish a viable TypeScript semantic producer that captures necessary operations before expansion. A compiler fork or independent compatible evaluator is substantial work. Using existing `Program`/`TypeChecker` calls behind the new interface remains a monolithic compatibility mode until proven otherwise.
5. Qualify all required outputs and configurations, then consider production migration. Failure at an earlier gate must revise the design rather than be obscured by completing later infrastructure.

Declaration summaries can be useful at verified module boundaries. They are not a general escape hatch: producing them can itself require the same checker, source-based export conditions can bypass them, and declaration surfaces omit implementation effects. `isolatedDeclarations`-eligible inputs offer a narrower opportunity, not universal TypeScript support.

### Conditions that would falsify the proposed approach

- A mandatory checker call still expands before the new IR can intervene, and no compatible bounded alternative is demonstrated.
- A supposedly canonical key merges two contexts with different binding, type, effect, diagnostic, or formatting answers.
- Compact relation storage fits, but the required query latency or total enrichment time does not.
- Equality search produces superlinear/exponential distinct terms on the tiny fixtures before producing the required answer; a small final graph does not excuse the peak.
- A pass avoids the problem only by truncating candidates, source coverage, field paths, contexts, iterations, precision, or evidence.
- The proposed symbolic model cannot express a currently required construct without eager expansion or semantic loss.
- Necessary unique facts, indexes, pinned generations, or active query/component state exceed the agreed physical budget after duplication is removed.

These failures would show that the particular proposed design has not met the requirements. They would not, by themselves, prove that no other algorithm can do so. Conversely, a passing small example establishes only that example and its justified generalization.

## Acceptance fixtures and proof obligations

No large benchmark is needed to establish the first failures. Begin with small fixtures and vary independent dimensions. Each ordinary fixture must respect the repository's 30-second test limit; a timeout is a failed or blocked result, not a reason to quietly increase the deadline.

| Fixture | Dimension to vary | Required evidence |
| --- | --- | --- |
| Physical and VFS aliases | Same source through two eligible roots; then unequal text and embedded segments | One allocation only where identity permits; unchanged targets and module resolution |
| Fanout and diamonds | Callers, callees, diamond depth | Direct/compact graph growth follows represented structure, not path count; exact witness parity |
| Shared generic body | Many repeated and many distinct environments | Repeated environments share; distinct contexts remain distinct; no body cloning |
| Conditional distribution | Tiny nested union products | Symbolic product retained before demand; exact membership and feasible enumeration parity |
| Template literals | Binary alternatives at increasing positions | Compact storage versus `2^k` denotation; enumeration reports actual output cost |
| Recursive types and aliases | Self cycles, mutual cycles, changing generic arguments | Termination where semantics permit; no recursive serializer or stack overflow; correct diagnostics elsewhere |
| Recursive flow | SCC size and required propagation depth | Fixed point reached without arbitrary eight/twelve-round loss; correct call-return matching |
| Heap and unknown effects | Calls times following reads; shared roots and different paths | No eager Cartesian materialization; same may-edge denotation and evidence |
| Many functions in one file | Functions times document aliases | No full alias-map clone per function |
| Context correctness | NodeNext/Bundler, development/types exports, `moduleDetection`, ambient and declaration merging | Distinct answers where appropriate; sharing only of context-independent structure |
| Type semantic traps | Overloads/order, private/unique symbols, unions/intersections, inference, narrowing, `any`/`never` | No incorrect hash-consing or context reuse; oracle agreement |
| Boundary and storage models | Worker messages, captures, exceptions, async/generators, constructors, spreads, typed storage | Preserve supported answers and exact evidence/partial-status distinctions; do not lose families |
| Incremental updates | Body-only edit, public type edit, ambient edit, new previously missing file, deleted edge, changed config | Correct minimal invalidation; removal of stale facts; unchanged output stops propagation |
| Replay and publication | Cancel/crash at each durable boundary; resume; pinned reader during publication | No mixed generations, duplicate completion, dangling references, or lost evidence |
| Disk and memory limits | Low caps, long merge chains, one large component, repeated query pages | Measured peak includes copies/indexes/WAL; graceful resumable stop; never falsely complete |

Every proposed pass needs a written input/output dialect contract, semantic invariant, canonical identity rule, dependency set, retained-state bound, and failure/continuation behavior. Rewrites need a denotational argument: an operation and its replacement answer the same relevant queries under the same environment. Effect factorization must preserve guards, alias qualifiers, evaluation order, may/must distinctions, and provenance. A symbolic object alone is not proof of equivalence.

Use the pinned TypeScript version as an oracle for bindings, overload selection, type/signature results, and diagnostics on tractable fixtures. Use dedicated finite concrete models and independently specified graph semantics for flow properties that TypeScript does not expose. Add differential and metamorphic tests: duplicate a caller, add an unused module, reorder unrelated files, rename local binders, serialize/deserialize, change page/part layout, and resume after cancellation. Outcomes should change only where semantics require.

For scale acceptance, record cold and warm wall time, CPU time, peak RSS/heap, bytes read/written, unique durable bytes, physical peak disk, node/edge/term/environment counts, memo hits/misses, instantiation and relation-cache counts, SCC/delta work, output cardinality, and coverage by capability. Plot each against its relevant independent variable. A large ordinary fixture passing does not substitute for tiny pathological cases.

Full-index qualification on the exact source commit is a final, separately scoped test after the compact backend and small-fixture matrix pass. Acceptance requires every requested target and capability accounted for, no hidden file/candidate/depth/round reduction, and measured RAM/disk within the agreed envelope. The current fixes and this design have not yet met that final gate.
