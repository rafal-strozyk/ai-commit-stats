# Git AI 1.7.5 statistics fixtures

These are complete JSON statistics outputs from the
[isolated experiment](../../integration/README.md), using a debug `test-support`
build of Git AI v1.7.5 at revision
`f67fe0d732dfebf6bc229ad7c784e3a8a2d42a66`.
They are extracted from the [archived report](../../integration/reports/git-ai-1.7.5-darwin-arm64.json).
No prompts, transcripts, user identities or absolute repository paths are included.
The `mock_ai::unknown` tool/model name is the upstream mock checkpoint output.

| Fixture | AI | Human | Unknown | Filtered additions | Attribution note |
| --- | --- | --- | --- | --- | --- |
| [initial.json](initial.json) | 0 | 1 | 0 | 1 | Available |
| [mixed-partial.json](mixed-partial.json) | 2 | 1 | 0 | 3 | Available |
| [zero-additions.json](zero-additions.json) | 0 | 0 | 0 | 0 | Available |
| [missing-note.json](missing-note.json) | 0 | 0 | 1 | 1 | Missing; annotation must fail |
| [filtered.json](filtered.json) | 4 | 2 | 0 | 6 | Available |
| [explicit-ignore.json](explicit-ignore.json) | 2 | 2 | 0 | 4 | Available |

`mixed-partial` excludes a line left unstaged. The filtered fixture excludes two
lines each from a default-ignored lockfile, a `.git-ai-ignore` match and a
`linguist-generated` match in `.gitattributes`. An explicit ignore excludes two
more AI additions in `explicit-ignore`. Numerators and denominators therefore
remain consistent: mixed share is 66.67%, filtered share is 66.67%, explicit
ignore share is 50.00%, and zero additions use `N/A`.

The human counts are Git AI's recorded classification, including residual
additions at commit time. ACS must not infer that classification when attribution
is unavailable. In particular, the missing-note fixture is successful JSON from
Git AI, but it is **not** a successful zero-AI annotation.

Future fixture changes must identify the engine version, effective filtering,
note readiness and reproduction scenario. Do not generate expected outputs by
guessing counts or replacing missing attribution with human additions.
