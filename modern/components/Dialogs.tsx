/**
 * 文件名: modern/components/Dialogs.tsx
 * 功能: 新版 UI 的弹窗集合
 * 描述: Material 3 风格的四个业务弹窗，逻辑与经典版完全一致（同一服务层）：
 *       - ConsumeDialog  服药确认（数量可调，上限 = 当前库存）
 *       - DeleteDialog   删除确认
 *       - RestockDialog  补货登记（新数量 + 新效期 → restockMedicine）
 *       - MedicineForm   入库 / 编辑表单（覆盖全部真实字段，含本地图片上传）
 */

import React, { useState } from 'react';
import { FormType, Medicine } from '../../types';
import { MedicineService, todayDateString, localDateString } from '../../services/medicineService';
import { Icon, IconName } from '../icons';

// ---------- 通用弹窗外壳 ----------

export const ModalShell: React.FC<{ title: string; subtitle?: string; icon?: IconName; onClose: () => void; children: React.ReactNode; wide?: boolean }> =
({ title, subtitle, icon = 'info', onClose, children, wide }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <div className="fixed inset-0 bg-m3-on-surface/40 backdrop-blur-[2px] animate-in fade-in duration-200" onClick={onClose} />
    <div
      className={`relative bg-m3-surface-container-lowest rounded-3xl w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-200`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="p-5 md:p-6 pb-3 flex items-center justify-between border-b border-m3-surface-container-low sticky top-0 bg-m3-surface-container-lowest z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
            <Icon name={icon} className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-m3-on-surface tracking-tight">{title}</h3>
            {subtitle && <span className="text-xs text-m3-on-surface-variant">{subtitle}</span>}
          </div>
        </div>
        <button type="button" aria-label="关闭" onClick={onClose}
          className="w-8 h-8 rounded-full bg-m3-surface-container-low hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center transition-colors shrink-0">
          <Icon name="close" className="w-[18px] h-[18px]" />
        </button>
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </div>
  </div>
);

// ---------- 服药确认 ----------

interface ConsumeProps { med: Medicine; onClose: () => void; onDone: (amount: number) => void; }

export const ConsumeDialog: React.FC<ConsumeProps> = ({ med, onClose, onDone }) => {
  const [amount, setAmount] = useState(() => Math.max(1, Math.min(med.daily_usage || 1, med.total_quantity)));
  const max = Math.max(1, med.total_quantity);

  return (
    <ModalShell title="确认服药打卡" subtitle={`${med.name} · 剩余 ${med.total_quantity} ${med.unit}`} icon="check_circle" onClose={onClose}>
      <div className="flex items-center justify-center gap-6 mb-7 mt-2">
        <button type="button" aria-label="减少数量" onClick={() => setAmount(Math.max(1, amount - 1))}
          className="w-12 h-12 rounded-full bg-m3-surface-container-low text-xl font-bold text-m3-on-surface-variant flex items-center justify-center hover:bg-m3-surface-container active:scale-95 transition-all">−</button>
        <div className="flex flex-col items-center min-w-[64px]">
          <span className="text-4xl font-extrabold text-m3-on-surface tracking-tight">{amount}</span>
          <span className="text-xs text-m3-on-surface-variant font-medium mt-1">{med.unit}</span>
        </div>
        <button type="button" aria-label="增加数量" onClick={() => setAmount(Math.min(max, amount + 1))} disabled={amount >= max}
          className="w-12 h-12 rounded-full bg-m3-surface-container-low text-xl font-bold text-m3-on-surface-variant flex items-center justify-center hover:bg-m3-surface-container active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none">+</button>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-m3-outline-variant text-m3-on-surface font-semibold hover:bg-m3-surface-container-low transition-colors">取消</button>
        <button type="button" onClick={() => onDone(amount)}
          className="flex-1 py-3 rounded-full bg-m3-primary text-m3-on-primary font-semibold shadow-md hover:bg-m3-primary-container active:scale-[0.98] transition-all">确认打卡</button>
      </div>
    </ModalShell>
  );
};

// ---------- 删除确认 ----------

interface DeleteProps { med: Medicine; onClose: () => void; onDone: () => void; }

export const DeleteDialog: React.FC<DeleteProps> = ({ med, onClose, onDone }) => (
  <ModalShell title="确认删除？" subtitle="此操作不可恢复" icon="delete" onClose={onClose}>
    <p className="text-sm text-m3-on-surface-variant leading-relaxed mb-6">
      将把 <span className="font-semibold text-m3-on-surface">{med.name}</span> 从药箱中彻底移除，其待补货提醒会一并清理，历史打卡记录保留。
    </p>
    <div className="flex gap-3">
      <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-m3-outline-variant text-m3-on-surface font-semibold hover:bg-m3-surface-container-low transition-colors">取消</button>
      <button type="button" onClick={onDone}
        className="flex-1 py-3 rounded-full bg-m3-error text-m3-on-error font-semibold shadow-md hover:opacity-90 active:scale-[0.98] transition-all">确定删除</button>
    </div>
  </ModalShell>
);

// ---------- 补货登记 ----------

interface RestockProps { item: { id: string; medicine_name: string }; onClose: () => void; onDone: () => void; }

export const RestockDialog: React.FC<RestockProps> = ({ item, onClose, onDone }) => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const [qty, setQty] = useState('');
  const [expiry, setExpiry] = useState(localDateString(nextYear));
  const valid = Number(qty) > 0 && !!expiry;

  return (
    <ModalShell title="购入登记" subtitle={`药品：${item.medicine_name}`} icon="shopping_bag" onClose={onClose}>
      <div className="flex flex-col gap-4 mb-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-m3-on-surface">新购入数量</span>
          <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="如：24" autoFocus
            className="h-11 px-4 rounded-xl bg-m3-surface-container-low text-m3-on-surface font-bold outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-m3-on-surface">新有效期至</span>
          <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)}
            className="h-11 px-4 rounded-xl bg-m3-surface-container-low text-m3-on-surface outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all" />
        </label>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-m3-outline-variant text-m3-on-surface font-semibold hover:bg-m3-surface-container-low transition-colors">取消</button>
        <button type="button" disabled={!valid} onClick={async () => { await MedicineService.restockMedicine(item.id, parseFloat(qty), expiry); onDone(); }}
          className="flex-1 py-3 rounded-full bg-m3-primary text-m3-on-primary font-semibold shadow-md hover:bg-m3-primary-container active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none">确认更新</button>
      </div>
    </ModalShell>
  );
};

