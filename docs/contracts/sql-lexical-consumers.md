# SQL lexical consumers

Statement segmentation, leading declaration classification, static include
admission and comment removal use the existing SQL scanner's effective dialect
and string mode. The chunk builder passes its resolved dialect and supplied
lexical options to segmentation; relation building passes those options to
include collection; flow comment removal also uses its supplied options.
This adds no public configuration knob or client execution.

SQL line comments end at LF, CRLF or lone CR. Client `DELIMITER` lines also stop
at those physical boundaries, so a lone CR cannot absorb the following SQL into
the delimiter spelling. Leading signature extraction uses the same physical
line boundaries. Existing source offsets remain UTF-16 offsets into the original
text, and include paths remain passive source evidence.

Shared sourceChunking7 and importResolution5 retire changed chunk/dependency
meaning through the existing semantic policy identity. No alternative parser,
dependency cache or public configuration surface is introduced.

An escaped quote in MySQL or explicitly supplied legacy PostgreSQL string mode
cannot expose the next line of that string as a static include directive.
Nested leading block-comment classification follows the dialect's scanner
policy, so it cannot independently hide a declaration after a non-nested comment
or reveal one inside an unfinished nested comment.

Authored regressions cover fallback chunks, exact source coverage, exports and
import links through actual SQL consumers. They are unvalidated. Generic native
SQL grammar behavior, client execution, complete dialect support and performance
acceptance remain separate qualification work.
