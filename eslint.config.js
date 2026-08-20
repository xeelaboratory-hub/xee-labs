import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// ── ESLint flat config ────────────────────────────────────────────────────
// Deliberately scoped to what tsc can't already tell us. `npm run typecheck`
// is clean repo-wide and owns type correctness; this config exists for the
// classes of bug types don't catch — stale hook dependency arrays, unsafe
// React Fast Refresh exports, unreachable code.
//
// typescript-eslint runs in its non-type-checked mode: the type-aware rules
// need a second full program build per lint run, and they would largely
// duplicate what `npm run typecheck` already enforces.

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "backend/**", "scraper/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Vite's Fast Refresh only handles a module whose exports are all
      // components; a stray non-component export silently degrades HMR to a
      // full reload. Warn rather than error — several files legitimately
      // co-locate constants with a component.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // `_`-prefixed names are the established convention here for values
      // that must be bound but not read (destructuring rest, unused catch
      // bindings, positional callback params).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // `src/` currently contains zero `any` — this is a ratchet against new
      // ones rather than a concession to existing code. Left at "warn" so an
      // `any` that is genuinely needed at a library seam doesn't fail the
      // run; promote to "error" if the count stays at zero.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    files: ["src/**/*.test.{ts,tsx}", "src/__tests__/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
);
