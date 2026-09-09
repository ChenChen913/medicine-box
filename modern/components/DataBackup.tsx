/**
 * 文件名: modern/components/DataBackup.tsx
 * 功能: 数据导入导出弹窗（新版 / 经典版 UI 共用）
 * 描述: 项目数据保存在浏览器 localStorage（或 Supabase），换设备 / 清缓存易丢失。
 *       导出：整库 JSON 备份（药品全部属性——名称/品牌/分类/剂型/库存/单位/阈值/效期/
 *       购买日期/症状/用法/副作用/位置/图片 base64，以及待补货清单、全部用药记录），
 *       触发浏览器下载。
 *       导入：选择备份 JSON → 合并去重（保留现有，同 id 以导入为准）或整库覆盖恢复，
 *       逐条清洗校验，缺字段/类型不合规自动修复或丢弃并计数提示。
 *       两版 UI 复用同一组件与 m3 token（tailwind content 已含全部源码目录）。
 */

import React, { useRef, useState } from 'react';
import { MedicineService, ExportPayload, ImportMode, ImportResult } from '../../services/medicineService';
import { ModalShell } from './Dialogs';
import { Icon } from '../icons';

interface Props {
  onClose: () => void;
  /** 导出/导入成功后的汇总文案，由外层 toast 提示并刷新数据 */
  onDone: (message: string) => void;
}

