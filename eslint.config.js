// ESLint's flat config (ESLint 9): the old .eslintrc.cjs's rules, as they were.
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const code = ["**/*.{js,jsx,ts,tsx}"];

export default tseslint.config(
  // Not what git ignores: the builds, node_modules.
  includeIgnoreFile(fileURLToPath(new URL(".gitignore", import.meta.url))),

  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.commonjs, ...globals.es2015 },
    },
  },

  // React
  { files: code, ...react.configs.flat.recommended },
  { files: code, ...react.configs.flat["jsx-runtime"] },
  // The two rules react-hooks' recommended had before its React Compiler
  // rules (v6+).
  {
    files: code,
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  { files: code, ...jsxA11y.flatConfigs.recommended },
  {
    files: code,
    settings: {
      react: { version: "detect" },
      formComponents: ["Form"],
      linkComponents: [
        { name: "Link", linkAttribute: "to" },
        { name: "NavLink", linkAttribute: "to" },
      ],
    },
  },

  // TypeScript
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended, importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript],
    settings: {
      "import/internal-regex": "^~/",
      "import/resolver": {
        node: { extensions: [".ts", ".tsx"] },
        typescript: { alwaysTryTypes: true },
      },
    },
  },

  // Node: the build's own config files, and the CI scripts.
  {
    files: ["*.config.{js,ts}", "mdx-route-exports.ts", ".github/scripts/**"],
    languageOptions: { globals: globals.node },
  },
);
