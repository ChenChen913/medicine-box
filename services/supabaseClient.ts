/**
 * 文件名: services/supabaseClient.ts
 * 功能: Supabase 客户端初始化
 * 描述:
 *   - 只使用 URL + anon key（public key），这两个值设计上就允许暴露在前端，
 *     真正的访问控制由数据库 RLS (Row Level Security) 策略保证。
 *   - 如果环境变量缺失，客户端为 null，应用自动降级为 localStorage 存储。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured: boolean =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** 当前实际使用的存储后端，用于 UI 展示 */
export const storageMode: 'supabase' | 'local' = isSupabaseConfigured ? 'supabase' : 'local';
