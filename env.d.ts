/**
 * 全局类型声明：Vite 环境变量
 * 说明：不使用 /// <reference types="vite/client" /> 避免旧项目可能的类型解析报错，
 *       只显式声明我们用到的环境变量即可。
 */

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
