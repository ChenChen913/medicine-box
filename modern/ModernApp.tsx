/**
 * 文件名: modern/ModernApp.tsx
 * 功能: 新版 UI 入口（占位版本）
 * 描述: 双 UI 架构基线占位组件，完整实现将在下一个提交中替换。
 *       已接入真实数据加载，保证占位阶段功能不退化。
 */

import React, { useEffect, useState } from 'react';
import { Medicine } from '../types';
import { MedicineService, todayDateString } from '../services/medicineService';
import { useUIMode } from '../ui/UIMode';

const ModernApp: React.FC = () => {
  const { setMode } = useUIMode();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    MedicineService.getMedicines()
      .then((meds: Medicine[]) => setCount(meds.length))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-800">
      <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center text-white text-2xl mb-4">💊</div>
      <h1 className="text-xl font-bold">新版界面正在施工中</h1>
      <p className="text-sm text-slate-500 mt-2 text-center max-w-sm leading-relaxed">
        {error
          ? '数据加载失败，请稍后重试。'
          : count !== null
            ? `数据层已就绪：药箱共 ${count} 种药品（${todayDateString()}）`
            : '正在连接数据层...'}
      </p>
      <button
        type="button"
        onClick={() => setMode('classic')}
        className="mt-6 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors"
      >
        切回经典版界面
      </button>
    </div>
  );
};

export default ModernApp;
