# Review prompt

Template for evidence-based code review:

```text
Review [diff, PR, or module path] in tinytldr.

1. Context: Check AGENTS.md, .agents/instructions/Engineering.md, and .agents/instructions/Architecture.md.
2. Priorities: Sandbox escapes (untrusted HTML/CSS/remote network requests), schema drift, non-permissive dependencies, resource leaks (Playwright pages/processes), and package import direction.
3. Code Quality: Strict typing (no `any`), PascalCase/camelCase conventions, early returns/guard clauses, and clean phase separation.
4. Output: For each issue, provide file/line, triggering condition, impact, and minimal fix. If no issues, state plainly.
```
