-- ============================================================================
-- 家庭智慧药箱 · Supabase 建库脚本
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 幂等：可重复执行，已存在的对象不会报错
-- ============================================================================

-- ---------- 1. 药品表 ----------
create table if not exists public.medicines (
  id                     text primary key,
  name                   text not null,
  brand                  text,
  image_url              text,
  form_type              text,
  category               text,
  location               text,
  total_quantity         double precision default 0,
  unit                   text,
  threshold              double precision default 0,
  expiry_date            date,
  last_purchase_date     date,
  symptoms_treated       text,
  dosage_instruction     text,
  daily_usage            double precision default 0,
  side_effects           text,
  usage_frequency_score  double precision default 0,
  updated_at             timestamptz default now()
);

-- ---------- 2. 补货清单表 ----------
create table if not exists public.shopping_list (
  id             text primary key,
  medicine_name  text not null,
  reason         text check (reason in ('过期', '用尽', '手动添加')),
  status         text default 'pending' check (status in ('pending', 'bought')),
  created_at     timestamptz default now()
);

-- ---------- 3. 用药记录表 ----------
create table if not exists public.usage_logs (
  id             text primary key,
  medicine_id    text,
  medicine_name  text,
  brand          text,
  amount         double precision default 0,
  log_time       timestamptz default now(),
  user_name      text
);

create index if not exists usage_logs_log_time_idx on public.usage_logs (log_time desc);

-- ---------- 3.1 已有库的增量列（幂等）：品牌字段 ----------
alter table public.medicines  add column if not exists brand text;
alter table public.usage_logs add column if not exists brand text;

-- ============================================================================
-- 4. 行级安全策略 (RLS)
--    说明：前端只用 anon key，任何人拿到 URL+key 都能读写。
--          对「家庭自用小工具」这个量级是可接受的权衡，
--          但请不要把 service_role key 放到任何前端代码里。
-- ============================================================================
alter table public.medicines     enable row level security;
alter table public.shopping_list enable row level security;
alter table public.usage_logs    enable row level security;

drop policy if exists "anon_full_access_medicines"     on public.medicines;
drop policy if exists "anon_full_access_shopping_list" on public.shopping_list;
drop policy if exists "anon_full_access_usage_logs"    on public.usage_logs;

create policy "anon_full_access_medicines"
  on public.medicines for all to anon, authenticated
  using (true) with check (true);

create policy "anon_full_access_shopping_list"
  on public.shopping_list for all to anon, authenticated
  using (true) with check (true);

create policy "anon_full_access_usage_logs"
  on public.usage_logs for all to anon, authenticated
  using (true) with check (true);

-- PostgREST 需要显式的表权限（RLS 通过后再授权）
grant all on public.medicines     to anon, authenticated;
grant all on public.shopping_list to anon, authenticated;
grant all on public.usage_logs    to anon, authenticated;

-- ============================================================================
-- 5. 可选：把现有 db.json 里的数据一次性灌进 Supabase
--    如果你只是想让 App 自动生成示例数据，跳过这一段即可。
-- ============================================================================
-- insert into public.medicines (id, name, ...) values (...);

-- ============================================================================
-- 6. 排障 / 重置
-- ============================================================================
-- 清空所有药品数据（慎用）：
--   truncate table public.medicines, public.shopping_list, public.usage_logs;
-- 检查策略是否生效：
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
