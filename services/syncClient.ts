import type { Medicine, ShoppingItem, UsageLog } from '../types';

export interface SyncDb {
  medicines: Medicine[];
  shoppingList: ShoppingItem[];
  logs: UsageLog[];
}

export interface SyncState {
  data: SyncDb | null;
  version: number;
  updatedAt: string | null;
}

export interface SyncStatus {
  configured: boolean;
  online: boolean;
  initialized: boolean;
  version: number;
  lastSyncedAt: string | null;
  message: string;
}

const DEFAULT_API_URL = 'https://medicine-box-sync.maomaotech913.workers.dev';
const API_URL = ((import.meta.env.VITE_SYNC_API_URL as string | undefined) || DEFAULT_API_URL).replace(/\/+$/, '');
const KEY_STORAGE = 'smart-medicine-box:sync-key:v1';
const POLL_MS = 10000;
const REQUEST_TIMEOUT_MS = 12000;

let status: SyncStatus = {
  configured: isCloudSyncEnabled(),
  online: true,
  initialized: true,
  version: 0,
  lastSyncedAt: null,
  message: '',
};

function emitStatus(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SyncStatus>('mb:sync-status', { detail: { ...status } }));
  }
}

function updateStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  emitStatus();
}

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

export function getSyncKey(): string {
  try {
    return (localStorage.getItem(KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

export function isCloudSyncEnabled(): boolean {
  return getSyncKey().length > 0;
}

export function generateSyncKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function saveSyncKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
  updateStatus({ configured: true, online: true, message: '' });
}

export function clearSyncKey(): void {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* 忽略不可写存储 */ }
  status = { configured: false, online: true, initialized: true, version: 0, lastSyncedAt: null, message: '' };
  emitStatus();
}

export function markSyncApplied(state: SyncState): void {
  updateStatus({
    configured: isCloudSyncEnabled(),
    online: true,
    initialized: state.data !== null,
    version: state.version,
    lastSyncedAt: state.updatedAt || new Date().toISOString(),
    message: '',
  });
}

export class SyncApiError extends Error {
  status: number;
  remote: SyncState | null;

  constructor(message: string, statusCode: number, remote: SyncState | null = null) {
    super(message);
    this.name = 'SyncApiError';
    this.status = statusCode;
    this.remote = remote;
  }
}

async function request(path: string, init: RequestInit, key: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

function networkError(e: unknown): SyncApiError {
  updateStatus({ configured: isCloudSyncEnabled(), online: false, message: '无法连接云端，当前仅能读取本机镜像' });
  const message = e instanceof Error && e.name === 'AbortError'
    ? '云端同步超时，请检查网络后重试'
    : '无法连接云端，请检查网络后重试';
  return new SyncApiError(message, 0);
}

export async function fetchSyncState(key = getSyncKey()): Promise<SyncState> {
  if (key.length < 16 || key.length > 256) {
    throw new SyncApiError('同步密钥长度应为 16 到 256 个字符', 400);
  }
  let response: Response;
  try {
    response = await request('/api/state', { method: 'GET' }, key);
  } catch (e) {
    throw networkError(e);
  }

  if (response.status === 404) {
    updateStatus({ configured: isCloudSyncEnabled(), online: true, initialized: false, version: 0, message: '' });
    return { data: null, version: 0, updatedAt: null };
  }
  if (!response.ok) {
    updateStatus({ online: true, message: `云端读取失败（HTTP ${response.status}）` });
    throw new SyncApiError(`云端读取失败（HTTP ${response.status}）`, response.status);
  }
  const state = await response.json() as SyncState;
  updateStatus({
    configured: isCloudSyncEnabled(),
    online: true,
    initialized: true,
    version: state.version,
    lastSyncedAt: state.updatedAt,
    message: '',
  });
  return state;
}

export async function putSyncState(data: SyncDb, baseVersion: number, key = getSyncKey()): Promise<SyncState> {
  let response: Response;
  try {
    response = await request('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ data, baseVersion }),
    }, key);
  } catch (e) {
    throw networkError(e);
  }

  if (response.status === 409) {
    const body = await response.json() as { current?: SyncState };
    updateStatus({ online: true, message: '另一处已更新数据，本次修改未保存' });
    throw new SyncApiError('另一处已更新数据，本次修改未保存，请核对后重试', 409, body.current ?? null);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: string };
      detail = body.error ? `：${body.error}` : '';
    } catch { /* 非 JSON 错误响应 */ }
    updateStatus({ online: true, message: `云端写入失败（HTTP ${response.status}）` });
    throw new SyncApiError(`云端写入失败（HTTP ${response.status}）${detail}`, response.status);
  }

  const state = await response.json() as SyncState;
  markSyncApplied(state);
  return state;
}

/** 每 10 秒拉取一次；窗口重新聚焦、恢复在线时立即拉取。 */
export function startSyncPolling(onRemoteChange: (state: SyncState) => void): () => void {
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight || !isCloudSyncEnabled() || document.visibilityState === 'hidden') return;
    inFlight = true;
    const before = getSyncStatus().version;
    try {
      const remote = await fetchSyncState();
      if (!stopped && remote.version !== before) onRemoteChange(remote);
    } catch {
      // 错误已写入同步状态；后台轮询不打扰用户，等待下次恢复
    } finally {
      inFlight = false;
    }
  };

  const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
  const onOnline = () => { void tick(); };
  const timer = window.setInterval(() => { void tick(); }, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onOnline);
  void tick();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onOnline);
  };
}
