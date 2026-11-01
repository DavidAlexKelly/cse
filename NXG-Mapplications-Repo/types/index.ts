// Re-export from canonical location — src/shared/types/index.ts
//
// This file previously re-exported the shared module AND redeclared every type
// in it verbatim below the re-export, so the same domain model existed twice in
// two nominally distinct modules. It compiled (local declarations shadow
// star-exports) but meant edits to one copy silently did not reach consumers of
// the other. The body has been deleted; this is now purely an alias for the
// ~30 `../../../types` imports that point at it.
export * from "../shared/types/index";
