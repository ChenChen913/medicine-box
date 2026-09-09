/**
 * 文件名: ui/classic/ClassicApp.tsx
 * 功能: 经典版 UI 主入口（原 App.tsx 原样保留）
 * 描述: 双 UI 架构下的经典版视图层，逻辑与视觉不做任何变更；
 *       仅新增右上角以外的浮动切换入口，便于随时切到新版界面。
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Medicine } from '../../types';
import { MedicineService, todayDateString, getCategoryWeight } from '../../services/medicineService';
import MedicineCard from './components/MedicineCard';
import ShoppingList from './components/ShoppingList';
import AddMedicineForm from './components/AddMedicineForm';
import { DataBackupDialog } from '../../modern/components/DataBackup';
import UISwitcher from '../UISwitcher';

// --- 图标组件 ---
const IconHome = () => <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>;
const IconCart = () => <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
const IconAdd = () => <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const IconSearch = () => <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'cart'>('home');
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'low' | 'out' | 'expired'>('all');
  const [searchQuery, setSearchQuery] = useState(''); // 搜索关键词状态

  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [consumeMedId, setConsumeMedId] = useState<string | null>(null);
  const [consumeAmount, setConsumeAmount] = useState<number>(1);
  const [showAddForm, setShowAddForm] = useState(false);
  // 编辑模式：记录正在编辑的药品；null 表示表单为新建模式
  const [editingMed, setEditingMed] = useState<Medicine | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // 详情弹窗图片加载失败标记（外链图片在部分手机网络下不可达，失败时降级为 emoji 占位）
  const [detailImageFailed, setDetailImageFailed] = useState(false);
  // 数据加载失败（区别于「空药箱」）：加载失败时显示错误横幅，避免用户误以为药箱是空的
  const [loadError, setLoadError] = useState<string | null>(null);
  // 存储写入失败提示（localStorage 配额不足 / 云端写入失败），由服务层广播事件触发
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  // 数据备份与恢复弹窗（与新版 UI 同一组件）
  const [backupOpen, setBackupOpen] = useState(false);

  // 异步加载数据
  const refreshData = async () => {
    try {
      let meds = await MedicineService.getMedicines();
      meds = MedicineService.sortMedicines(meds);
      setMedicines(meds);
      setLoadError(null);
    } catch (e) {
      console.error('[App] 数据加载失败：', e);
      // 透出服务层原始原因（存储损坏 / 云端不可达等），而不是笼统的网络提示
      setLoadError(e instanceof Error && e.message
        ? `${e.message} 请重试；若反复出现，可通过「数据备份与恢复」导出排查。`
        : '无法连接数据源。为防止用空数据覆盖云端，已暂停本次加载，请检查网络后重试。');
    }
  };

  // 监听服务层广播的存储错误（localStorage 配额不足 / 云端写入失败等）
  useEffect(() => {
    const onStorageError = (e: Event) => {
      setStorageWarning((e as CustomEvent<string>).detail);
    };
    window.addEventListener('mb:storage-error', onStorageError);
    return () => window.removeEventListener('mb:storage-error', onStorageError);
  }, []);

  // 存储提示 6 秒后自动消失
  useEffect(() => {
    if (!storageWarning) return;
    const t = setTimeout(() => setStorageWarning(null), 6000);
    return () => clearTimeout(t);
  }, [storageWarning]);

  // 桌面端 ESC 关闭弹窗（按层级：删除确认 > 服用确认 > 详情）。
  // 编辑表单不响应 ESC，避免误触导致已输入内容丢失。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteConfirmId) { setDeleteConfirmId(null); return; }
      if (consumeMedId) { setConsumeMedId(null); return; }
      if (selectedMed) setSelectedMed(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteConfirmId, consumeMedId, selectedMed]);

  useEffect(() => {
    refreshData();
  }, [activeTab]);

  const handleConsume = async () => {
    if (consumeMedId) {
      try {
        await MedicineService.consumeMedicine(consumeMedId, consumeAmount);
      } catch (e) {
        setStorageWarning(e instanceof Error ? e.message : '操作失败，请重试');
      }
      setConsumeMedId(null);
      setConsumeAmount(1);
      refreshData();
    }
  };

  // 服用确认弹窗的目标药品（统一 String 比较，兼容旧数据的 id 类型差异）
  const consumeTarget = consumeMedId
    ? medicines.find(m => String(m.id) === String(consumeMedId))
    : null;

  const onRequestDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;

    // 乐观更新 UI
    setMedicines(prevMeds => prevMeds.filter(m => String(m.id) !== String(deleteConfirmId)));
    setSelectedMed(null); // 关闭详情页

    // 后台删除（失败时提示并刷新回真实数据）
    try {
      await MedicineService.deleteMedicine(deleteConfirmId);
    } catch (e) {
      setStorageWarning(e instanceof Error ? e.message : '删除失败，请重试');
    }
    setDeleteConfirmId(null);
    refreshData();
  };

  // --- 过滤与搜索逻辑 ---
  const filteredMedicines = useMemo(() => {
    let result = medicines;

    // 1. 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(m => 
        m.name.toLowerCase().includes(q) || 
        m.symptoms_treated.toLowerCase().includes(q)
      );
    }

    // 2. 状态过滤（用本地日期字符串比较，避免 UTC 解析导致的时区误差）
    const today = todayDateString();
    switch (filterType) {
      case 'low':
        return result.filter(m => m.total_quantity <= m.threshold && m.total_quantity > 0 && m.expiry_date >= today);
      case 'out':
        return result.filter(m => m.total_quantity === 0 && m.expiry_date >= today);
      case 'expired':
        return result.filter(m => !!m.expiry_date && m.expiry_date < today);
      default:
        return result;
    }
  }, [medicines, filterType, searchQuery]);

  // --- 分组逻辑 ---
  const groupedMedicines = useMemo(() => {
    const groups: { [key: string]: Medicine[] } = {};
    filteredMedicines.forEach(med => {
      const cat = med.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(med);
    });
    return groups;
  }, [filteredMedicines]);
  
  const sortedGroupKeys = useMemo(() => {
    // 分类权重直接复用 service 层的共享实现，避免两处逻辑漂移
    return Object.keys(groupedMedicines).sort((a, b) => getCategoryWeight(b) - getCategoryWeight(a));
  }, [groupedMedicines]);


  const stats = useMemo(() => {
    const today = todayDateString();
    return {
      total: medicines.length,
      // 口径与下方过滤逻辑保持一致：库存告急/已用尽均排除过期药品，
      // 否则徽标数量与点击卡片后的实际列表对不上
      low: medicines.filter(m => m.total_quantity <= m.threshold && m.total_quantity > 0 && m.expiry_date >= today).length,
      out: medicines.filter(m => m.total_quantity === 0 && m.expiry_date >= today).length,
      expired: medicines.filter(m => !!m.expiry_date && m.expiry_date < today).length
    };
  }, [medicines]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden font-sans text-slate-800 bg-slate-50">
      <UISwitcher bottomClass="bottom-24 md:bottom-6" />
      
      {/* --- 顶部导航栏 --- */}
      <header className="bg-white shadow-sm sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-4 md:py-5 flex justify-between items-center">
          <div className="flex items-center gap-3 md:gap-4 cursor-pointer" onClick={() => { setFilterType('all'); setSearchQuery(''); setActiveTab('home'); }}>
             {/* 品牌图标：与 favicon / 新版 UI 顶栏同源，替换原 emoji 占位 */}
             <img
               src={`${import.meta.env.BASE_URL}favicon.svg`}
               alt="家庭药箱"
               className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl shadow-lg"
             />
             <div>
               <h1 className="font-bold text-xl md:text-2xl text-slate-800 leading-none tracking-tight">家庭药箱</h1>
               <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">家庭健康管家</p>
             </div>
          </div>
          
          <div className="hidden md:flex gap-6">
             <button onClick={() => setActiveTab('home')} className={`px-6 py-2.5 rounded-xl font-bold transition-colors ${activeTab === 'home' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>我的药箱</button>
             <button onClick={() => setActiveTab('cart')} className={`px-6 py-2.5 rounded-xl font-bold transition-colors ${activeTab === 'cart' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>需补货</button>
          </div>
          
          <div className="flex items-center gap-2">
            {/* 数据备份与恢复：与新版 UI 同一功能（header 桌面端常显，移动端在 header 右侧） */}
            <button 
              onClick={() => setBackupOpen(true)}
              aria-label="数据备份与恢复"
              title="数据备份与恢复"
              className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 7h14M5 7a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2m-7 3l3 3m0 0l-3 3m3-3H9" /></svg>
            </button>
            <button 
              onClick={() => { setEditingMed(null); setShowAddForm(true); }}
              className="hidden md:flex bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors items-center gap-2 shadow-md">
              <span>+ 入库新药</span>
            </button>
          </div>
        </div>
      </header>

      {/* --- 主要内容区域 --- */}
      {/* 内容区：flex-1 + min-h-0 让它占满 header/nav 之间的剩余高度，滚动只发生在这里 */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        
        {activeTab === 'home' && (
          <div className="p-4 md:pb-10 max-w-6xl mx-auto">

            {/* 数据加载失败横幅（区别于空药箱状态） */}
            {loadError && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="text-sm text-red-700 leading-relaxed">
                  <span className="font-bold block mb-1">数据加载失败</span>
                  {loadError}
                </div>
                <button
                  onClick={refreshData}
                  className="shrink-0 bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-red-600 transition-colors"
                >重试</button>
              </div>
            )}

            {/* 搜索框 (新增) */}
            <div className="mb-6 relative max-w-xl mx-auto">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                 <IconSearch />
               </div>
               <input 
                 type="text"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="block w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl leading-5 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm shadow-sm transition-all"
                 placeholder="搜索药名、症状（如：头痛、发烧）..."
               />
            </div>

            {/* 统计概览 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
              <div onClick={() => setFilterType('all')} className={`p-4 rounded-2xl border transition-all cursor-pointer ${filterType === 'all' ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' : 'bg-white border-slate-100'}`}>
                <div className="text-slate-500 text-xs md:text-sm font-medium">总库存种类</div>
                <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">{stats.total}</div>
              </div>
              <div onClick={() => setFilterType('low')} className={`p-4 rounded-2xl border transition-all cursor-pointer ${filterType === 'low' ? 'bg-orange-50 border-orange-200 ring-2 ring-orange-100' : 'bg-white border-slate-100'}`}>
                 <div className="text-slate-500 text-xs md:text-sm font-medium">库存告急</div>
                 <div className="text-2xl md:text-3xl font-bold text-orange-500 mt-1">{stats.low}</div>
              </div>
               <div onClick={() => setFilterType('out')} className={`p-4 rounded-2xl border transition-all cursor-pointer ${filterType === 'out' ? 'bg-gray-100 border-gray-300 ring-2 ring-gray-200' : 'bg-white border-slate-100'}`}>
                 <div className="text-slate-500 text-xs md:text-sm font-medium">已用尽</div>
                 <div className="text-2xl md:text-3xl font-bold text-gray-500 mt-1">{stats.out}</div>
              </div>
              <div onClick={() => setFilterType('expired')} className={`p-4 rounded-2xl border transition-all cursor-pointer ${filterType === 'expired' ? 'bg-red-50 border-red-200 ring-2 ring-red-100' : 'bg-white border-slate-100'}`}>
                 <div className="text-slate-500 text-xs md:text-sm font-medium">已过期</div>
                 <div className="text-2xl md:text-3xl font-bold text-red-500 mt-1">{stats.expired}</div>
              </div>
            </div>

            {/* 药品列表 */}
            {sortedGroupKeys.length === 0 ? (
              medicines.length === 0 ? (
                // 投产后空箱引导：与「搜索无结果」区分开；桌面/手机分开指引，各端只展示与自己界面一致的操作入口
                <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-dashed border-slate-200">
                  <div className="text-4xl mb-4">💊</div>
                  <div className="text-slate-600 font-medium">药箱还是空的</div>
                  <div className="hidden md:block text-slate-400 text-sm mt-2">点击右上角「入库新药」按钮，录入您的第一种药品</div>
                  <div className="md:hidden text-slate-400 text-sm mt-2">点击底部中央 + 按钮，录入您的第一种药品</div>
                </div>
              ) : (
                <div className="text-center py-20">
                  <div className="text-4xl mb-4">🔍</div>
                  <div className="text-slate-400 font-medium">没有找到相关药品</div>
                  {searchQuery && <div className="text-slate-300 text-sm mt-2">试试其他关键词？</div>}
                </div>
              )
            ) : (
              sortedGroupKeys.map(category => (
                <div key={category} className="mb-8">
                  <h2 className="text-lg md:text-xl font-bold text-slate-700 mb-4 flex items-center gap-2 pl-1">
                    <span className="w-1.5 h-5 md:h-6 bg-emerald-500 rounded-full block"></span>
                    {category}
                    <span className="text-xs md:text-sm font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full ml-2">{groupedMedicines[category].length}</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {groupedMedicines[category].map(med => (
                      <MedicineCard 
                        key={med.id} 
                        medicine={med} 
                        onConsume={(id) => { setConsumeMedId(id); setConsumeAmount(1); }}
                        onDetail={(med) => { setSelectedMed(med); setDetailImageFailed(false); }}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'cart' && (
          <ShoppingList />
        )}
      </main>

      {/* --- 底部导航栏 (仅移动端显示) --- */}
      {/* 改为 flex 流内布局：不随内容滚动消失（原 fixed 定位在移动端惯性滚动期间会被浏览器丢弃渲染） */}
      <nav className="md:hidden shrink-0 bg-white border-t border-slate-200 flex justify-around items-center h-20 z-30 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => { setActiveTab('home'); setFilterType('all'); }}
          className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'home' ? 'text-emerald-600' : 'text-slate-400'}`}>
          <IconHome />
          <span className="text-xs mt-1.5 font-medium">药箱</span>
        </button>
         <div className="relative -top-6">
           <button 
             onClick={() => { setEditingMed(null); setShowAddForm(true); }}
             className="w-16 h-16 bg-emerald-500 rounded-full text-white flex items-center justify-center shadow-lg shadow-emerald-200 active:scale-95 transition-transform border-4 border-slate-50">
             <IconAdd />
           </button>
         </div>
        <button 
          onClick={() => setActiveTab('cart')}
          className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'cart' ? 'text-emerald-600' : 'text-slate-400'}`}>
          <IconCart />
          <span className="text-xs mt-1.5 font-medium">补货</span>
        </button>
      </nav>


      {/* --- 详情弹窗 --- */}
      {selectedMed && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedMed(null)}>
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-0 relative shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <button className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 text-slate-600 hover:bg-black/20 z-10" aria-label="关闭详情" onClick={() => setSelectedMed(null)}>✕</button>
            
            <div className="relative h-64 bg-slate-100">
               {/* 只渲染本地 base64 图片（用户上传）。旧数据可能残留外链地址，
                   在部分手机网络下不可达，会导致破图或长时间空白，因此一律不请求 */}
               {selectedMed.image_url && selectedMed.image_url.startsWith('data:') && !detailImageFailed ? (
                 <img src={selectedMed.image_url} className="w-full h-full object-cover" alt={selectedMed.name} onError={() => setDetailImageFailed(true)} />
               ) : (
                 /* 无图片或图片加载失败时，用本地渐变占位（与卡片 emoji 风格一致），避免出现破图 */
                 <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-100 via-teal-100 to-cyan-100 text-7xl">
                   💊
                 </div>
               )}
               <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 pt-16">
                 <h2 className="text-2xl font-bold text-white leading-tight">{selectedMed.name}</h2>
                 <p className="text-white/80 text-sm mt-1">{selectedMed.brand ? `${selectedMed.brand} · ` : ''}{selectedMed.form_type} · {selectedMed.category}</p>
               </div>
            </div>

            <div className="p-6 space-y-6">
              {selectedMed.brand && (
                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-slate-50 p-3 rounded-xl">
                     <span className="text-xs text-slate-400 block mb-1">药品品牌</span>
                     <span className="font-semibold text-slate-800">{selectedMed.brand}</span>
                   </div>
                   <div className="bg-slate-50 p-3 rounded-xl">
                     <span className="text-xs text-slate-400 block mb-1">存放位置</span>
                     <span className="font-semibold text-slate-800">{selectedMed.location}</span>
                   </div>
                </div>
              )}
              {!selectedMed.brand && (
              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-slate-50 p-3 rounded-xl">
                   <span className="text-xs text-slate-400 block mb-1">存放位置</span>
                   <span className="font-semibold text-slate-800">{selectedMed.location}</span>
                 </div>
                 <div className="bg-slate-50 p-3 rounded-xl">
                   <span className="text-xs text-slate-400 block mb-1">库存剩余</span>
                   <span className="font-semibold text-emerald-600 text-lg">{selectedMed.total_quantity} {selectedMed.unit}</span>
                 </div>
              </div>
              )}

              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                <h4 className="text-sm font-bold text-emerald-800 uppercase mb-2 flex items-center gap-2">
                  <span>📝</span> 服用说明
                </h4>
                <p className="text-base text-emerald-900 leading-relaxed font-medium">{selectedMed.dosage_instruction}</p>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2">适应症</h4>
                <p className="text-base text-slate-600 leading-relaxed">{selectedMed.symptoms_treated}</p>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-2">副作用与禁忌</h4>
                <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl">{selectedMed.side_effects}</p>
              </div>
              
              <div className="pt-6 mt-4 border-t border-slate-100 flex justify-between items-center">
                 {/* 编辑与删除并列放置 */}
                 <div className="flex gap-3">
                   <button 
                      type="button" 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const med = selectedMed;
                        setSelectedMed(null);      // 关闭详情，避免弹窗叠层
                        setEditingMed(med);
                        setShowAddForm(true);      // 打开预填的编辑表单
                      }}
                      className="text-emerald-600 text-sm font-bold bg-emerald-50 px-4 py-2 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer border border-emerald-100"
                   >
                      编辑信息
                   </button>
                   <button 
                      type="button" 
                      onClick={(e) => onRequestDelete(e, selectedMed.id)}
                      className="text-red-500 text-sm font-bold bg-red-50 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors cursor-pointer border border-red-100"
                   >
                      删除此药
                   </button>
                 </div>
                 <div className="text-right text-xs text-slate-400 space-y-1">
                   <div>过期: <span className="font-mono">{selectedMed.expiry_date}</span></div>
                   <div>购买: <span className="font-mono">{selectedMed.last_purchase_date}</span></div>
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- 删除确认弹窗 --- */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl mb-4 mx-auto">🗑️</div>
            <h3 className="text-xl font-bold text-center text-slate-800 mb-2">确认删除?</h3>
            <p className="text-center text-slate-500 mb-8 px-4">
              您确定要将该药品从药箱中彻底移除吗？<br />
              <span className="text-red-400 text-xs">此操作不可恢复。</span>
            </p>
            <div className="flex gap-4">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">取消</button>
              <button type="button" onClick={handleConfirmDelete} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 shadow-lg shadow-red-200 active:scale-95 transition-all">确定删除</button>
            </div>
          </div>
        </div>
      )}

      {/* --- 吃药确认弹窗 --- */}
      {consumeTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setConsumeMedId(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-center mb-2 text-slate-800">确认服用</h3>
            <p className="text-center text-emerald-600 font-medium mb-8">{consumeTarget.name}</p>
            <div className="flex items-center justify-center gap-6 mb-10">
              <button onClick={() => setConsumeAmount(Math.max(1, consumeAmount - 1))} className="w-12 h-12 rounded-full bg-slate-100 text-2xl font-bold text-slate-600 flex items-center justify-center hover:bg-slate-200">-</button>
              <div className="flex flex-col items-center min-w-[60px]">
                 <span className="text-4xl font-bold text-slate-800">{consumeAmount}</span>
                 <span className="text-sm text-slate-400 font-medium mt-1">{consumeTarget.unit}</span>
              </div>
              {/* 上限为当前库存，避免 UI 上可选出超过持有量的服用数 */}
              <button
                onClick={() => setConsumeAmount(Math.min(consumeTarget.total_quantity, consumeAmount + 1))}
                className="w-12 h-12 rounded-full bg-slate-100 text-2xl font-bold text-slate-600 flex items-center justify-center hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={consumeAmount >= consumeTarget.total_quantity}
              >+</button>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setConsumeMedId(null)} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">取消</button>
              <button onClick={handleConsume} className="flex-1 py-3.5 rounded-2xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-200">确认记录</button>
            </div>
          </div>
        </div>
      )}

      {/* --- 存储异常 toast --- */}
      {storageWarning && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-2xl max-w-[90vw] md:max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          ⚠️ {storageWarning}
        </div>
      )}

      {showAddForm && (
        <AddMedicineForm 
          key={editingMed ? `edit-${editingMed.id}` : 'add-new'}
          editingMed={editingMed ?? undefined} 
          onClose={() => { setShowAddForm(false); setEditingMed(null); }} 
          onSuccess={() => { setShowAddForm(false); setEditingMed(null); refreshData(); }} 
        />
      )}

      {/* 数据备份与恢复（导出/导入；与新版 UI 同一组件，功能保持同步） */}
      {backupOpen && (
        <DataBackupDialog
          onClose={() => setBackupOpen(false)}
          onDone={message => {
            setBackupOpen(false);
            setStorageWarning(message);
            refreshData();
          }}
        />
      )}
    </div>
  );
}

export default App;