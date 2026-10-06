# Development CLI

The shared core and CLI compile from TypeScript to Node.js ESM using `tsc`;
they do not use native TypeScript execution. This is a development interface,
verified on macOS arm64 with Git 2.50.1 and Git AI 1.7.5. The implementation
requires the Git AI `git_notes` backend. Unsupported versions, unreadable notes
and missing attribution fail without claiming human authorship or zero AI use.
No Git AI configuration is changed automatically.

## Commands

```sh
pnpm build
pnpm acs inspect --repo '/path/to/repository' --commit HEAD --json
pnpm acs annotate --repo '/path/to/repository' --expected-head FULL_SHA --json
pnpm acs status --repo '/path/to/repository' --json
```

`annotate` requires a full 40- or 64-character SHA matching HEAD and a local
branch. It refuses detached HEAD and unsupported commit headers. `inspect`
accepts a revision and resolves it once to an explicit commit identity.

Use `--git-ai /absolute/path/to/git-ai` to select a compatible binary. Retry
instructions preserve this selection and quote repository and executable paths
for POSIX shells. `--timeout-ms` sets an operation deadline from 100 to 300000 ms
(default 10000 ms). Unix annotation is supported for development; Windows,
standalone executables and terminal installation remain unimplemented.

The package declares `acs` and `ai-commit-stats` bin entries pointing to the same
compiled CLI. They are not installed globally by building this repository.
When following a retry instruction in this development checkout, use `pnpm acs`
instead of the uninstalled global `acs` command.

JSON results have `{ "ok": true, "data": ... }`; errors have
`{ "ok": false, "error": { "code", "message", "retry"? } }`.
`inspect` returns commit, engine version, filtered counts and addition share;
`annotate` returns original SHA, replacement SHA, selected branch, counts and
share. `status` returns HEAD and recorded operations. Diagnostics and retry
instructions go to stderr, keeping JSON stdout machine-readable.

## Safe annotation and local state

The core creates a replacement with `git commit-tree`, retaining the tree,
ordered parents and exact author. It leaves staged content, the index and working
files alone. Signed commits are signed again; configured signing is also honored.
SSH signing was verified with a temporary key; GPG, hardware keys and interactive
signing are not yet established as supported configurations.

It copies the attribution note without overwriting a conflicting note and asks
Git AI to parse the note and calculate statistics for the prepared replacement.
Only matching filtered counts are accepted. All ACS plumbing commands suppress
Trace2 emission to avoid racing the daemon's independent rewrite processing.
The real Git AI experiment validates copied notes on both zero-addition signed
commits and mixed filtered additions.

Finally, one [Git ref transaction](https://git-scm.com/docs/git-update-ref/2.50.0)
compares the selected branch's old SHA
and the pending operation's state object, and updates both branch and ready state.
A concurrent commit fails that comparison. The captured branch is explicit:
if checkout occurs during preparation, the original branch can still be annotated,
but the newly selected branch and its HEAD are not modified. The result identifies
the branch updated. This is not a history rewrite or historical recovery command.

Operation state is stored per original SHA in local
`refs/ai-commit-stats/jobs/*`, shared by linked worktrees. State values are JSON
blobs containing the originating checkout, selected branch, deadline and retry.
Normal branch pushes do not include these refs. They are local metadata and must
not be mirrored/exported; they contain local paths. Cleanup/uninstallation and
retention policy are future installer work.

Expired pending operations are atomically marked failed by push evaluation.
An expired worker's state comparison then prevents it from publishing a late
replacement. Interrupted ref updates are reconciled against durable state;
a transaction that already committed is reported as successful rather than
being blindly retried or mislabeled as a calculation failure.

## Push evaluation

`check-push` consumes Git's pre-push records on stdin:

```text
acs check-push --repo <path> [--json]
```

It examines the selected commit history, excluding the known remote history,
and applies these rules to every recorded affected commit:

| State | Behavior |
| --- | --- |
| Pending within its deadline | Abort push and request a retry when annotation finishes. |
| Ready but selected SHA is the original replaced commit | Abort push; retry using the updated ref or replacement SHA. |
| Ready with the annotated SHA selected | Allow push. |
| Failed, including an expired abandoned operation | Allow push with an error explanation and a copyable annotation retry. |

Exit status is zero when allowed and one when blocked. JSON includes `allowed`,
`blockers` and `warnings`; warnings are printed before Git proceeds. A warning
does not require confirmation. Deliberate `--no-verify` or hook disabling is
outside protection. A malformed push record or unreadable operation state is a
coordination error, distinct from a recorded calculation failure.

Failure diagnostics identify the latest attempt and say no new statistics were
added. This also covers signing or ref-update errors after calculation succeeded,
without falsely claiming that counts were never calculated or removing an
existing footer from a previous successful attempt.

This command does not install a hook, register every future commit or launch a
worker. Untracked commits have no pending job, and the evaluator does not invent
attribution for them. Tests install a temporary hook only in disposable
repositories. Production installation still needs hook coexistence, commit
registration, detached-worker lifecycle and packaging validation.

Retry annotation before publishing. Once a commit is published, adding trailers
changes its SHA and requires a separate remote history policy; no automatic
force-push or historical recovery is implemented.
