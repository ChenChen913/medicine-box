/**
 * 文件名: types.ts
 * 功能: 定义系统核心数据类型接口
 * 描述: 包含药品实体、枚举定义、日志记录及购物清单的数据结构定义。
 */

// 药品剂型枚举
export enum FormType {
  TABLET = '片剂',
  CAPSULE = '胶囊',
  GRANULE = '颗粒',
  LIQUID = '口服液',
  TOPICAL = '外用',
  SPRAY = '喷雾',
  OTHER = '其他'
}

// 购物清单条目状态
// 说明：数据库 schema 的 check 约束还允许 'bought'（已购买），
// 但当前业务里「已买入」会直接把条目从清单移除（见 restockMedicine），
// 不会产生 bought 状态的行，因此代码里只保留 PENDING。
export enum ShoppingStatus {
  PENDING = 'pending' // 待购买
}

// 核心药品实体接口
export interface Medicine {
  id: string;
  name: string; // 药名
  brand?: string; // 药品品牌（可选）：同名药不同品牌可分条管理、分开记录用药
  image_url?: string; // 图片URL
  form_type: FormType; // 剂型
  category: string; // 分类 (感冒药, 止痛药等)
  location: string; // 存放位置
  total_quantity: number; // 剩余总量
  unit: string; // 单位 (如: 粒, 盒)
  threshold: number; // 预警阈值
  expiry_date: string; // 过期日期 (ISO Date String: YYYY-MM-DD)
  last_purchase_date: string; // 最近购买日期
  symptoms_treated: string; // 适应症
  dosage_instruction: string; // 服用说明 (文本)
  daily_usage: number; // 每日估算用量 (用于计算大概还能吃几天)
  side_effects: string; // 副作用 (长文本)
  usage_frequency_score: number; // 核心算法字段: 使用频率分数 (排序用)
}

// 用药记录接口
export interface UsageLog {
  id: string;
  medicine_id: string;
  medicine_name: string;
  brand?: string; // 打卡时药品品牌快照：同名药不同品牌的用量可分别统计
  amount: number;
  log_time: string;
  user?: string;
}

// 购物清单接口
export interface ShoppingItem {
  id: string;
  medicine_name: string;
  reason: '过期' | '用尽' | '手动添加'; // 加入原因
  status: ShoppingStatus;
  created_at: string;
}
