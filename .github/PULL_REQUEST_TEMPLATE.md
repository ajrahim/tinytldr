## Summary

- **What changed:**
- **Why:**

## Verification Evidence

Paste the commands run and their output:

```sh
pnpm check
pnpm build
```

## Checklist

- [ ] `pnpm check` passes (format, lint, typecheck, permissive license check, Vitest suite)
- [ ] No non-permissive dependencies added (`MIT`, `ISC`, `BSD`, `Apache-2.0`, `OFL` only)
- [ ] If adding/modifying a template: `tinytldr template validate` passes at all declared sizes
- [ ] `.agents/` documentation or specs updated if durable behavior changed
