# Handlebars fallback literal imports

When the syntax parser is unavailable or declines a source, the existing managed
fallback remains heuristic. Its supported complete static name tokens now retain
literal punctuation, surrounding decoded whitespace and quote characters through
both collection and relation construction. Unsupported escaped name spellings
and partial bare-token matches are omitted rather than shortened into another
dependency identity. This does not infer dynamic partial targets, inline scope,
raw-block semantics or full grammar parity in the fallback.

The bounded scanner yields each supported token before continuing. It spends
the collector's existing cooperative time and match allowance during scanning;
the collector retains its original token allowance and source/line windows.
Parser-backed extraction and its existing source metadata remain unchanged.

The parser-unavailable collector and actual managed fallback relation controls
are authored but UNVALIDATED in the October 23 development-first wave.
