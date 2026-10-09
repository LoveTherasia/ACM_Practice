/**
 * Tailwind v4 使用官方 PostCSS 插件。
 * taste-skill Section 3.A: 不要在 postcss.config.js 里注册 `tailwindcss` 插件。
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;