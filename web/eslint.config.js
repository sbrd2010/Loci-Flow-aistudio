import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Lint: JavaScript's recommended rules and React's rules of hooks. Only
// errors fail `npm run lint` (and CI); warnings are there to read.
export default [
  { ignores: ["dist/**", "android/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Without a JSX plugin, a component used only in JSX looks unused:
      // capitalised names are left alone.
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z_]", args: "none", ignoreRestSiblings: true, caughtErrors: "none" }],
      // `catch {}` is how best-effort calls (storage, notifications,
      // analytics) say "a failure here doesn't matter".
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // The service worker runs in its own scope (clients, self).
  { files: ["public/sw.js"], languageOptions: { globals: globals.serviceworker } },
];
