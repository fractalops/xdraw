import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["lib/**", "node_modules/**", "output/**"] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    plugins: { sonarjs },
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.tools.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/require-await": "off",
      // Existing violations are recorded in eslint-suppressions.json; these
      // thresholds bite on new code only. Lower them as hotspots are split.
      "complexity": ["error", { max: 20 }],
      "sonarjs/cognitive-complexity": ["error", 25],
    },
  },
);
