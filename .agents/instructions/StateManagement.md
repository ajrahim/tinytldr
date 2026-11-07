# Website state ownership

Keep each state value in `website/` with the smallest owner that can manage its full lifecycle. Hooks provide workflow APIs, reducers make multi-step transitions explicit, and shared state is restricted to serializable domain models.

## State ownership matrix

| State Domain                                | Owner               | Implementation Path                                       |
| ------------------------------------------- | ------------------- | --------------------------------------------------------- |
| Workspace design, artboards & source        | Local Workflow Hook | `website/src/hooks/useDesignWorkspace.ts`                 |
| Live iframe preview & runtime warnings      | Local Workflow Hook | `website/src/hooks/useSandboxPreview.ts`                  |
| Theme appearance (Light / Dark)             | Local Workflow Hook | `website/src/hooks/useThemeMode.ts`                       |
| Hosted export job polling (optional)        | Local Workflow Hook | `website/src/hooks/useExportJob.ts`                       |
| UI controls (tabs, copy buttons, modal)     | Component State     | Local React component state (`useState`)                  |
| Account-owned provider metadata             | Account-scoped Hook | `website/src/hooks/useAiConnections.ts`                   |
| Generation, cancellation & guarded undo     | Local Workflow Hook | `website/src/hooks/useAiGeneration.ts`                    |
| Visible route & retained workspace location | Application Shell   | `website/src/App.tsx`, `website/src/state/RouterState.ts` |

## Local workflow and concurrency rules

- **Request Scoping:** Scope async preview compilations and export requests to the active design revision so out-of-order renders never overwrite newer user edits.
- **Resource Disposal:** Clean up iframe message listeners, animation timers, AbortControllers, and revocable blob/object URLs on unmount.
- **AI Request Scoping:** Compare the complete raw source recovery snapshot and account, not just the compiled/selected page. Source changes abort/discard generation; route remount and sign-out dispose it. Undo compares the exact applied snapshot before restoring raw recovery. Prompts, target/context chips, and newly typed provider keys remain ephemeral component state; provider secrets are never browser state beyond the transient password form/request.
- **Sandboxed Preview:** The live preview iframe renders compiled template HTML/CSS with `@tinytldr/runtime` and communicates readiness, layout warnings, and timeline seek state (`window.__tinytldr`) without network access.
- **Surface Navigation:** Library/legal routes retain the active workspace component and its ephemeral state; genuine design navigation and New design replace it. A newly compiled artboard revision replaces its preview iframe rather than navigating the existing frame, so preview updates do not add nested entries to browser Back/Forward history. Camera-only changes retain the iframe.
