# Hosted MCP: owner-scoped saved designs

Status: Active

## Problem

Agents connected to `https://mcp.tinytldr.com/mcp` could only see built-in
templates. When a user asked to use their own saved website design (for example
"my Weekly template"), the agent could not find it and fell back to a different
built-in layout.

## Approved scope

The owner approved read-only, owner-scoped access to the signed-in account's saved
website designs on the hosted MCP server on 2026-11-07. This narrows the
[hosted MCP](HostedMcp.md) "no website-design synchronization" exclusion; nothing
is written back.

- `list_designs` (hosted only): the authorized account's non-deleted designs,
  newest first, at most 100, as compact summaries: id, title, size, revision,
  update time, and each page's id/title/description/template name/slot names.
- `get_design` (hosted only): one design's version-2 JSON (the format
  `render_workspace` accepts) plus reuse guidance: keep each page's template,
  theme and token overrides, replace copy in `pages[].data` within slot limits,
  then call `render_workspace`.
- The owner comes only from the verified OAuth grant (`owner.uid`); tools take no
  account argument. Designs owned by other accounts, guest designs, deleted
  designs and unknown IDs all return the same "not found" error.
- Hosted `list_templates`, `render_workspace` and `distill_to_post` guidance
  directs agents to these tools when the user names their own design.
- Shared stored-design parsing (`StoredDesignRecordSchema`,
  `DeletedDesignRecordSchema`, `savedDesignFromRecord`) lives in
  `@tinytldr/core/firebase` and is reused by the website design service.

## Out of scope

Writing, renaming, claiming or versioning designs; browser drafts; guest edit-key
access; My Library media; local stdio/HTTP servers (no account there); new
render limits. Design reads are not render attempts and do not consume the
six-per-minute render quota; the existing 2 MB request limit and OAuth still apply.

## Operations (owner action required)

The runtime identity previously had access only to the named `mcp-oauth` database.
It now also needs read access to the website's `(default)` database:

```sh
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_MCP_RUNTIME_SA" \
  --role="roles/datastore.viewer" \
  --condition='expression=resource.name=="projects/YOUR_PROJECT_ID/databases/(default)",title=mcp-read-default-designs'
```

The existing `owner_id` + `updated_at desc` composite index used by the website
list serves the same query. Then rebuild and redeploy the hosted image
(`cloudbuild.hosted.yaml`, service `tinytldr-mcp`) without changing its other
settings. Connected agents pick up the new tools on their next session.

## Acceptance criteria

- Official MCP client over the authenticated hosted transport lists both tools,
  sees only its own non-deleted designs newest first, receives "not found" for
  deleted/other-account/guest/unknown IDs, and renders a fetched design with
  edited slot data to a downloadable 1080×1080 PNG; the stored design is unchanged.
- Local stdio still exposes exactly six tools.
- Website design-service behavior is unchanged after the schema move.
- Live: permission granted, image deployed, and a real account can list, fetch
  and render its own design through `https://mcp.tinytldr.com/mcp`.

## Verification

- `pnpm --filter @tinytldr/core build`, `pnpm --filter @tinytldr/mcp typecheck`
  and website/firebase typechecks passed; Prettier and ESLint passed on changed files.
- `npx --yes firebase-tools@15.34.2 emulators:exec --project demo-tinytldr --only auth,firestore,storage --non-interactive "pnpm exec vitest run mcp/test/HostedOAuth.test.ts mcp/test/McpServerE2E.test.ts website/firebase/test/DesignService.test.ts"`
  passed **36 tests / 3 suites**, including the new saved-design test.
- Release gate: the emulator `pnpm check` passed **44/44 test files**.
- Deployed 2026-11-07:
  - IAM: conditional `roles/datastore.viewer` (`McpReadDefaultDesigns`) was granted to
    the MCP runtime service account on the `(default)` database.
  - Image: Cloud Build `bf23e854` built `tinytldr-mcp/server:designs-20261107-1016`
    (SUCCESS).
  - Cloud Run: revision `tinytldr-mcp-00004-q6r` serves 100% of traffic. Concurrency 4
    and max 2 instances are unchanged.
  - Live checks: `/health` returned 200, the protected-resource metadata returned 200,
    and an unauthenticated `POST /mcp` returned 401. The new revision logged no
    warnings.
- Unverified: authenticated `tools/list` and `get_design` in a fresh agent session
  against a real account.