/** 当前时间 → 备份文件名用的时间戳（本地时区，精确到分） */
function backupFileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const DataBackupDialog: React.FC<Props> = ({ onClose, onDone }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 清空全部数据：两步确认（第一步展开红色警告区，第二步才真正执行）
  const [confirmClear, setConfirmClear] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const json = await MedicineService.exportData();
      const payload = JSON.parse(json) as ExportPayload;
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `药箱备份-${backupFileStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 立即 revoke 在部分浏览器（尤其移动端）会中断尚未开始的下载，延迟释放更稳妥
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onDone(
        `已导出备份：药品 ${payload.counts.medicines} 条、待补货 ${payload.counts.shoppingList} 条、用药记录 ${payload.counts.logs} 条，请妥善保存 JSON 文件`
      );
    } catch (e) {
      setError(`导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const raw = await file.text();
      const result: ImportResult = await MedicineService.importData(raw, mode);
      const skipped = result.skippedMedicines + result.skippedLogs;
      onDone(
        `已${mode === 'replace' ? '覆盖恢复' : '合并导入'}：药品 ${result.medicines} 条、待补货 ${result.shoppingList} 条、用药记录 ${result.logs} 条` +
        (skipped > 0 ? `（${skipped} 条无效数据已跳过）` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败：文件内容无法识别');
    } finally {
      setBusy(false);
    }
  };

  /** 清空全部数据：二次确认后执行；成功后交给外层 toast + 刷新 */
  const handleClearAll = async () => {
    setBusy(true);
    setError('');
    try {
      await MedicineService.clearAllData();
      onDone('已清空系统内全部数据，药箱已重置为空');
    } catch (e) {
      setError(e instanceof Error ? e.message : '清空失败，请重试');
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  };

  return (
    <ModalShell title="数据备份与恢复" subtitle="导出完整备份，或从备份文件恢复" icon="archive" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {/* 导出 */}
        <section className="rounded-2xl bg-m3-surface-container-low/70 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon name="archive" className="w-4.5 h-4.5 w-[18px] h-[18px] text-m3-primary" />
            <span className="text-sm font-bold text-m3-on-surface">导出备份</span>
          </div>
          <p className="text-xs text-m3-on-surface-variant leading-relaxed">
            下载 JSON 备份文件，详细覆盖药品的每一个属性（名称、品牌、分类、剂型、库存与单位、预警阈值、有效期、购买日期、主治症状、服用方式、副作用、存放位置、图片），以及待补货清单和全部用药记录。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleExport}
            className="mt-1 h-11 rounded-xl bg-m3-primary text-m3-on-primary text-sm font-semibold shadow-md hover:bg-m3-primary-container active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-1.5"
          >
            <Icon name="archive" className="w-[18px] h-[18px]" />
            <span>导出 JSON 备份文件</span>
          </button>
        </section>

        {/* 导入 */}
        <section className="rounded-2xl bg-m3-surface-container-low/70 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Icon name="sync" className="w-[18px] h-[18px] text-m3-primary" />
            <span className="text-sm font-bold text-m3-on-surface">导入备份</span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }}
            className="hidden"
            aria-label="选择备份 JSON 文件"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-11 px-4 rounded-xl border-2 border-dashed border-m3-outline-variant hover:border-m3-primary text-sm text-m3-on-surface-variant hover:text-m3-primary transition-colors flex items-center justify-center gap-2 truncate"
          >
            <Icon name="inventory_2" className="w-[18px] h-[18px] shrink-0" />
            <span className="truncate">{file ? file.name : '点击选择备份 JSON 文件'}</span>
          </button>

          {/* 模式选择 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="导入模式">
            {([
              { key: 'merge' as ImportMode, title: '合并导入', desc: '保留当前数据，按 ID 去重并入备份内容，同 ID 以备份为准', icon: 'sync' },
              { key: 'replace' as ImportMode, title: '覆盖恢复', desc: '清空当前数据，完全恢复为备份时的状态（适用于换机/还原）', icon: 'refresh' },
            ]).map(opt => {
              const active = mode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(opt.key)}
                  className={`text-left rounded-xl p-3 border transition-all ${active
                    ? 'border-m3-primary bg-m3-primary/10 ring-1 ring-m3-primary/30'
                    : 'border-m3-outline-variant/60 bg-m3-surface-container-lowest hover:border-m3-primary/50'}`}
                >
                  <span className={`flex items-center gap-1.5 text-[13px] font-bold ${active ? 'text-m3-primary' : 'text-m3-on-surface'}`}>
                    <Icon name={opt.icon} className="w-4 h-4" />
                    {opt.title}
                  </span>
                  <span className="block text-[11px] text-m3-on-surface-variant leading-relaxed mt-1">{opt.desc}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!file || busy}
            onClick={handleImport}
            className="h-11 rounded-xl bg-m3-on-surface text-m3-surface text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? '处理中…' : mode === 'replace' ? '确认覆盖恢复' : '开始合并导入'}
          </button>
        </section>

        {error && (
          <div className="rounded-xl p-3 bg-m3-error-container text-m3-error text-xs leading-relaxed flex items-start gap-2" role="alert">
            <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-[11px] text-m3-outline leading-relaxed">
          提示：日常建议「导出备份」保存到云盘/网盘；换新手机后先用「覆盖恢复」导入备份，即可无缝迁移全部数据。
        </p>

        {/* 危险区：清空全部数据（投产/reset 场景；两步确认防误触） */}
        <section className="rounded-2xl border border-m3-error/30 bg-m3-error-container/30 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon name="warning" className="w-[18px] h-[18px] text-m3-error" />
            <span className="text-sm font-bold text-m3-error">清空全部数据</span>
          </div>
          {!confirmClear ? (
            <>
              <p className="text-xs text-m3-on-surface-variant leading-relaxed">
                将删除本系统内的全部药品、待补货清单与用药记录（云端同步时云端也一并清空），操作前建议先导出备份。
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
                className="h-11 rounded-xl border border-m3-error/40 text-m3-error text-sm font-semibold hover:bg-m3-error/10 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                我要清空全部数据
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-m3-error leading-relaxed" role="alert">
                确认要清空吗？此操作<b>不可恢复</b>。若还未导出备份，请先取消并导出。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 h-11 rounded-xl border border-m3-outline-variant text-m3-on-surface text-sm font-semibold hover:bg-m3-surface-container-low transition-colors disabled:opacity-50"
                >
                  取消，先导出备份
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleClearAll}
                  className="flex-1 h-11 rounded-xl bg-m3-error text-m3-on-error text-sm font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  {busy ? '清空中…' : '确认清空'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </ModalShell>
  );
};
