import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "release/**", "dist/**", "resources/**", "locales/**"] },
  js.configs.recommended,
  {
    files: ["server.js", "p2p.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.node }
  },
  {
    files: ["electron/**/*.cjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: globals.node }
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: globals.browser }
  }
];
