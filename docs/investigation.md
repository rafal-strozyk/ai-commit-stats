# Commit workflow investigation

Last inspected: 2026-10-05. Findings below distinguish observations, upstream
behavior, and conclusions that still require experiments.

## Local observations

- The project contains the MIT license and no application implementation.
- Installed Git AI reports version **1.7.5**; Git reports **2.50.1**.
- Global Git configuration sets `trace2.eventtarget` to Git AI's daemon socket.
- Git AI help advertises committed statistics, working-directory status,
  checkpoints, and a beta `await --timeout <seconds>` command.
- Attempting `git-ai stats --help` failed because daemon startup is disabled
  inside this Codex sandbox. No end-to-end attribution test has run. Do not
  interpret this sandbox restriction as a failure of the user's normal setup.

## Source and documentation findings

1. Git AI attaches attribution as Git Notes in `refs/notes/ai` after commit
   processing, and migrates attribution for amendments. Its docs describe
   eventual consistency, typically 5–100 ms after an operation completes; that
   range is not a guaranteed timeout. [How Git AI works](https://usegitai.com/docs/get-started/how-git-ai-works)
2. The 1.7.5 daemon source treats the root Git process's `atexit` or connection
   closure as its completion boundary; its tests explicitly reject `exit` as a
   sufficient boundary. This supports the concern that blocking `post-commit`
   until attribution exists creates a circular wait. That specific hook
   experiment has not been run. [Daemon source, v1.7.5](https://github.com/git-ai-project/git-ai/blob/v1.7.5/src/daemon.rs)
3. Git's `post-commit` hook runs after commit creation within `git commit`.
   `pre-push` receives the selected local object IDs and can abort a push. Merely
   waiting for an amendment inside `pre-push` does not establish that Git will
   send the replacement SHA. Hook bypasses and overrides also limit a hook-only
   guarantee. [Git hooks](https://git-scm.com/docs/githooks)
4. The inspected working-status implementation compares HEAD with the working
   directory, rather than providing a staged-only snapshot. Its `--diff-only`
   option must not be assumed to match partial commits. [Status source](https://github.com/git-ai-project/git-ai/blob/main/src/commands/status.rs)
5. The inspected stats implementation exposes `human_additions`,
   `unknown_additions`, `ai_additions`, and `git_diff_added_lines`. It polls for
   notes on recent commits. Successful JSON output alone must not be treated as
   proof that attribution was ready. [Stats source](https://github.com/git-ai-project/git-ai/blob/main/src/authorship/stats.rs)
6. Current docs describe default filtering of generated artifacts, lockfiles,
   and snapshots, plus `.gitattributes`, `.git-ai-ignore`, and explicit ignore
   patterns. Use a consistent numerator and denominator and confirm behavior
   for the supported Git AI version. [CLI reference](https://usegitai.com/docs/get-started/reference)
7. Node.js supports distributing applications as standalone executables to
   machines without Node.js installed. Platform builds and packaging need
   validation before selecting the release toolchain. [Node.js single executable applications](https://nodejs.org/api/single-executable-applications.html)

Source links to `main` describe inspected upstream behavior, not a pinned
compatibility contract. Future fixtures and experiments must identify the exact
Git AI version used.

## Next experiment

Use disposable repositories and isolated Git AI state; do not change the user's
global agent configuration or annotate this project's history for the test.

- Establish mixed AI/human attribution using deterministic test checkpoints;
  separately verify actual JetBrains-embedded agent attribution.
- Capture Git trace timing, note availability, stats output, and `await` behavior
  after a commit and inside a bounded post-commit experiment. No fixed sleep
  should substitute for a readiness check.
- Test a message-only amendment; compare tree, parents, author, staged content,
  working files, and resulting attribution. Verify idempotence and signing.
- Prototype background annotation and immediate push to a local disposable
  remote. Check which SHA is selected and received; pending and failed commits
  must not be published through the supported integration.
- Exercise partial commits, an initial commit, zero additions, concurrent HEAD
  changes, repeated callbacks, missing notes, daemon errors, and timeouts.
- Test existing hooks and custom/shared `core.hooksPath`, worktrees, explicit SHA
  pushes, and bypasses. Document coverage limits instead of promising universal
  interception.
- Confirm that errors preserve the commit and print an actionable retry command;
  a moved HEAD must not cause another commit to be amended silently.

## Exit criteria

Record reproducible commands, versions, sanitized fixtures, measured results,
and a supported mechanism for commit/push coordination. Do not select a plain
synchronous post-commit amend as the production architecture without evidence.
If the strict publication requirement cannot be met with available integration
points, document the gap and resolve it before building the editor installer.
