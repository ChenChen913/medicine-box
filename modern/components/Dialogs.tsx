/**
 * 文件名: modern/components/Dialogs.tsx
 * 功能: 新版 UI 的弹窗集合
 * 描述: Material 3 风格的四个业务弹窗，逻辑与经典版完全一致（同一服务层）：
 *       - ConsumeDialog  服药确认（数量可调，上限 = 当前库存）
 *       - DeleteDialog   删除确认
 *       - RestockDialog  补货登记（新数量 + 新效期 → restockMedicine）
 *       - MedicineForm   入库 / 编辑表单（覆盖全部真实字段，含本地图片上传）
 *       响应式形态：桌面端居中卡片；手机端底部抽屉（贴底全宽、只圆上角、
 *       高度收敛到 76vh 保证顶部留白可点击关闭，含拖拽指示条与底部安全区）
 */

import React, { useState } from 'react';
import { FormType, Medicine } from '../../types';
import {
  MedicineService, todayDateString, localDateString,
  FORM_UNIT_MAP, isRestockMatch,
} from '../../services/medicineService';
import { Icon, IconName } from '../icons';
import { getCategoryMeta } from '../ui';
import { M3Select, SelectOption } from './Select';

// ---------- 通用弹窗外壳 ----------

export const ModalShell: React.FC<{ title: string; subtitle?: string; icon?: IconName; onClose: () => void; children: React.ReactNode; wide?: boolean }> =
({ title, subtitle, icon = 'info', onClose, children, wide }) => (
  // 手机端 items-end 贴底呈抽屉形态，桌面端保持居中卡片
  <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center md:p-4">
    <div className="fixed inset-0 bg-m3-on-surface/40 backdrop-blur-[2px] animate-in fade-in duration-200" onClick={onClose} />
    <div
      className={`relative bg-m3-surface-container-lowest w-full ${wide ? 'md:max-w-xl' : 'md:max-w-md'} max-h-[76vh] md:max-h-[90vh] overflow-y-auto shadow-2xl rounded-t-3xl md:rounded-3xl animate-in fade-in slide-in-from-bottom-8 md:slide-in-from-bottom-0 md:zoom-in-95 duration-200`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 粘性头部（含手机端拖拽指示条）：长表单滚动时关闭按钮始终可见可点 */}
      <div className="sticky top-0 z-10 bg-m3-surface-container-lowest border-b border-m3-surface-container-low">
        <div className="md:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-m3-outline-variant/60" />
        </div>
        <div className="p-5 md:p-6 pb-3 flex items-center justify-between">
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
      </div>
      <div className="px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-6 md:pt-6 md:pb-6">{children}</div>
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

/** 剂型 → 图标与配色（与首页分类卡片同一套 M3 token；Task 9 语义化重选） */
const FORM_TYPE_META: Record<string, { icon: IconName; wrap: string }> = {
  '片剂': { icon: 'blister', wrap: 'bg-m3-primary/10 text-m3-primary' },
  '胶囊': { icon: 'capsule', wrap: 'bg-m3-secondary-fixed/40 text-m3-secondary' },
  '颗粒': { icon: 'sachet', wrap: 'bg-m3-tertiary-fixed text-m3-tertiary-container' },
  '口服液': { icon: 'syrup', wrap: 'bg-m3-primary-fixed/40 text-m3-primary' },
  '外用': { icon: 'healing', wrap: 'bg-m3-error-container text-m3-error' },
  '喷雾': { icon: 'spraying', wrap: 'bg-m3-surface-container-high text-m3-primary' },
  '其他': { icon: 'more_horiz', wrap: 'bg-m3-surface-container-high text-m3-on-surface-variant' },
};

/** 健康分类下拉项：带分类专属渐变图标；兼容库里不在预设清单中的自定义分类 */
function buildCategoryOptions(value: string): SelectOption[] {
  const opts: SelectOption[] = CATEGORIES.map(c => {
    const meta = getCategoryMeta(c);
    return { value: c, label: c, icon: meta.icon, iconWrap: `bg-gradient-to-br ${meta.iconBg} ${meta.iconColor}` };
  });
  if (!CATEGORIES.includes(value)) {
    const meta = getCategoryMeta(value);
    opts.push({ value, label: value, icon: meta.icon, iconWrap: `bg-gradient-to-br ${meta.iconBg} ${meta.iconColor}` });
  }
  return opts;
}

/** 剂型下拉项：同样兼容预设外的历史数据 */
function buildFormTypeOptions(value: string): SelectOption[] {
  const vals = Object.values(FormType) as string[];
  const opts: SelectOption[] = vals.map(t => ({
    value: t, label: t,
    icon: FORM_TYPE_META[t]?.icon ?? 'medication',
    iconWrap: FORM_TYPE_META[t]?.wrap ?? 'bg-m3-surface-container-high text-m3-on-surface-variant',
  }));
  if (!vals.includes(value)) {
    opts.push({ value, label: value, icon: 'more_horiz', iconWrap: 'bg-m3-surface-container-high text-m3-on-surface-variant' });
  }
  return opts;
}

interface FormProps {
  editing?: Medicine;
  /** 药箱现有药品（新增模式用于同名检测提示） */
  allMedicines?: Medicine[];
  /** 当前待补货清单里的药品名（新增模式用于“入库自动核销”预提示） */
  pendingRestockNames?: string[];
  onClose: () => void;
  /** message：服务层返回的入库/更新结果汇总（合并/核销等），由外层直接 toast */
  onDone: (name: string, message?: string) => void;
}

/** 从 "每日X次，每次Y单位" 解析频次（与经典版同一正则） */
function parseDosage(instruction: string): { freq: string; amount: string } {
  const m = /每日(\d+(\.\d+)?)次，每次(\d+(\.\d+)?)/.exec(instruction || '');
  return m ? { freq: m[1], amount: m[3] } : { freq: '', amount: '' };
}

export const MedicineForm: React.FC<FormProps> = ({ editing, allMedicines, pendingRestockNames, onClose, onDone }) => {
  const initDosage = editing ? parseDosage(editing.dosage_instruction) : { freq: '1', amount: '1' };
  const [dosageFreq, setDosageFreq] = useState(initDosage.freq);
  const [dosageAmount, setDosageAmount] = useState(initDosage.amount);
  const [form, setForm] = useState<Partial<Medicine>>(
    editing ? { ...editing } : {
      form_type: FormType.TABLET, total_quantity: 1, unit: FORM_UNIT_MAP[FormType.TABLET],
      category: '感冒药', threshold: 5, daily_usage: 0, usage_frequency_score: 0,
    }
  );
  // 图片状态：form.image_url 持有当前图（含历史 data:URL）；imageRemoved 标记用户
  // 已明确选择「不上传图片，使用分类默认图」，提交时必须清掉旧图而不是保留
  const [imageRemoved, setImageRemoved] = useState(false);

  const categoryMeta = getCategoryMeta(form.category || '其他');

  // 新增模式：输入名称与药箱已有药品同名时的实时提示（合并入库 / 独立录入口径与提交后一致）
  const trimmedName = (form.name || '').trim();
  const existingMatch = !editing && trimmedName
    ? allMedicines?.find(m => (m.name || '').trim() === trimmedName)
    : undefined;
  const sameFormMatch = existingMatch && existingMatch.form_type === form.form_type;
  // 新增模式：待补货清单中是否有能被本次入库自动核销的提醒（与提交时服务层同一套匹配规则）
  const matchedRestocks = !editing && trimmedName && pendingRestockNames && pendingRestockNames.length > 0
    ? pendingRestockNames.filter(n => isRestockMatch(n, { name: trimmedName, form_type: form.form_type as FormType }, allMedicines ?? []))
    : [];

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
      setImageRemoved(false);
      setForm(prev => ({ ...prev, image_url: result }));
    };
    reader.readAsDataURL(file);
  };

  /** 移除图片 → 不再保留任何实物图，入库/展示时回退到分类默认图片标识 */
  const clearImage = () => {
    setImageRemoved(true);
    setForm(prev => ({ ...prev, image_url: undefined }));
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
      // 用户明确移除图片（imageRemoved）时必须真正清掉旧图而不是回退保留历史值
      image_url: imageRemoved ? undefined : (form.image_url ?? editing?.image_url),
      form_type: form.form_type as FormType,
    };

    if (editing) {
      const { offsetRestocks } = await MedicineService.updateMedicine(
        { ...editing, ...common, id: editing.id, usage_frequency_score: editing.usage_frequency_score },
        { previous: editing }
      );
      // 数量比编辑前增加 = 用户手动补了货（未触发任何警告的场景）：提示库存变化与核销结果
      const increased = common.total_quantity > editing.total_quantity;
      const parts: string[] = [`「${common.name}」的信息已更新`];
      if (increased) parts.push(`检测到手动补货：库存 ${editing.total_quantity} → ${common.total_quantity} ${common.unit}，最近购入已记为今天`);
      if (offsetRestocks.length > 0) parts.push(`已核销待补货提醒：${offsetRestocks.join('、')}`);
      onDone(common.name, parts.join('；'));
    } else {
      const { merged, offsetRestocks } = await MedicineService.addMedicine({ ...common, id: Date.now().toString(), usage_frequency_score: 0 });
      const parts: string[] = merged
        ? [`「${common.name}」已在药箱中（同名同剂型），已合并入库：库存与效期以本次填写为准`]
        : [`新药品「${common.name}」已入库，药箱概览已更新`];
      if (offsetRestocks.length > 0) parts.push(`已自动核销待补货提醒：${offsetRestocks.join('、')}`);
      onDone(common.name, parts.join('；'));
    }
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
        {/* 图片（可选）：不上传时使用分类默认图片标识；预览区实时展示最终效果（含分类切换联动） */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative w-24 h-24 rounded-2xl bg-m3-surface-container-low border-2 border-dashed border-m3-outline-variant flex flex-col items-center justify-center overflow-hidden hover:border-m3-primary transition-colors group">
            {(() => {
              const shown = imageRemoved ? undefined : form.image_url;
              const dataImg = shown && shown.startsWith('data:') ? shown : '';
              if (dataImg) {
                return (
                  <>
                    <img src={dataImg} alt="预览" className="w-full h-full object-cover" />
                    <input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="更换药品图片" />
                  </>
                );
              }
              return (
                <>
                  {/* 分类默认图预览：随「所属健康分类」下拉实时切换 */}
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${categoryMeta.iconBg} flex items-center justify-center ${categoryMeta.iconColor}`}>
                    <Icon name={categoryMeta.icon} className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] text-m3-on-surface-variant mt-1.5 font-medium">默认分类图片</span>
                  <input type="file" accept="image/*" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="上传药品图片（可选）" />
                </>
              );
            })()}
          </div>
          {(() => {
            const shown = imageRemoved ? undefined : form.image_url;
            return shown ? (
              <button type="button" onClick={clearImage} className="text-[11px] font-medium text-m3-on-surface-variant hover:text-m3-error transition-colors">
                移除图片，使用默认分类图
              </button>
            ) : (
              <span className="text-[10px] text-m3-outline">可选；不上传将使用分类默认图片</span>
            );
          })()}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>药品名称 / 通用名</span>
          <input required type="text" className={inputCls} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：布洛芬缓释胶囊" />
        </label>

        {/* 同名 / 待补货匹配实时提示：口径与服务层提交后的实际行为完全一致 */}
        {existingMatch && sameFormMatch && (
          <div className="rounded-xl p-3 bg-m3-primary/10 text-m3-on-surface text-[12px] leading-relaxed flex items-start gap-2" role="status">
            <Icon name="sync" className="w-4 h-4 text-m3-primary shrink-0 mt-0.5" />
            <span>
              药箱中已有 <b className="font-semibold">{existingMatch.name}</b>（{existingMatch.form_type} · 剩余 {existingMatch.total_quantity}{existingMatch.unit}{existingMatch.location ? ` · ${existingMatch.location}` : ''}）。
              确认入库后将与它合并：<b className="font-semibold">库存、效期等信息以本次填写为准</b>，其待补货提醒也会自动核销。
            </span>
          </div>
        )}
        {existingMatch && !sameFormMatch && (
          <div className="rounded-xl p-3 bg-m3-tertiary-fixed/60 text-m3-on-surface text-[12px] leading-relaxed flex items-start gap-2" role="status">
            <Icon name="info" className="w-4 h-4 text-m3-tertiary-container shrink-0 mt-0.5" />
            <span>
              药箱中已有同名药品「{existingMatch.name}」，但剂型不同（已有：{existingMatch.form_type}），将作为<b className="font-semibold">独立新条目</b>录入；若想为它补货，建议在详情中直接编辑该药品增加库存。
            </span>
          </div>
        )}
        {!existingMatch && matchedRestocks.length > 0 && (
          <div className="rounded-xl p-3 bg-m3-primary/10 text-m3-on-surface text-[12px] leading-relaxed flex items-start gap-2" role="status">
            <Icon name="shopping_bag" className="w-4 h-4 text-m3-primary shrink-0 mt-0.5" />
            <span>
              待补货清单中有匹配的提醒（{matchedRestocks.join('、')}），本次入库后会<b className="font-semibold">自动核销</b>，无需再走「已买入」登记。
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>所属健康分类</span>
            <M3Select
              variant="field"
              ariaLabel="所属健康分类"
              value={form.category || '其他'}
              options={buildCategoryOptions(form.category || '其他')}
              onChange={v => setForm({ ...form, category: v })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>剂型</span>
            <M3Select
              variant="field"
              ariaLabel="剂型"
              value={form.form_type || FormType.TABLET}
              options={buildFormTypeOptions(form.form_type || FormType.TABLET)}
              onChange={v => setForm(prev => ({
                ...prev,
                form_type: v as FormType,
                // 剂型 → 单位联动：片剂→片、胶囊→粒、颗粒→袋…；切换后仍可手动改单位
                unit: FORM_UNIT_MAP[v] || prev.unit,
              }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="flex flex-col gap-1.5 col-span-2">
            <span className={labelCls}>初始入库数量</span>
            <div className="flex gap-2">
              <input required type="number" min="0" step="any" className={inputCls} value={form.total_quantity ?? ''} onChange={e => setForm({ ...form, total_quantity: parseFloat(e.target.value) || 0 })} placeholder="如：24" />
              <M3Select
                variant="compact"
                ariaLabel="数量单位"
                className="w-20 shrink-0"
                value={form.unit || '粒'}
                options={(UNITS.includes(form.unit || '粒') ? UNITS : [form.unit || '粒', ...UNITS]).map(u => ({ value: u, label: u }))}
                onChange={v => setForm({ ...form, unit: v })}
              />
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
