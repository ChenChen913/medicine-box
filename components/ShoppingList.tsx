import React, { useEffect, useState } from 'react';
import { MedicineService } from '../services/medicineService';
import { ShoppingItem } from '../types';

const ShoppingList: React.FC = () => {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [restockItem, setRestockItem] = useState<ShoppingItem | null>(null);
  const [newQuantity, setNewQuantity] = useState<string>('');
  const [newExpiry, setNewExpiry] = useState<string>('');

  const loadList = async () => {
    const all = await MedicineService.getShoppingList();
    setItems(all.filter(i => i.status === 'pending'));
  };

  useEffect(() => {
    loadList();
  }, []);

  const openRestockDialog = (item: ShoppingItem) => {
    setRestockItem(item);
    setNewQuantity('');
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setNewExpiry(nextYear.toISOString().split('T')[0]);
  };

  const handleRestockSubmit = async () => {
    if (!restockItem || !newQuantity || !newExpiry) return;
    
    await MedicineService.restockMedicine(restockItem.id, parseInt(newQuantity), newExpiry);
    
    setRestockItem(null);
    loadList();
  };

  return (
    <div className="p-4 pb-20 md:pb-4 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center">
        <span>需补货清单</span>
        <span className="ml-3 bg-red-100 text-red-600 text-sm font-bold px-3 py-1 rounded-full">{items.length}</span>
      </h2>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl shadow-sm border border-dashed border-slate-200">
          <div className="text-4xl mb-4">🛒</div>
          <p className="text-slate-400 font-medium">目前没有需要补货的药品</p>
          <p className="text-slate-300 text-sm mt-1">系统会自动检测库存和过期情况</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center group hover:shadow-md transition-shadow">
              <div>
                <h3 className="font-bold text-lg text-slate-800">{item.medicine_name}</h3>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`text-xs font-bold px-2 py-1 rounded border ${
                    item.reason === '过期' 
                      ? 'bg-red-50 text-red-600 border-red-100' 
                      : item.reason === '用尽'
                      ? 'bg-orange-50 text-orange-600 border-orange-100'
                      : 'bg-blue-50 text-blue-600 border-blue-100'
                  }`}>
                    原因: {item.reason}
                  </span>
                  <span className="text-xs text-slate-400">加入时间: {new Date(item.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              
              <button 
                onClick={() => openRestockDialog(item)}
                className="px-6 py-2.5 bg-emerald-500 text-white text-sm font-bold rounded-xl hover:bg-emerald-600 active:bg-emerald-700 transition-colors shadow-sm shadow-emerald-200 whitespace-nowrap"
              >
                已买入
              </button>
            </div>
          ))}
        </div>
      )}

      {restockItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-slate-800 mb-1">购入登记</h3>
            <p className="text-slate-500 text-sm mb-6">药品: <span className="font-medium text-emerald-600">{restockItem.medicine_name}</span></p>
            
            <div className="space-y-4">
               <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">新购入数量</label>
                  <input 
                    type="number" 
                    value={newQuantity}
                    onChange={e => setNewQuantity(e.target.value)}
                    placeholder="例如: 24"
                    className="w-full border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none text-lg font-bold bg-white"
                    autoFocus
                  />
               </div>
               <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">新过期日期</label>
                  <input 
                    type="date" 
                    value={newExpiry}
                    onChange={e => setNewExpiry(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                  />
               </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setRestockItem(null)} 
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors">
                取消
              </button>
              <button 
                onClick={handleRestockSubmit} 
                disabled={!newQuantity || !newExpiry}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]">
                确认更新
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoppingList;