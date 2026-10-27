import React, { useEffect, useState } from 'react';
import { getSyncStatus, type SyncStatus } from '../../services/syncClient';
import { Icon } from '../icons';

/** 双站同步状态入口；未启用同步时不占用界面空间。 */
export const SyncStatusBadge: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);

  useEffect(() => {
    const onStatus = (e: Event) => setStatus((e as CustomEvent<SyncStatus>).detail);
    window.addEventListener('mb:sync-status', onStatus);
    return () => window.removeEventListener('mb:sync-status', onStatus);
  }, []);

  if (!status.configured) return null;
  const offline = !status.online;
  const abnormal = status.online && !!status.message;
  const label = offline ? '离线只读' : abnormal ? '同步异常' : status.initialized ? '云同步' : '待同步';
  const color = offline || abnormal
    ? 'bg-m3-tertiary-fixed text-m3-on-tertiary-fixed-variant'
    : 'bg-m3-primary/10 text-m3-primary';
  const time = status.lastSyncedAt ? `最近同步：${new Date(status.lastSyncedAt).toLocaleString()}` : '尚未完成首次同步';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}，打开同步设置`}
      title={`${time}${status.message ? `；${status.message}` : ''}`}
      className={`h-9 px-2.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${color}`}
    >
      <Icon name={offline || abnormal ? 'warning' : 'sync'} className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
};
