# Implementation prompt

Template for bounded implementation tasks:

```text
Implement [requested phase or behavior] in tinytldr.

1. Context: Read AGENTS.md, .agents/instructions/Architecture.md, .agents/docs/PLAN.md, and any relevant specification in .agents/specs/.
2. Scope: [affected workspace/package, target outcome, and acceptance criteria].
3. Constraints: Preserve Zod schema single-source-of-truth, rendering sandbox rules, MIT license constraints, and strict typing (zero `any`).
4. Architecture: Place code in its proper domain layer (`packages/*`, `mcp/`, `website/`). Do not create generic dumping grounds.
5. Verification: Add focused Vitest coverage. Run `pnpm check` and `pnpm build`.

Report: files changed, tests added, verification command results, and empirical evidence.
```
