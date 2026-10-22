# Non-authoritative query and repository allocation shadows

`shadowQueryRoute` emits a bounded feature-only proposal with policy/version
identity. Its taxonomy covers symbol/path spelling, explicit Boolean/phrase
syntax, natural-language intent, a caller-declared existing `semantic-find`
request, and unknown/abstention. Canonical AST syntax outranks fuzzy spelling
features. A text classifier never creates structural/type/literal evidence or
authorizes a semantic query. Short unknown and out-of-domain input proposes
existing hybrid behavior. All heuristic proposals are explicitly uncalibrated;
they do not replace production confidence or ranking policy.

Reports retain Boolean/count features and proposal reasons without raw private
query/source text. Query and AST admission is bounded to 4,096 characters and 256
nodes. Cycles/accessors, cancellation and budget exhaustion produce incomplete
records with no selected proposal. This helper does not execute providers,
change constraints, select repositories or alter primary result/cache identity.

`simulateShadowAllocation` works only on caller-supplied saved ranked candidates.
The expected workspace, query/filter identity and every repository generation
must match. Each repository belongs to one explicit compatibility cohort for the
selected mode, with its preserved cohort signature. Repeated repository identity
across modes requires separate simulations. Candidates retain exact source keys,
channel membership and source ranks; duplicate/foreign or stale rows are refused.
No extra repository search is issued, and native scores are not compared across
incompatible cohorts.

The declared total budget and minimum exploration floor select prefixes from the
same saved pools. Fixed equal-effort allocation is the control. A deterministic
weighted proposal uses only saved sparse/dense membership counts and the shadow
class, with stable repository-ID ties. It never uses judgments to choose quotas.
If the budget cannot cover the floor for every nonempty pool, the simulation
returns incomplete instead of silently excluding a repository. Unknown judgments
keep graded gain and relevant-repository coverage null. Fully labeled pools can
report saved-pool graded gain/coverage and their fixed-control difference; these
are not whole-corpus recall, routing regret qualification or calibrated cost.

Limits are 32 repository entries, 2,048 saved candidates, 64 candidates per repo,
200,000 scalar allocation units, 64 KiB output and a 100 ms cooperative deadline.
These are containment bounds and do not establish latency/resource acceptance.
The simulator does not retain an interrupted allocation or publish metrics for
an incomplete receipt. Missing/empty eligible scope is represented explicitly.

Existing evaluation cases may include a `shadowRouting` saved-input object with
the canonical query-text digest. `tools/eval/run.js` emits a separate bounded
top-level report, with `currentSearchEvidence:false`; its labels and metrics never
enter live judged summaries. An invalid shadow input reports refusal without
aborting the primary evaluation. There is no public CLI/config knob, result cache,
automatic learned route, automatic extra search or default policy promotion.

The regression sources cover syntax/abstention, privacy, source/generation/query
refusal, floor/budget, deterministic order, judgment-independent frozen quotas,
missing labels, empty scope and report isolation. They are unrun. Primary pipeline
shadow-on/off byte parity, live federation feature collection, labeled confusion/
calibration, routing regret, held-out repository families and measured native cost
remain separate integration/qualification work.
