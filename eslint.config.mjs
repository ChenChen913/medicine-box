import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * ESLint 扁平配置（ESLint 10）
 * 关注点：类型安全相关的通用规则 + React Hooks 规则。
 * 刻意不开 style 类规则（缩进/引号等交给编辑器与 .editorconfig），避免噪音淹没真问题。
 */
const hooksRules =
  reactHooks.configs?.flat?.recommended?.rules
  ?? reactHooks.configs?.recommended?.rules
  ?? {};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/**', 'backup/**', 'public/sw.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...hooksRules,
      // 本项目的数据加载/派生状态重置都写在 effect 里（服务层是异步的 localStorage/Supabase 读取），
      // 属于该规则允许的"与外部系统同步"场景；开启会导致既有正确写法全部报错。
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // E2E 脚本跑在 node 里，但 page.evaluate 的回调体是浏览器上下文（会用到 document/window），
    // 所以两种 globals 都要给。
    files: ['scripts/e2e.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Node 侧脚本与构建配置：CommonJS 配置文件的 require() 是正常的
    files: ['scripts/**/*.mjs', '**/*.config.js', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-empty': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
