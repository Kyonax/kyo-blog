/**
    .___   /\                    .___                    .__
  __| _/___)/     ____  ____   __| _/____   _______ __ __|  |   ____   ______
 / __ |\__  \   _/ ___\/  _ \ / __ |/ __ \  \_  __ \  |  \  | _/ __ \ /  ___/
/ /_/ | / __ \_ \  \__(  <_> ) /_/ \  ___/   |  | \/  |  /  |_\  ___/ \___ \
\____ |(____  /  \___  >____/\____ |\___  >  |__|  |____/|____/\___  >____  >
     \/     \/       \/           \/    \/                         \/     \/

eslint.config.ts
- [x] ESLint configuration for this project (Code Guidelines).
- [x] Enforces custom code guidelines:
      • snake_case for variables, functions, and methods
      • leading "_" for private methods
      • kebab-case for filenames
- [x] Integrates Vue rules and unused-imports cleanup
- [x] Uses Unicorn for filename-case enforcement

Author: Cristian D. Moreno - Kyonax
Contact: kyonax.corp@gmail.com
*/

import { globalIgnores } from "eslint/config";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";

import pluginVue from "eslint-plugin-vue";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginUnicorn from "eslint-plugin-unicorn";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue,js,jsx}"],
    plugins: {
      "unused-imports": pluginUnusedImports,
      unicorn: pluginUnicorn,
    },
  },
  globalIgnores([
    "**/dist/**",
    "**/dist-ssr/**",
    "**/coverage/**",
    "**/node_modules/**",
    // org2html writes an index.vue beside every page it builds. That is
    // GENERATED output, not source: linting it reports the engine's formatting
    // as this repo's problems. .gitignore already ignores "out/".
    "**/out/**",
    "eslint.config.ts",
  ]),
  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    // Flat config resolves a plugin namespace PER CONFIG OBJECT, so the rules
    // below must see the plugins in the object that applies them. Declaring
    // them only in "app/files-to-lint" above made every eslint run exit 2 with
    // "could not find plugin \"unused-imports\"".
    plugins: {
      "unused-imports": pluginUnusedImports,
      unicorn: pluginUnicorn,
    },
    rules: {
      eqeqeq: "error",
      "no-console": "warn",
      "prefer-const": "warn",

      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],

      "vue/component-api-style": ["error", ["script-setup", "composition"]],
      "vue/no-undef-components": "error",
      "vue/no-mutating-props": "error",
      "vue/no-unused-components": "warn",
      "vue/no-unused-vars": "warn",
      "vue/html-indent": ["warn", 2],
      "vue/no-v-html": "warn",

      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["snake_case", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "method",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "method",
          modifiers: ["private"],
          format: ["snake_case"],
          leadingUnderscore: "require",
        },
        {
          selector: "property",
          format: ["snake_case", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["snake_case"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enum",
          format: ["PascalCase", "UPPER_CASE"],
        },
        {
          selector: "objectLiteralProperty",
          format: null,
        },
      ],

      "unicorn/filename-case": [
        "error",
        {
          cases: {
            kebabCase: true,
          },
        },
      ],
    },
  },
  {
    name: "app/vue-files",
    files: ["**/*.vue"],
    rules: {
      "unicorn/filename-case": [
        "error",
        {
          cases: {
            pascalCase: true,
          },
        },
      ],
      "no-restricted-syntax": "off",
    },
  },
  {
    name: "app/tests",
    files: ["**/__tests__/**", "**/*.spec.*", "**/*.test.*"],
    rules: {
      "no-console": "off",
      "unicorn/filename-case": ["warn", { case: "kebabCase" }],
    },
  },
  {
    // ci/ holds command-line tools whose entire job is to print a report and
    // set an exit code. console IS their output.
    name: "app/ci-scripts",
    files: ["ci/**/*.{mjs,js,ts}"],
    rules: {
      "no-console": "off",
    },
  },
  {
    name: "app/declarations",
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/naming-convention": "off",
      "unicorn/filename-case": "off",
    },
  },
);
