/**
 * 文件名: App.tsx
 * 功能: 应用主入口
 * 描述: 增加搜索功能，适配异步数据加载。
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Medicine } from './types';
import { MedicineService } from './services/medicineService';
import MedicineCard from './components/MedicineCard';
import ShoppingList from './components/ShoppingList';
import AddMedicineForm from './components/AddMedicineForm';

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 异步加载数据
  const refreshData = async () => {
    let meds = await MedicineService.getMedicines();
    meds = MedicineService.sortMedicines(meds);
    setMedicines(meds);
  };

  useEffect(() => {
    refreshData();
  }, [activeTab]);

  const handleConsume = async () => {
    if (consumeMedId) {
      await MedicineService.consumeMedicine(consumeMedId, consumeAmount);
      setConsumeMedId(null);
      setConsumeAmount(1);
      refreshData();
    }
  };

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
    
    // 后台删除
    await MedicineService.deleteMedicine(deleteConfirmId);
    setDeleteConfirmId(null);
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

    // 2. 状态过滤
    const today = new Date();
    switch (filterType) {
      case 'low':
        return result.filter(m => m.total_quantity <= m.threshold && m.total_quantity > 0 && new Date(m.expiry_date) >= today);
      case 'out':
        return result.filter(m => m.total_quantity === 0 && new Date(m.expiry_date) >= today);
      case 'expired':
        return result.filter(m => new Date(m.expiry_date) < today);
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
     const getCategoryWeight = (c: string) => {
       if (['感冒', '止痛', '肠胃', '抗生素', '心脑'].some(k => c.includes(k))) return 10;
       if (['咽喉', '抗过敏'].some(k => c.includes(k))) return 5;
       if (['外用', '眼科'].some(k => c.includes(k))) return 2;
       if (['保健品', '医疗器械'].some(k => c.includes(k))) return 0;
       return 5;
    };
    return Object.keys(groupedMedicines).sort((a, b) => getCategoryWeight(b) - getCategoryWeight(a));
  }, [groupedMedicines]);


  const stats = useMemo(() => {
    const today = new Date();
    return {
      total: medicines.length,
      low: medicines.filter(m => m.total_quantity <= m.threshold && m.total_quantity > 0).length,
      out: medicines.filter(m => m.total_quantity === 0).length,
      expired: medicines.filter(m => new Date(m.expiry_date) < today).length
    };
  }, [medicines]);

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-800 bg-slate-50">
      
      {/* --- 顶部导航栏 --- */}
      <header className="bg-white shadow-sm sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-4 md:py-5 flex justify-between items-center">
          <div className="flex items-center gap-3 md:gap-4 cursor-pointer" onClick={() => { setFilterType('all'); setActiveTab('home'); }}>
             <div className="w-10 h-10 md:w-12 md:h-12 bg-emerald-500 rounded-xl md:rounded-2xl flex items-center justify-center text-white font-bold text-xl md:text-2xl shadow-lg shadow-emerald-200">
               💊
             </div>
             <div>
               <h1 className="font-bold text-xl md:text-2xl text-slate-800 leading-none tracking-tight">智慧药箱</h1>
               <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">家庭健康管家</p>
             </div>
          </div>
          
          <div className="hidden md:flex gap-6">
             <button onClick={() => setActiveTab('home')} className={`px-6 py-2.5 rounded-xl font-bold transition-colors ${activeTab === 'home' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>我的药箱</button>
             <button onClick={() => setActiveTab('cart')} className={`px-6 py-2.5 rounded-xl font-bold transition-colors ${activeTab === 'cart' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-500 hover:text-slate-800'}`}>需补货</button>
          </div>
          
          <button 
            onClick={() => setShowAddForm(true)}
            className="hidden md:flex bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors items-center gap-2 shadow-md">
            <span>+ 入库新药</span>
          </button>
        </div>
      </header>

      {/* --- 主要内容区域 --- */}
      <main className="flex-1 overflow-y-auto">
        
        {activeTab === 'home' && (
          <div className="p-4 pb-28 md:pb-10 max-w-6xl mx-auto">
            
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
               <div className="text-center py-20">
                 <div className="text-4xl mb-4">🔍</div>
                 <div className="text-slate-400 font-medium">没有找到相关药品</div>
                 {searchQuery && <div className="text-slate-300 text-sm mt-2">试试其他关键词？</div>}
               </div>
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
                        onConsume={(id) => setConsumeMedId(id)}
                        onDetail={(med) => setSelectedMed(med)}
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

      {/* --- 底部导航栏 (手机端) --- */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around items-center h-20 z-30 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => { setActiveTab('home'); setFilterType('all'); }}
          className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'home' ? 'text-emerald-600' : 'text-slate-400'}`}>
          <IconHome />
          <span className="text-xs mt-1.5 font-medium">药箱</span>
        </button>
         <div className="relative -top-6">
           <button 
             onClick={() => setShowAddForm(true)}
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
            <button className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 text-slate-600 hover:bg-black/20 z-10" onClick={() => setSelectedMed(null)}>✕</button>
            
            <div className="relative h-64 bg-slate-100">
               <img src={selectedMed.image_url || 'https://via.placeholder.com/300'} className="w-full h-full object-cover" alt={selectedMed.name} />
               <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 pt-16">
                 <h2 className="text-2xl font-bold text-white leading-tight">{selectedMed.name}</h2>
                 <p className="text-white/80 text-sm mt-1">{selectedMed.form_type} · {selectedMed.category}</p>
               </div>
            </div>

            <div className="p-6 space-y-6">
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
                 <button 
                    type="button" 
                    onClick={(e) => onRequestDelete(e, selectedMed.id)}
                    className="text-red-500 text-sm font-bold bg-red-50 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors cursor-pointer border border-red-100"
                 >
                    删除此药
                 </button>
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
      {consumeMedId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-center mb-2 text-slate-800">确认服用</h3>
            <p className="text-center text-emerald-600 font-medium mb-8">{medicines.find(m => m.id === consumeMedId)?.name}</p>
            <div className="flex items-center justify-center gap-6 mb-10">
              <button onClick={() => setConsumeAmount(Math.max(1, consumeAmount - 1))} className="w-12 h-12 rounded-full bg-slate-100 text-2xl font-bold text-slate-600 flex items-center justify-center hover:bg-slate-200">-</button>
              <div className="flex flex-col items-center min-w-[60px]">
                 <span className="text-4xl font-bold text-slate-800">{consumeAmount}</span>
                 <span className="text-sm text-slate-400 font-medium mt-1">{medicines.find(m => m.id === consumeMedId)?.unit}</span>
              </div>
              <button onClick={() => setConsumeAmount(consumeAmount + 1)} className="w-12 h-12 rounded-full bg-slate-100 text-2xl font-bold text-slate-600 flex items-center justify-center hover:bg-slate-200">+</button>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setConsumeMedId(null)} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">取消</button>
              <button onClick={handleConsume} className="flex-1 py-3.5 rounded-2xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-200">确认记录</button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <AddMedicineForm onClose={() => setShowAddForm(false)} onSuccess={() => { setShowAddForm(false); refreshData(); }} />
      )}
    </div>
  );
}

export default App;