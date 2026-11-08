# Scan-profile observation scope

`scan_profile` version 2 preserves missing observations throughout its producer,
throughput precursor and report consumer. JSON numbers must be finite and
nonnegative; counters must also be safe integers. Null, omitted values, numeric
strings, booleans, negative and nonfinite values are unavailable. Numeric zero
is an observed count. Zero or missing elapsed time cannot support a rate.

A mode rate needs an observed numerator and positive matching mode duration.
Rates are derived from those observations; absent or contradictory supplied
rates cannot replace the matched calculation. An observed zero count over
positive time remains a zero rate. Supplied rates cannot manufacture a missing
count or duration. Cache hit rates additionally remain within 0–1. The existing
dynamic-key protection, per-mode index directories, extraction-quality records,
reuse diagnostics and log formats remain unchanged.

The producer derives required modes from the selected index directories and
present mode inputs. Existing status-health selection takes precedence: fallback
paths and zero byte sizes for explicitly unbuilt modes do not invent work.
Missing selected-mode metrics remain required rather than
silently leaving the denominator. Known-empty selected modes participate with
observed zero counts. Modes with no selection or observation are not invented
as zero-work measurements.

`coverage` version 1 labels the scope `sum-of-mode-work` and the duration scope
`sum-of-mode-total-ms`. Each counter records complete/partial/unknown state,
observed and missing modes, and the observed subtotal. Whole-run scalar totals
remain null unless every required mode supplied that counter. Empty observation
sets and unrepresentable aggregate values remain unavailable.

Each rate has its own included/excluded modes, matched numerator, matched
duration and explicitly named `measuredSubsetPerSec`. Whole-run scalar rates are
available only with complete matching coverage. For 100 observed code lines in
1000 ms plus unknown prose lines in 1000 ms, whole lines and lines/second are
unknown, total mode duration is 2000 ms, and the measured code subset is 100
lines/second over 1000 ms. The profile never reports an unqualified 50.

Summed mode work can overlap source files and execution time. These fields do not
claim unique repository counts, end-to-end wall time or an overlap correction.
Per-language counts retain their source observations; total-line coverage states
whether they accompany a complete mode total.

The authoritative artifact schema accepts historical version 1 with its original
required integer totals. Version 2 requires coverage and permits unavailable
totals and nullable raw timing fields. Unsupported versions fail admission.
Historical files are not rewritten or silently promoted to version 2.

The scan-profile report adapter recomputes matching scope from recorded mode
observations and retains the source schema version in its coverage. Legacy
aggregate rates do not become modern coverage evidence. Recorded benchmark
measurement readers recognize both versions; their derivation identity advances
to version 2 so an earlier materialization cannot claim the new interpretation.
No current user cache or mutable index is consulted for historical measurements.

The populated artifact fixture retains its content and quality assertions. New
small controls cover partial and unknown observations, known empty work,
numeric-type admission, rate fallback, actual throughput precursor, zero/missing
time, consumer coverage and versioned schema negatives. Functional execution is
deferred with the implementation wave.
