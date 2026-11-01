// Re-export from canonical location — src/shared/hooks/useOrbatData.ts
//
// This was a byte-for-byte duplicate of the shared hook apart from its import
// paths, which meant it resolved to the forked (and broken) copy of the data
// layer. Kept as a re-export so `../hooks/useOrbatData` imports keep resolving.
export * from "@/shared/hooks/useOrbatData";
