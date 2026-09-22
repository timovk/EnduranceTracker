import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // The compiled desktop shell. `desktop/tsconfig.json` emits CommonJS, so
    // linting it as source only ever reports the `require()` calls tsc itself
    // wrote. The sources under `desktop/src` are linted normally.
    "desktop/out/**",
    // electron-builder's output: an unpacked Electron runtime and a copy of
    // the application. Thousands of files of somebody else's JavaScript, and
    // it appears the moment anyone runs `npm run desktop:pack`.
    "dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
