// Re-export from canonical location — src/shared/hooks/useCompositionData.ts
//
// This was a byte-for-byte duplicate of the shared hook apart from its import
// paths, which meant it resolved to the forked (and broken) copy of the data
// layer. Kept as a re-export so `../hooks/useCompositionData` imports inside
// this app keep resolving, including the type-only `CompositionRefData` ones.
export * from "@/shared/hooks/useCompositionData";
