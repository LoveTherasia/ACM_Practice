import { FlatCompat } from "@eslint/eslintrc";

/** ESLint 9 flat config, delegating to eslint-config-next. */
const eslintConfig = [
  ...new FlatCompat({
    baseDirectory: import.meta.dirname,
  }).extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "skills/**",
      "problems/**",
      "training/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
