# Named USR source digests

Reports35–40 emit sourceDigestVersion2 and
`ordered-named-utf8-byte-frames/sha256-v2`. The SHA256 preimage starts with UTF-8
`pairofcleats.usr.named-inputs.v2` and NUL, then a four-byte unsigned big-endian
input count. Each ordered input contains role, path and exact content; each field
has an eight-byte unsigned big-endian byte length followed by its bytes. Text
uses UTF-8; byte views retain exact bytes. Objects and implicit coercions are
rejected. Empty input sets and one empty content member are distinct.

All shared and formerly local item38/item39 conventions migrate explicitly.
Legacy concatenated, code-unit-framed and NUL-delimited digests are not comparable
to v2 without a declared migration. Roles, paths, ordering, embedded NUL and exact
whitespace remain identity-bearing. Item37 byte metrics now count UTF-8 bytes;
its other metrics and other reports' nonidentity fields retain their meanings.
The report constructor can load tiny named files for contract qualification;
the CLI retains its existing required inputs and has no new option.
