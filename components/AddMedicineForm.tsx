import React, { useState } from 'react';
import { FormType, Medicine } from '../types';
import { MedicineService } from '../services/medicineService';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = [
  '感冒药', '止痛药', '肠胃药', '抗生素', 
  '心脑血管', '抗过敏', '咽喉用药', '外用药', 
  '眼科用药', '保健品', '医疗器械', '其他'
];

const UNITS = [
  '粒', '片', '盒', '袋', '瓶', '支', 'ml', '包', '克'
];

const AddMedicineForm: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [dosageFreq, setDosageFreq] = useState<string>('1');
  const [dosageAmount, setDosageAmount] = useState<string>('1');

  const [formData, setFormData] = useState<Partial<Medicine>>({
    form_type: FormType.TABLET,
    total_quantity: 1,
    unit: '粒',
    category: '感冒药',
    threshold: 5,
    daily_usage: 0,
    usage_frequency_score: 0
  });
  const [previewImage, setPreviewImage] = useState<string>('');

  // 图片最大 2MB：base64 直接存 localStorage / 数据库，过大易撑爆存储配额
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert('图片太大，请选择 2MB 以内的图片');
      e.target.value = ''; // 允许用户重新选择同一文件
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPreviewImage(result);
      setFormData(prev => ({ ...prev, image_url: result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalDosage = formData.dosage_instruction || '';
    if (dosageFreq && dosageAmount) {
      finalDosage = `每日${dosageFreq}次，每次${dosageAmount}${formData.unit}`;
    }

    let estimatedDaily = Number(formData.daily_usage);
    if (!estimatedDaily && dosageFreq && dosageAmount) {
      estimatedDaily = parseFloat(dosageFreq) * parseFloat(dosageAmount);
    }

    const newMed: Medicine = {
      id: Date.now().toString(),
      name: formData.name || '未命名',
      category: formData.category || '其他',
      location: formData.location || '未知',
      // parseInt 对空串会返回 NaN，用 || 0 兜底，避免 NaN 入库
      total_quantity: Number(formData.total_quantity) || 0,
      unit: formData.unit || '粒',
      threshold: Number(formData.threshold) || 0,
      expiry_date: formData.expiry_date || new Date().toISOString().split('T')[0],
      last_purchase_date: formData.last_purchase_date || new Date().toISOString().split('T')[0],
      symptoms_treated: formData.symptoms_treated || '',
      dosage_instruction: finalDosage,
      daily_usage: estimatedDaily,
      side_effects: formData.side_effects || '详见说明书',
      image_url: formData.image_url,
      form_type: formData.form_type as FormType,
      usage_frequency_score: 0
    };

    await MedicineService.addMedicine(newMed);
    onSuccess();
  };

  const inputClass = "w-full border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-slate-800 placeholder-slate-400 h-12";
  const labelClass = "block text-xs font-bold text-slate-500 mb-1.5 uppercase";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-4 border-b border-slate-100 sticky top-0 bg-white z-10 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800">添加新药品</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="flex justify-center">
            <div className="relative w-32 h-32 bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center overflow-hidden hover:border-emerald-400 hover:bg-emerald-50 transition-colors group">
              {previewImage ? (
                <img src={previewImage} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <>
                  <span className="text-3xl text-slate-300 group-hover:text-emerald-400 transition-colors">+</span>
                  <span className="text-xs text-slate-400 mt-2 font-medium">上传图片</span>
                </>
              )}
              <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>药名</label>
              <input required type="text" className={inputClass}
                value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="如: 阿莫西林" />
            </div>
            <div>
              <label className={labelClass}>分类</label>
              <select 
                className={inputClass}
                value={formData.category} 
                onChange={e => setFormData({...formData, category: e.target.value})}
              >
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
             <div>
              <label className={labelClass}>库存数量 (最小单位)</label>
              <div className="flex gap-2">
                <input required type="number" className={inputClass}
                  placeholder="如: 24"
                  value={formData.total_quantity} onChange={e => setFormData({...formData, total_quantity: parseInt(e.target.value) || 0})} />
                
                <select 
                  className="w-24 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-center h-12"
                  value={formData.unit} 
                  onChange={e => setFormData({...formData, unit: e.target.value})}
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>低库存预警值</label>
              <input required type="number" className={inputClass}
                value={formData.threshold} onChange={e => setFormData({...formData, threshold: parseInt(e.target.value) || 0})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>过期日期</label>
              <input 
                required 
                type="date" 
                className={`${inputClass} cursor-pointer`}
                value={formData.expiry_date} 
                onChange={e => setFormData({...formData, expiry_date: e.target.value})} 
              />
            </div>
             <div>
              <label className={labelClass}>剂型</label>
              <select className={inputClass}
                value={formData.form_type} onChange={e => setFormData({...formData, form_type: e.target.value as FormType})}>
                {Object.values(FormType).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
             <label className={labelClass}>主治症状</label>
             <input type="text" className={inputClass}
                value={formData.symptoms_treated || ''} onChange={e => setFormData({...formData, symptoms_treated: e.target.value})} placeholder="如: 头痛, 发烧" />
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
             <label className={`${labelClass} mb-3`}>服用方式 (自动生成说明)</label>
             <div className="flex items-center gap-3">
               <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 h-12">
                 <span className="text-slate-400 text-sm whitespace-nowrap">每日</span>
                 <input 
                   type="number" step="0.5" 
                   className="w-full outline-none font-bold text-center bg-white" 
                   value={dosageFreq}
                   onChange={e => setDosageFreq(e.target.value)}
                  />
                 <span className="text-slate-400 text-sm whitespace-nowrap">次</span>
               </div>
               <span className="text-slate-300">×</span>
               <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 h-12">
                 <span className="text-slate-400 text-sm whitespace-nowrap">每次</span>
                 <input 
                   type="number" step="0.5" 
                   className="w-full outline-none font-bold text-center bg-white"
                   value={dosageAmount}
                   onChange={e => setDosageAmount(e.target.value)}
                  />
                 <span className="text-slate-400 text-sm whitespace-nowrap">{formData.unit}</span>
               </div>
             </div>
          </div>

          <div>
             <label className={labelClass}>存放位置</label>
             <input type="text" className={inputClass}
                value={formData.location || ''} onChange={e => setFormData({...formData, location: e.target.value})} placeholder="如: 客厅第一层" />
          </div>

          <div className="pt-4">
            <button type="submit" className="w-full bg-emerald-600 text-white font-bold text-lg py-3.5 rounded-xl shadow-lg shadow-emerald-200 active:scale-[0.98] transition-transform hover:bg-emerald-700">
              确认入库
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddMedicineForm;