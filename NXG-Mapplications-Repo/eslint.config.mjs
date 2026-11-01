// @ts-check
import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/orbat-manager/src/**/*.{js,mjs,cjs,ts,jsx,tsx}"],
  settings: {
    react: {
      version: "detect",
    },
  },
  languageOptions: {
    globals: {
      ...globals.browser,
    },
    parser: tsParser,
  },
  extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  plugins: {
    react: /** @type import("eslint").ESLint.Plugin */ (reactPlugin),
    "react-refresh": reactRefresh,
    "react-hooks": /** @type import("eslint").ESLint.Plugin */ (reactHooksPlugin),
  },
  rules: {
    .../** @type import("eslint").Linter.RulesRecord */
    (reactPlugin.configs.flat?.recommended.rules),
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react-refresh/only-export-components": [
      "warn",
      {
        allowConstantExport: true,
      },
    ],
    eqeqeq: ["error", "always", { null: "ignore" }],
    "no-console": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
      },
    ],
    "react/react-in-jsx-scope": "off",
  },
});
