// src/apps/scenarioPlanner/shared/appCatalog.ts
//
// Single shared reference to the symbol catalog this app uses. Currently
// just the library's built-in APP-6D set, but if you ever need a custom
// graphic specific to this app, extend it here ONCE:
//
//   export const APP_CATALOG = APP6D_CATALOG.extend({ "my-icon": myDef });
//
// and every consumer below picks up the change automatically.
import { APP6D_CATALOG } from "@acc/app6d/symbols";

export const APP_CATALOG = APP6D_CATALOG;
