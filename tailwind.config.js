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
    './ui/**/*.{ts,tsx}',
    './modern/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // 新版 UI（modern）的 Material 3 设计 token。
      // 全部带 m3- 前缀且不覆盖任何默认主题项，
      // 保证经典版 UI（classic）的样式完全不受影响。
      colors: {
        m3: {
          primary: '#005c55',
          'on-primary': '#ffffff',
          'primary-container': '#0f766e',
          'on-primary-container': '#a3faef',
          'primary-fixed': '#9cf2e8',
          'primary-fixed-dim': '#80d5cb',
          'on-primary-fixed-variant': '#00504a',
          secondary: '#006b5f',
          'on-secondary': '#ffffff',
          'secondary-container': '#62fae3',
          'on-secondary-container': '#007165',
          'secondary-fixed': '#62fae3',
          'secondary-fixed-dim': '#3cddc7',
          tertiary: '#734700',
          'on-tertiary': '#ffffff',
          'tertiary-container': '#945d00',
          'on-tertiary-container': '#ffe6cc',
          'tertiary-fixed': '#ffddb8',
          'tertiary-fixed-dim': '#ffb95f',
          'on-tertiary-fixed': '#2a1700',
          'on-tertiary-fixed-variant': '#653e00',
          error: '#ba1a1a',
          'on-error': '#ffffff',
          'error-container': '#ffdad6',
          'on-error-container': '#93000a',
          surface: '#f9f9ff',
          'on-surface': '#111c2d',
          'surface-variant': '#d8e3fb',
          'on-surface-variant': '#3e4947',
          'surface-container-lowest': '#ffffff',
          'surface-container-low': '#f0f3ff',
          'surface-container': '#e7eeff',
          'surface-container-high': '#dee8ff',
          'surface-container-highest': '#d8e3fb',
          'surface-bright': '#f9f9ff',
          'surface-dim': '#cfdaf2',
          outline: '#6e7977',
          'outline-variant': '#bdc9c6',
          'inverse-surface': '#263143',
          'inverse-on-surface': '#ecf1ff',
          'inverse-primary': '#80d5cb',
          background: '#f9f9ff',
          'on-background': '#111c2d',
        },
      },
      fontFamily: {
        // 不引入外部字体文件：优先使用本机已装的 Plus Jakarta Sans / Inter，
        // 缺失时无缝回落系统字体，中文回落苹方/微软雅黑。
        'm3-display': ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        'm3-body': ['Inter', 'system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
      },
    },
  },
  plugins: [
    // 提供 animate-in / fade-in / zoom-in-95 等动画类（弹窗动画依赖它）
    require('tailwindcss-animate'),
  ],
};
