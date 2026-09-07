# Claim Worksheet Engineering Rules

- Inspect existing implementation before changing code.
- Prefer minimal root-cause fixes.
- Reuse existing functions and architecture.
- Never create duplicate functions or duplicate DOM IDs.
- Avoid patch stacking and unnecessary overrides.
- Preserve existing business behavior unless explicitly changed.

## Architecture
- Claims are the single source of truth.
- Preserve the existing local-first IndexedDB + Firestore sync architecture.
- Do not modify dirty queues, pending sync, version conflict handling,
  tombstones, realtime sync, backup/recovery, or persistence unless explicitly required.
- Do not add Firestore collections/listeners unless explicitly required.

## Roles
- Admin: full operational + administrative access.
- Accounting: Accounting workflow.
- Finance: claim creation + Finance/payment workflow; Accounting data is read-only.
- Viewer: read/search only.

## Finance invariant
NEVER ALLOW PAID WITHOUT HARDCOPY.

## Changes
After every implementation report:
- files changed
- behavior changed
- tests actually run
- passed/failed
- remaining risks

Never claim a test passed unless it was executed.
