/** @type {import('tailwindcss').Config} */
// Tailwind 本地编译配置：
// content 覆盖所有可能出现 className 的源码文件，
// 构建时只会打包实际用到的样式类（替代原 CDN 运行时编译）。
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [
    // 提供 animate-in / fade-in / zoom-in-95 等动画类（弹窗动画依赖它）
    require('tailwindcss-animate'),
  ],
};
