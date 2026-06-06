// 共用工具：解析 AI 回傳的 <<<UPDATES_JSON>>> 區塊，並寫回 brand.json / styles.json
// weeklyReport.ts 與 analyzeReference.ts 都需要這個能力，抽到此處避免重複
//
// 設計原則：
//   - updateBrandData 採「累積合併」而非「覆寫」，避免自我學習迴路的語意漂移：
//       保留現有技巧、只新增真正新觀察、設上限（MAX_PRINCIPLES）防止無限增長
//   - 寫入一律用 JSON.stringify：AI 輸出的引號／換行交給 JSON 處理，
//     不會像字串替換那樣產生語法錯誤而讓服務掛掉

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BrandSchema, StylesSchema, type Brand } from '../data/schema.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');

// 技巧清單的最大保留條數，超過時捨棄最早的條目（FIFO）
const MAX_PRINCIPLES = 20;

// ─── 型別定義 ────────────────────────────────────────────────────────────────

/**
 * AI 輸出的結構化更新區塊，包含要寫回 brand.json 與 styles.json 的內容
 * brand_principles：每條為完整文字字串，不含 "-" 號
 * styles：每筆包含 name 與 instruction，對應 POST_STYLES 陣列的欄位
 */
export type DataUpdate = {
    brand_principles: string[];
    styles: Array<{ name: string; instruction: string }>;
};

// ─── 解析工具 ────────────────────────────────────────────────────────────────

/**
 * 從 AI 輸出中提取 <<<UPDATES_JSON>>> 區塊並解析為物件
 * 若找不到區塊或 JSON 格式錯誤，回傳 null（不影響報告儲存）
 */
export function parseDataUpdates(aiOutput: string): DataUpdate | null {
    const match = aiOutput.match(/<<<UPDATES_JSON>>>\s*([\s\S]*?)\s*<<<END_UPDATES_JSON>>>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]) as DataUpdate;
    } catch {
        return null;
    }
}

/**
 * 從 AI 輸出中移除 JSON 更新區塊，只保留供人閱讀的 Markdown 分析內容
 */
export function stripUpdatesBlock(aiOutput: string): string {
    return aiOutput.replace(/\n*<<<UPDATES_JSON>>>[\s\S]*?<<<END_UPDATES_JSON>>>\n*/g, '').trim();
}

// ─── 寫入工具 ────────────────────────────────────────────────────────────────

/**
 * 將 AI 新提出的技巧與現有清單合併，避免語意漂移：
 * - 以前 10 個中文字元做去重（容忍措辭微差異）
 * - 超過 MAX_PRINCIPLES 時捨棄最舊的條目（FIFO）
 */
function mergePrinciples(existing: string[], incoming: string[]): string[] {
    // 取前 10 個中文字元作為去重 key（中文資訊密度高，10 字足以辨識同一概念）
    // 刻意不取更多，避免「開頭用數字」與「開頭用數字（說明）」被判為不同條目
    const normalize = (s: string) => s.slice(0, 10).replace(/[\s，。！？、（）「」【】]/g, '');
    const existingKeys = new Set(existing.map(normalize));

    const trulyNew = incoming.filter(p => p.trim() && !existingKeys.has(normalize(p)));
    const merged = [...existing, ...trulyNew];

    // 若超出上限，從最舊的（陣列前端）開始丟棄
    return merged.length > MAX_PRINCIPLES ? merged.slice(merged.length - MAX_PRINCIPLES) : merged;
}

/**
 * 更新 brand.json 的 principles（【從優質貼文學到的技巧】）
 * 採「累積合併」模式：保留現有技巧，只補入 AI 帶來的真正新觀察。
 * 靜態 template（品牌定位與目標客群）維持不變。
 */
export function updateBrandData(incomingPrinciples: string[]): void {
    const filePath = join(DATA_DIR, 'brand.json');

    // 用 schema 驗證讀入，確保不是在壞掉的資料上累積
    const brand: Brand = BrandSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')));

    const existing = brand.principles;
    const merged = mergePrinciples(existing, incomingPrinciples);
    const newCount = merged.length - existing.length;

    if (newCount > 0) {
        console.log(`   📚 累積模式：保留 ${existing.length} 條既有技巧，新增 ${newCount} 條`);
    } else {
        console.log(`   📚 累積模式：本次無真正新增技巧（AI 提供的均已存在），技巧總數維持 ${existing.length} 條`);
    }

    brand.principles = merged;
    writeFileSync(filePath, JSON.stringify(brand, null, 2) + '\n', 'utf-8');
}

/**
 * 整批更新 styles.json 的 POST_STYLES。
 * 寫入前用 schema 驗證，確保不會寫出結構不合法的資料。
 */
export function updateStylesData(styles: Array<{ name: string; instruction: string }>): void {
    const filePath = join(DATA_DIR, 'styles.json');
    const validated = StylesSchema.parse(styles);
    writeFileSync(filePath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
}

/**
 * 根據解析出的更新資料，依序更新 brand.json 與 styles.json
 * 任一檔案更新失敗不影響另一個，錯誤訊息記錄於回傳的 log 中
 */
export function applyDataUpdates(updates: DataUpdate): string[] {
    const log: string[] = [];

    if (updates.brand_principles?.length) {
        try {
            updateBrandData(updates.brand_principles);
            log.push(`✅ brand.json：已更新 ${updates.brand_principles.length} 條寫作原則`);
        } catch (e) {
            log.push(`❌ brand.json 更新失敗：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (updates.styles?.length) {
        try {
            updateStylesData(updates.styles);
            log.push(`✅ styles.json：已更新 ${updates.styles.length} 個風格指令`);
        } catch (e) {
            log.push(`❌ styles.json 更新失敗：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return log;
}
