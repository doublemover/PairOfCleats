# SQLite filter fact pages

The optional `chunk_filter_facts` table is a private acceleration inside the
selected SQLite database. Version1 seals exact chunk-ID coverage at build time.
Full artifact/bundle builders and compaction rebuild normalized facts in bounded
128-row batches before publication. Incremental inserts update the same facts;
chunk insert/update/delete triggers revoke seals before a later mutation can be
mistaken for a complete index. A legacy database missing facts remains readable.

Reconstruction explicitly follows the integer primary-key range for its global
ID cursor. The file-oriented `(mode,file,id)` index cannot supply that ordering;
using its mode prefix would repeatedly sort the remaining mode for each page.
Mode filtering, facts, seal checks, batch size and cancellation remain unchanged.
This access-path repair changes no schema, producer identity or stored meaning.

Cold filter enumeration can count and page language, extension, kind and literal
file predicates without decoding every chunk's metadata. Normalization shares
the canonical filter owners, including JavaScript Unicode lowercasing and path
separators. Kind matches remain exact. A page hydrates only its selected chunk
IDs and is checked again by the ordinary predicate. Generation/filter cursors
and advancement after output trimming retain the existing contract.

Missing/incomplete seals, unsupported residual predicates, regexes, unpaired
UTF16 surrogates and embedded NULs use the complete metadata predicate. Missing
facts never prove an empty result. Full fallback explicitly loads chunks even
when the ordinary FTS path would keep them lazy. No cache is required for the
first page and no author cache supplies completeness authority.

`sqlite-indexed-filter-page` and `sqlite-indexed-facts` report this preparation
separately from a persisted match-cache seek. SQL COUNT and file substring
evaluation can still scan fact rows, and existing sparse ordinal arrays still
reserve their address space. This change claims reduced metadata hydration,
not measured latency or constant memory. Source and authored regressions are
UNVALIDATED until the deferred Windows qualification batch runs.

## Optional continuation-cache resource settlement

Authentication-key and payload readers borrow the existing contained descriptor
owner through admission, bounded reads, post-read identity checks and close.
Missing, stale, invalid-MAC or corrupt cache bytes remain optional misses after
all original resources settle. Unconfirmed verification/read/close work propagates
its original session and failure observations before metadata scanning, SQLite
fact-page loading, artifact fallback, key replacement or cache publication.
Cancellation remains independently observable. Recovery closes the original
resource only; it does not repeat reads or search. The authenticated format and
physical byte/entry caps are unchanged.
