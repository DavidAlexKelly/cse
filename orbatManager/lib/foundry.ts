// Re-export from canonical location — src/shared/lib/foundry.ts
//
// This file used to be a full second copy of the data-access layer. It and
// src/shared/lib/foundry.ts were forked and drifted: the shared copy kept a
// no-op `createEdgeFn` and an invalid `relationshipTypeKey`, so ORBATs written
// through it silently lost their hierarchy. There is now one implementation.
//
// Kept as a re-export so the ~10 `../lib/foundry` imports inside this app keep
// resolving. Prefer importing from "@/shared/lib/foundry" in new code.
export * from "@/shared/lib/foundry";
