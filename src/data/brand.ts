// GlowMoment 品牌背景說明，注入 system prompt 讓 AI 有完整的產品認知。
//
// 資料來源改為 brand.json（載入時以 zod 驗證）：
//   - template：靜態品牌模板（定位、語氣、Hashtag、誘導留言格式），手動維護
//   - principles：【從優質貼文學到的技巧】清單，由 AI 透過 dataUpdater 累積更新
// 對外仍 export 同名的 BRAND_CONTEXT 字串，呼叫端無需更動。

import { loadData, BrandSchema } from './schema.js';

const brand = loadData('brand.json', BrandSchema);

export const BRAND_CONTEXT = (
    brand.template + '\n' + brand.principles.map(p => `- ${p}`).join('\n')
).trim();
