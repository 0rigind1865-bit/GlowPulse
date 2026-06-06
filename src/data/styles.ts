// 發文風格定義，控制 AI 的寫作語氣與切入角度。
//
// 資料來源改為 styles.json（載入時以 zod 驗證）。
// weeklyReport / analyzeReference / genStyles 透過 dataUpdater 寫回 JSON 即可更新，
// 不再以字串替換改寫本檔，避免 AI 輸出的引號造成語法錯誤。

import { loadData, StylesSchema } from './schema.js';

export type PostStyle = {
    name: string;         // 風格名稱，用於 console 顯示
    instruction: string;  // 給 AI 的具體風格指令，描述語氣、切入點與結尾方向
};

export const POST_STYLES: PostStyle[] = loadData('styles.json', StylesSchema);