// ---------- 入库 / 编辑表单 ----------

const CATEGORIES = ['感冒药', '止痛药', '肠胃药', '抗生素', '心脑血管', '抗过敏', '咽喉用药', '外用药', '眼科用药', '保健品', '医疗器械', '其他'];
const UNITS = ['粒', '片', '盒', '袋', '瓶', '支', 'ml', '包', '克'];

interface FormProps { editing?: Medicine; onClose: () => void; onDone: (name: string) => void; }

/** 从 "每日X次，每次Y单位" 解析频次（与经典版同一正则） */
function parseDosage(instruction: string): { freq: string; amount: string } {
  const m = /每日(\d+(\.\d+)?)次，每次(\d+(\.\d+)?)/.exec(instruction || '');
  return m ? { freq: m[1], amount: m[3] } : { freq: '', amount: '' };
}

export const MedicineForm: React.FC<FormProps> = ({ editing, onClose, onDone }) => {
  const initDosage = editing ? parseDosage(editing.dosage_instruction) : { freq: '1', amount: '1' };
  const [dosageFreq, setDosageFreq] = useState(initDosage.freq);
  const [dosageAmount, setDosageAmount] = useState(initDosage.amount);
  const [form, setForm] = useState<Partial<Medicine>>(
    editing ? { ...editing } : {
      form_type: FormType.TABLET, total_quantity: 1, unit: '粒',
      category: '感冒药', threshold: 5, daily_usage: 0, usage_frequency_score: 0,
    }
  );
  const [preview, setPreview] = useState(
    editing?.image_url && editing.image_url.startsWith('data:') ? editing.image_url : ''
  );

  const inputCls = 'h-11 px-4 rounded-xl bg-m3-surface-container-low text-sm text-m3-on-surface placeholder:text-m3-outline outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all w-full';
  const labelCls = 'text-xs font-semibold text-m3-on-surface mb-1.5 block';

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('图片太大，请选择 2MB 以内的图片');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPreview(result);
      setForm(prev => ({ ...prev, image_url: result }));
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalDosage = form.dosage_instruction || '';
    let estimatedDaily = Number(form.daily_usage) || 0;
    if (dosageFreq && dosageAmount) {
      finalDosage = `每日${dosageFreq}次，每次${dosageAmount}${form.unit}`;
      estimatedDaily = parseFloat(dosageFreq) * parseFloat(dosageAmount);
    }

    const common = {
      name: form.name || '未命名',
      category: form.category || '其他',
      location: form.location || '未知',
      total_quantity: Number(form.total_quantity) || 0,
      unit: form.unit || '粒',
      threshold: Number(form.threshold) || 0,
      expiry_date: form.expiry_date || editing?.expiry_date || todayDateString(),
      last_purchase_date: form.last_purchase_date || editing?.last_purchase_date || todayDateString(),
      symptoms_treated: form.symptoms_treated || '',
      dosage_instruction: finalDosage,
      daily_usage: estimatedDaily,
      side_effects: form.side_effects || '详见说明书',
      image_url: form.image_url ?? editing?.image_url,
      form_type: form.form_type as FormType,
    };

    if (editing) {
      await MedicineService.updateMedicine({ ...editing, ...common, id: editing.id, usage_frequency_score: editing.usage_frequency_score });
    } else {
      await MedicineService.addMedicine({ ...common, id: Date.now().toString(), usage_frequency_score: 0 });
    }
    onDone(common.name);
  };

  return (
    <ModalShell
      title={editing ? '编辑药品信息' : '入库新药品'}
      subtitle={editing ? '修改后立即同步到药箱' : '手动录入家庭库存'}
      icon="add"
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* 图片上传 */}
        <div className="flex justify-center">
          <div className="relative w-24 h-24 rounded-2xl bg-m3-surface-container-low border-2 border-dashed border-m3-outline-variant flex flex-col items-center justify-center overflow-hidden hover:border-m3-primary transition-colors group">
            {preview ? (
              <img src={preview} alt="预览" className="w-full h-full object-cover" />
            ) : (
              <>
                <Icon name="add" className="w-6 h-6 text-m3-outline group-hover:text-m3-primary transition-colors" />
                <span className="text-[11px] text-m3-on-surface-variant mt-1 font-medium">上传图片</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="上传药品图片" />
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>药品名称 / 通用名</span>
          <input required type="text" className={inputCls} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：布洛芬缓释胶囊" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>所属健康分类</span>
            <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>剂型</span>
            <select className={inputCls} value={form.form_type} onChange={e => setForm({ ...form, form_type: e.target.value as FormType })}>
              {Object.values(FormType).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="flex flex-col gap-1.5 col-span-2">
            <span className={labelCls}>初始入库数量</span>
            <div className="flex gap-2">
              <input required type="number" min="0" step="any" className={inputCls} value={form.total_quantity ?? ''} onChange={e => setForm({ ...form, total_quantity: parseFloat(e.target.value) || 0 })} placeholder="如：24" />
              <select className={`${inputCls} !w-20 text-center px-2`} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-1.5 col-span-1">
            <span className={labelCls}>预警阈值</span>
            <input required type="number" min="0" step="any" className={inputCls} value={form.threshold ?? ''} onChange={e => setForm({ ...form, threshold: parseFloat(e.target.value) || 0 })} />
          </label>
          <label className="flex flex-col gap-1.5 col-span-1">
            <span className={labelCls}>有效截止日期</span>
            <input required type="date" className={`${inputCls} cursor-pointer`} value={form.expiry_date || ''} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>主治症状</span>
          <input type="text" className={inputCls} value={form.symptoms_treated || ''} onChange={e => setForm({ ...form, symptoms_treated: e.target.value })} placeholder="如：头痛, 发烧, 鼻塞" />
        </label>

        <div className="bg-m3-surface-container-low/70 rounded-2xl p-4">
          <span className={labelCls}>服用方式（自动生成说明）</span>
          <div className="flex items-center gap-2.5">
            <div className="flex-1 flex items-center gap-2 bg-m3-surface-container-lowest rounded-xl px-3 h-11">
              <span className="text-xs text-m3-on-surface-variant whitespace-nowrap">每日</span>
              <input type="number" step="0.5" className="w-full outline-none font-bold text-center bg-transparent text-m3-on-surface" value={dosageFreq} onChange={e => setDosageFreq(e.target.value)} aria-label="每日次数" />
              <span className="text-xs text-m3-on-surface-variant whitespace-nowrap">次</span>
            </div>
            <span className="text-m3-outline-variant">×</span>
            <div className="flex-1 flex items-center gap-2 bg-m3-surface-container-lowest rounded-xl px-3 h-11">
              <span className="text-xs text-m3-on-surface-variant whitespace-nowrap">每次</span>
              <input type="number" step="0.5" className="w-full outline-none font-bold text-center bg-transparent text-m3-on-surface" value={dosageAmount} onChange={e => setDosageAmount(e.target.value)} aria-label="每次用量" />
              <span className="text-xs text-m3-on-surface-variant whitespace-nowrap">{form.unit}</span>
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>家庭存放位置</span>
          <input type="text" className={inputCls} value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="如：客厅医药箱第一层" />
        </label>

        <div className="pt-2 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-low text-sm font-medium transition-colors">取消</button>
          <button type="submit" className="px-6 py-2.5 rounded-full bg-m3-primary hover:bg-m3-primary-container text-m3-on-primary text-sm font-semibold shadow-[0_4px_14px_rgba(15,118,110,0.3)] transition-all active:scale-[0.98]">
            {editing ? '保存修改' : '确认入库'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
