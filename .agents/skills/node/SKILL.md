---
name: node
description: Handle Node.js async operations, CLI subprocesses, errors, resource cleanup, and hanging processes or tests. Use for Node runtime behavior rather than general TypeScript style.
---

# Node.js runtime and CLI reliability

A compact adaptation of mcollina/skills for this repository. Follow the package's
established runtime, module system, imports, build, and test configuration. Do not
introduce native TypeScript execution, a new test runner, or dependencies merely
because a skill or example prefers them.

## Async operations

- Await operations whose outcome affects the command. Fire-and-forget work needs
  an explicit lifecycle owner, error path, and completion contract.
- Run independent work concurrently; keep dependent Git mutations sequential.
  Bound concurrency when subprocess volume or resources make it necessary.
- `Promise.all` rejecting does not cancel the other operations. Await their
  cleanup or explicitly cancel them before releasing shared resources.
- Use cancellation and bounded deadlines where waiting can hang. Clear timers
  and remove listeners in cleanup. `Promise.race` alone does not stop work.

## Subprocesses

- Pass executable and arguments separately with `shell: false`. Keep repository
  paths and user input out of interpolated shell commands.
- Set the working directory explicitly. Preserve necessary Git environment
  variables; isolate configuration intentionally in disposable-repository tests.
- Distinguish spawn failure, nonzero exit, signal termination, timeout, and invalid
  output. Consume stdout and stderr concurrently to avoid pipe backpressure.
- Choose buffered execution for bounded output or streaming with explicit limits
  for large output. Reserve stdout for the CLI's machine-readable result and
  stderr for diagnostics when JSON mode is selected.
- A successful spawn is not completion. Settle the operation after the process
  outcome and required stream closure are known; handle spawn errors separately.
- On cancellation, stop and reap owned children and verify termination. A signal
  sent to one process does not guarantee its descendants stopped; validate
  platform-specific cleanup before promising it.
- Do not blindly retry a failed Git mutation. Inspect repository state first;
  timeout or cancellation does not prove the operation made no changes.

## Errors and cleanup

- Catch where a boundary can add useful context or implement recovery; otherwise
  propagate. Preserve causes and narrow unknown errors without weakening types.
- Include actionable context such as operation, repository, and exit status.
  Avoid secrets and raw prompt content in diagnostics.
- Keep cleanup with the scope that acquired timers, streams, locks, files, or
  children. Use `finally` or the established test runner's teardown mechanism.
- Cleanup failure must remain visible without losing the original failure.
  Shutdown should be idempotent and bounded; do not release locks while owned
  operations can still mutate the repository.
- Prefer setting `process.exitCode` and allowing output and cleanup to finish.
  Do not add global fatal-error handlers that turn corrupted state into success.

## Hanging processes and tests

- Reproduce using the existing package command, then isolate the failing case
  with a bounded timeout and useful output.
- Trace the owner of open children, pipes, timers, watchers, or listeners. Correct
  teardown at that owner rather than masking the hang with forced exit or retries.
- Use additional handle-diagnostic tooling only when necessary; do not add a
  permanent dependency just to follow an example.
- Rerun the isolated reproduction and affected checks. Repeat timing-sensitive
  cases enough to address the observed concern, without a fixed repetition quota.
- Record commands, exit status, and remaining uncertainty. Fixture tests of parsing
  cannot establish real subprocess cleanup or Git-operation correctness.

Source: [mcollina/skills, pinned revision](https://github.com/mcollina/skills/tree/72b72751477157ebda36203eaffac701ac5df5ae/skills/node).
The upstream MIT license is retained in `LICENSE`.
