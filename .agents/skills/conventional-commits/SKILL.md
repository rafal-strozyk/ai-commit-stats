---
name: conventional-commits
description: Compose or create Conventional Commit messages from the actual changes when committing work or proposing a commit message.
---

# Conventional commits

Use the Conventional Commits 1.0 format:

```text
type(scope)!: concise description

Optional explanation of the problem, resulting behavior, and relevant trade-offs.

Optional trailers, including BREAKING CHANGE when applicable.
```

- Inspect repository status and the staged diff before composing a message.
  When only proposing a message, inspect the changes it is meant to describe.
- Choose the type from the final change: `feat` for new behavior, `fix` for a bug
  fix, `docs` for documentation, `test` for tests, `refactor` for internal changes,
  `build` for toolchain/dependencies, `ci` for CI, or `chore` for maintenance.
- Use a scope only when it clarifies the affected component, such as `cli`,
  `core`, `jetbrains`, `vscode`, or `skills`.
- Write a short imperative description of the actual outcome. Avoid generic
  subjects such as "update files" and claims that exceed the staged changes.
- Mark breaking public-interface changes with `!` and explain the compatibility
  change in a `BREAKING CHANGE:` footer. Do not label ordinary internal edits as
  breaking changes.
- Preserve required trailers and describe the final change rather than the
  conversation or abandoned approaches.
- Run checks appropriate to the staged change before committing and distinguish
  completed checks from checks that were unavailable or not run.
- Stage only the intended files. Preserve unrelated staged and unstaged work.
  This skill governs message format; it does not authorize a commit, push,
  amendment, or history rewrite. Honor existing task authorization.
- After an authorized commit, inspect its SHA and contents and report remaining
  working-tree changes. Do not amend earlier commits merely to impose this style.

Examples:

```text
docs: record architecture and initial investigation
chore(skills): add repository workflows and agent guidance
fix(core): reject stale commit identities during annotation
```

Reference: [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/).
