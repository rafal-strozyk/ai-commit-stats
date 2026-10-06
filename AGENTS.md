# Repository guidance

## Communication

- Keep responses concise and lead with the result.
- After changes, report what changed, what was verified, and any remaining blocker.
- Do not repeat the request or narrate routine actions.
- Explain trade-offs when they affect correctness or maintenance.

## Code quality

- Follow existing repository conventions and implement the smallest complete solution.
- Avoid speculative abstractions, unrelated refactoring, and unnecessary dependencies.
- Comment on non-obvious reasoning, not obvious syntax.
- Do not suppress errors or weaken types to make checks pass.
- Test observable behavior and meaningful failure cases, in proportion to the change.
- Never claim a check passed unless it actually ran against the relevant changes.
- Follow each package's established runtime, module system, and build configuration.
  Do not switch to native TypeScript execution or change import extensions solely
  because a skill recommends it.

## Project requirements

- Read `docs/architecture.md` and `docs/decisions.md` for current requirements.
- Keep shared logic independent of editor APIs.
- Preserve committed code, staged changes, and working files during Git operations.
- Never classify missing attribution as human-written code or zero AI usage.
- Use structured subprocess arguments rather than interpolated shell commands.
- Validate commit and push coordination before promising automatic annotation.
- Keep agreed decisions, observed findings, and unverified hypotheses distinct in the docs.
- Update affected documentation when requirements or verified findings change.

## Skills and commits

- Repository-local workflows live in `.agents/skills/`; see `docs/development.md`.
- Use Conventional Commits for new commits; consult the `conventional-commits` skill.
- Use `systematic-debugging` for failures, `verification-before-completion` when
  reporting completion, and `tidy` for requested diff reviews or cleanup.
- Select relevant skills rather than loading every workflow for every task.
- Explicit user instructions and session authorization take precedence over skill defaults.
- Do not interpret optional upstream agent workflows as a request to delegate.

## Verification

Use pnpm for dependency management. Run `pnpm lint` for JavaScript lint checks
and `pnpm lint:fix` to apply automatic fixes. No application build or integration
test command is established yet. For documentation
changes, check local links, Markdown structure, and whitespace. Validate modified
skills with the skill-creator validator when available. Add implementation checks
here when the toolchain exists; do not report nonexistent checks as passing.
