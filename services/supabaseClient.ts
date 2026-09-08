/**
 * 文件名: services/supabaseClient.ts
 * 功能: Supabase 客户端初始化
 * 描述:
 *   - 只使用 URL + anon key（public key），这两个值设计上就允许暴露在前端，
 *     真正的访问控制由数据库 RLS (Row Level Security) 策略保证。
 *   - 如果环境变量缺失，客户端不会初始化，应用自动降级为 localStorage 存储。
 *   - supabase-js 体积较大（打包后约百余 KB），这里改为动态 import 懒加载：
 *     localStorage 单机模式下完全不会加载这份依赖，显著减小首屏 JS 体积。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured: boolean =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * 懒获取 Supabase 客户端（首次调用时才动态加载 supabase-js）。
 * 未配置环境变量时 reject，调用方需 catch 并走本地降级逻辑。
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured) {
    return Promise.reject(new Error('Supabase 未配置'));
  }
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    );
  }
  return clientPromise;
}

/** 当前实际使用的存储后端，用于 UI 展示 */
export const storageMode: 'supabase' | 'local' = isSupabaseConfigured ? 'supabase' : 'local';
