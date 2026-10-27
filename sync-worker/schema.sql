-- 家庭药箱双站同步：每个同步密钥对应一行版本化 JSON 快照
-- 密钥原文不入库，sync_id 是密钥的 SHA-256。
CREATE TABLE IF NOT EXISTS sync_states (
  sync_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
