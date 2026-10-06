# Development guidance and skills

Repository-wide conventions live in [AGENTS.md](../AGENTS.md). Focused workflows
live in `.agents/skills/` so they can be shared with the repository. Codex supports
repository-local discovery from that directory. [Official skills documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)

| Skill | Use |
| --- | --- |
| [conventional-commits](../.agents/skills/conventional-commits/SKILL.md) | Compose or create a commit from the actual changes. |
| [systematic-debugging](../.agents/skills/systematic-debugging/SKILL.md) | Reproduce failures, trace boundaries, and test a cause before fixing. |
| [verification-before-completion](../.agents/skills/verification-before-completion/SKILL.md) | Check relevant evidence before claiming completion. |
| [tidy](../.agents/skills/tidy/SKILL.md) | Review a diff; apply findings and simplifications when requested. |
| [node](../.agents/skills/node/SKILL.md) | Node.js async work, subprocess lifecycle, errors, cleanup, and hanging processes. |

`tidy` defaults to report-only for review requests. Requests to tidy, simplify,
fix, or apply findings select its apply mode. Neither mode implies permission to
commit or push. Optional external-agent passes are not enabled by installation.

Skills should be available on the next Codex turn. Use `/skills` to inspect the
discovered list where supported; restart the Codex session if changes do not
appear. Discovery in the specific JetBrains host has not been verified here.

## JavaScript linting

Use pnpm (version pinned in `package.json`) and commit `pnpm-lock.yaml`.
Run `pnpm install`, then `pnpm lint`; use `pnpm lint:fix` for automatic fixes.
The ESLint flat configuration applies its recommended JavaScript rules with
Node.js globals. Control statements require braces, and blocks must span
multiple lines. Use one tab per indentation level, displayed at a width of two
spaces via `.editorconfig`, blank lines around control-flow blocks
and before returns, and multiline nonempty object literals with one property per
line. Empty objects may stay inline; imports and destructuring are unaffected.
Group related declarations into small chunks separated by blank lines, as
described in `AGENTS.md`; this requires judgment rather than a lint rule.
Further formatting preferences and TypeScript linting are deferred
until their conventions and implementation toolchain are selected.

The integration experiment requires a separate Git AI test-support binary;
linting does not execute it or verify commit and push behavior.

## Sources and local adaptations

Installed on 2026-10-06 using skill-installer with an explicit repository-local
destination and immutable revisions. The full Superpowers bundle and its startup
hooks were not installed. Required references are retained with each skill.

- `systematic-debugging` and `verification-before-completion`: [obra/superpowers](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills),
  revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`, MIT,
  copyright 2025 Jesse Vincent. Each skill includes the upstream license.
- `tidy`: [mblode/agent-skills](https://github.com/mblode/agent-skills/tree/012e6e5208f512151bdea0e2965dafd01ff61340/skills/tidy),
  revision `012e6e5208f512151bdea0e2965dafd01ff61340`, MIT,
  copyright 2026 Matthew Blode. The skill includes the upstream license.
- `conventional-commits`: authored for this repository under its MIT license,
  following the [Conventional Commits 1.0 specification](https://www.conventionalcommits.org/en/v1.0.0/).
- `node`: adapted from [mcollina/skills](https://github.com/mcollina/skills/tree/72b72751477157ebda36203eaffac701ac5df5ae/skills/node),
  revision `72b72751477157ebda36203eaffac701ac5df5ae`, MIT.
  The skill includes the upstream license and copyright notice.

Local changes to Superpowers: shorten discovery descriptions; remove debugging's
dependency on the uninstalled TDD skill; link the installed verification skill;
replace an environment-dumping example with secret-safe boundary diagnostics.
The tidy skill and its supporting files are otherwise copied unchanged.

The Node skill is a compact, self-contained adaptation. It retains async,
error-handling, cleanup, and hang-diagnosis guidance and adds CLI subprocess
considerations. Its broad rule collection, server examples, native TypeScript
mandate, prescribed libraries, and fixed test repetition counts are omitted.
Runtime, imports, build configuration, test runner, and dependencies remain
package-level choices; the skill does not establish a toolchain.

Generic TypeScript and JavaScript testing skills are deferred. A project-specific
Git integration testing skill can be added after the feasibility experiment has
established reproducible procedures. Strict compiler, lint, and CI checks will be
configured with the implementation toolchain rather than treated as existing gates.

To update vendored skills, review the new source and license, install into a
temporary directory, compare it with the local copy, preserve intentional local
adaptations, and update the recorded revision. Do not replace these copies with
an unreviewed branch-head download.
