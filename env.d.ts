/**
 * 全局类型声明：Vite 环境变量
 * 说明：不使用 /// <reference types="vite/client" /> 避免旧项目可能的类型解析报错，
 *       只显式声明我们用到的环境变量即可。
 */

interface ImportMetaEnv {
  readonly BASE_URL: string;
  /** true = 生产构建（index.tsx 用它在生产环境注册 Service Worker） */
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Vite 的 `?raw` 后缀导入：把文件内容作为字符串内联进包体（同步可得，无需网络往返）。
 * index.tsx 用它内联演示数据，避免"等 fetch 回来才挂载 React"造成的首屏 CLS 0.9。
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
