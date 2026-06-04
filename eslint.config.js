// Automated quality gate: TypeScript + React-hooks correctness + JSX a11y.
// This is what turns "found a problem by eye" into "blocked at the door".
// Run: npm run lint   (also wired into CI before every Pages deploy).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  // Lint the product source. Skip build output, the vanilla AudioWorklet asset
  // (runs in worklet scope, not browser), and the throwaway spike diagnostic page.
  { ignores: ["dist/**", "node_modules/**", "public/**", "src/spike/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
