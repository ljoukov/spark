import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  // Global ignores (flat config replaces .eslintignore)
  {
    ignores: ["node_modules", "dist"],
  },

  // Core JS recommended rules
  js.configs.recommended,

  // Very strict TS rules (includes recommended + strict + type-checked)
  tseslint.configs.strictTypeChecked,

  // Project-specific typed-linting + extra rules
  {
    languageOptions: {
      parserOptions: {
        // Use your project TS config for type-aware rules
        project: ["./tsconfig.json"],
        tsconfigRootDir: new URL(".", import.meta.url).pathname,
      },
    },
    rules: {
      // Use the TS extension rule instead of the core one
      "no-throw-literal": "off",
      "@typescript-eslint/only-throw-error": "error",

      // Keep deprecated APIs as hard errors
      "@typescript-eslint/no-deprecated": "error",
    },
  }
);
