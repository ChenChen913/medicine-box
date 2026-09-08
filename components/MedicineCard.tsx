/**
 * 文件名: MedicineCard.tsx
 * 功能: 药品单体展示卡片
 * 描述: 展示药品图标、库存、状态（过期/缺货）及快捷操作按钮。
 */

import React from 'react';
import { FormType, Medicine } from '../types';
import { todayDateString } from '../services/medicineService';

interface Props {
  medicine: Medicine;
  onConsume: (id: string) => void;
  onDetail: (med: Medicine) => void;
}

const MedicineCard: React.FC<Props> = ({ medicine, onConsume, onDetail }) => {
  // 用本地日期字符串比较，避免 new Date('YYYY-MM-DD') 按 UTC 解析造成的时区误差
  const isExpired = !!medicine.expiry_date && medicine.expiry_date < todayDateString();
  const isLowStock = medicine.total_quantity <= medicine.threshold;
  const isOut = medicine.total_quantity === 0;

  // 计算还能吃几天
  let supplyDuration = '';
  if (medicine.total_quantity > 0 && medicine.daily_usage > 0) {
    const days = Math.floor(medicine.total_quantity / medicine.daily_usage);
    if (days < 1) {
      supplyDuration = '不足1天量';
    } else {
      supplyDuration = `约可用 ${days} 天`;
    }
  }

  // 底部状态圆点颜色（优先级：过期 > 用尽 > 正常）
  const getStatusDotColor = () => {
    if (isExpired) return 'bg-red-400';
    if (isOut) return 'bg-gray-400';
    return 'bg-emerald-400';
  };

  // 按钮文案适配
  const consumeLabel = [FormType.TOPICAL, FormType.SPRAY, FormType.OTHER, FormType.LIQUID].includes(medicine.form_type)
    ? '使用' 
    : '吃药';

  // 获取药品图标 (优化：更丰富的图标库，避免重复)
  const getIcon = (med: Medicine) => {
    const c = (med.category || '').toLowerCase();
    const n = (med.name || '').toLowerCase();

    // 特殊指定
    if (n.includes('碘伏') || n.includes('消毒')) return '🧪';
    if (n.includes('创可贴')) return '🩹';
    if (n.includes('风油精')) return '🧴';
    if (n.includes('眼药水') || n.includes('泪液')) return '💧';

    // 类别判断
    if (c.includes('感冒') || c.includes('流感')) return '🤧';
    if (c.includes('止痛') || c.includes('退烧') || c.includes('发热')) return '🤕';
    if (c.includes('肠胃') || c.includes('消化')) return '🥣';
    if (c.includes('抗生素') || c.includes('消炎')) return '💊';
    if (c.includes('保健品') || c.includes('维生素') || c.includes('钙')) return '🥦';
    if (c.includes('外用')) return '🧴';
    if (c.includes('眼')) return '👁️';
    if (c.includes('心脑') || c.includes('血')) return '🫀';
    if (c.includes('咽') || c.includes('喉')) return '🗣️';
    if (c.includes('过敏') || c.includes('抗过敏')) return '🛡️';
    if (c.includes('睡眠') || c.includes('褪黑素')) return '🌙';
    if (c.includes('医疗器械')) return '🩺';
    
    // 剂型保底
    if (med.form_type === FormType.SPRAY) return '💨';
    if (med.form_type === FormType.LIQUID) return '🧪';
    if (med.form_type === FormType.GRANULE) return '🍵';
    
    return '💊';
  };

  // 动态卡片样式
  let cardStyleClass = "bg-white border-slate-100 hover:shadow-lg";
  let contentOpacity = "opacity-100";
  let iconBg = "bg-slate-50 border-slate-100 text-slate-800";

  if (isExpired) {
    // 过期样式：浅红背景
    cardStyleClass = "bg-red-50 border-red-200 shadow-none";
    iconBg = "bg-red-100 border-red-200 text-red-400";
  } else if (isOut) {
    // 用尽样式：浅灰背景，透明度降低
    cardStyleClass = "bg-slate-100 border-slate-200 shadow-none";
    contentOpacity = "opacity-60 grayscale";
    iconBg = "bg-slate-200 border-slate-300 text-slate-400";
  }

  return (
    <div className={`rounded-2xl shadow-sm border overflow-hidden flex flex-col h-full relative group transition-all duration-200 ${cardStyleClass}`}>
      {/* 状态徽标 */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        {isExpired && (
          <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
            已过期
          </span>
        )}
        {!isExpired && isOut && (
          <span className="bg-gray-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
            已用尽
          </span>
        )}
        {!isExpired && !isOut && isLowStock && (
          <span className="bg-orange-400 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
            库存低
          </span>
        )}
      </div>

      <div className={`flex p-5 gap-5 flex-1 cursor-pointer ${contentOpacity}`} onClick={() => onDetail(medicine)}>
        {/* 图标区域：不设固定高度，随右侧内容自动拉伸撑满整列，消除下方空白 */}
        <div className={`w-24 self-stretch min-h-24 flex-shrink-0 rounded-2xl flex items-center justify-center text-6xl shadow-inner border ${iconBg}`}>
           {getIcon(medicine)}
        </div>

        {/* 内容区域 */}
        <div className="flex flex-col flex-1 justify-between py-0.5">
          <div>
            <div className="flex justify-between items-start">
              <h3 className="font-bold text-slate-800 text-xl leading-tight line-clamp-2 mb-1.5">{medicine.name}</h3>
            </div>
            <p className="text-sm text-slate-500 font-medium mb-2">{medicine.form_type} · {medicine.location}</p>
            
            <div className="text-xs text-slate-600 bg-white/50 p-2 rounded-lg line-clamp-2 leading-relaxed border border-slate-100/50">
              <span className="font-bold text-slate-700">主治: </span>{medicine.symptoms_treated}
            </div>
          </div>
          
          <div className="mt-4 flex items-end justify-between">
             <div className="flex flex-col">
                <div className="text-sm text-slate-400 mb-0.5">剩余库存</div>
                <div className="flex items-baseline gap-1">
                  <span className={`font-bold text-2xl ${isLowStock || isOut ? 'text-red-500' : 'text-emerald-600'}`}>
                    {medicine.total_quantity}
                  </span>
                  <span className="text-slate-500 text-sm font-medium">{medicine.unit}</span>
                </div>
                {/* 还能吃几天提示 */}
                {supplyDuration && !isExpired && !isOut && (
                  <span className="text-xs text-blue-500 font-medium mt-1 bg-blue-50 px-2 py-0.5 rounded-md w-fit">
                    {supplyDuration}
                  </span>
                )}
             </div>
             
             {/* 手机端更友好的大按钮 */}
             <button 
               onClick={(e) => {
                 e.stopPropagation();
                 if (!isOut && !isExpired) onConsume(medicine.id);
               }}
               disabled={isOut || isExpired}
               className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm ${
                 isOut || isExpired
                   ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                   : 'bg-emerald-50 text-emerald-600 active:bg-emerald-100 hover:bg-emerald-100 border border-emerald-200 hover:shadow-md active:scale-95'
               }`}
             >
               {consumeLabel}
             </button>
          </div>
        </div>
      </div>
      
      {/* 底部详情条 */}
      <div className={`px-4 py-2.5 border-t border-slate-100 text-sm text-slate-500 truncate flex items-center gap-2 ${isExpired || isOut ? 'bg-transparent' : 'bg-slate-50'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotColor()}`}></span>
        用法: {medicine.dosage_instruction}
      </div>
    </div>
  );
};

export default MedicineCard;