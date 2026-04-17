// 共用工具：解析 AI 回傳的 <<<UPDATES_JSON>>> 區塊，並寫回 brand.ts / styles.ts
// weeklyReport.ts 與 analyzeReference.ts 都需要這個能力，抽到此處避免重複

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');

// ─── 型別定義 ────────────────────────────────────────────────────────────────

/**
 * AI 輸出的結構化更新區塊，包含要寫回 brand.ts 與 styles.ts 的內容
 * brand_principles：每條為完整文字字串，不含 "-" 號（寫入時自動加上）
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
 * 更新 brand.ts 中的【寫作原則】區塊
 * 只替換原則清單，品牌定位與目標客群維持不變
 * 尋找【寫作原則】標記，替換到結尾反引號之前的所有內容
 */
export function updateBrandTs(principles: string[]): void {
    const filePath = join(DATA_DIR, 'brand.ts');
    const content = readFileSync(filePath, 'utf-8');

    const markerIdx = content.indexOf('【寫作原則】');
    if (markerIdx === -1) throw new Error('brand.ts 中找不到【寫作原則】標記');

    const beforeMarker = content.slice(0, markerIdx);
    const afterMarker = content.slice(markerIdx);

    // 找第一個 \n` 作為結尾（即 template literal 的收尾）
    const closingIdx = afterMarker.indexOf('\n`');
    if (closingIdx === -1) throw new Error('brand.ts 格式異常，找不到結尾反引號');

    const closing = afterMarker.slice(closingIdx);
    const newSection = '【寫作原則】\n' + principles.map(p => `- ${p}`).join('\n');

    writeFileSync(filePath, beforeMarker + newSection + closing, 'utf-8');
}

/**
 * 更新 styles.ts 中的 POST_STYLES 陣列
 * 保留檔案頂部的型別定義，整個陣列重新生成
 * 單引號需跳脫，避免產生語法錯誤
 */
export function updateStylesTs(styles: Array<{ name: string; instruction: string }>): void {
    const filePath = join(DATA_DIR, 'styles.ts');
    const content = readFileSync(filePath, 'utf-8');

    const arrayStart = content.indexOf('export const POST_STYLES');
    if (arrayStart === -1) throw new Error('styles.ts 中找不到 POST_STYLES 宣告');

    const header = content.slice(0, arrayStart);
    const entries = styles.map(s => {
        const escaped = s.instruction
            .replace(/\\/g, '\\\\')   // 反斜線先跳脫
            .replace(/'/g, "\\'")     // 單引號跳脫
            .replace(/\r?\n/g, ' ');  // 換行轉空格（單引號字串不允許換行）
        return `    {\n        name: '${s.name}',\n        instruction: '${escaped}',\n    }`;
    }).join(',\n');

    writeFileSync(filePath, header + `export const POST_STYLES: PostStyle[] = [\n${entries},\n];\n`, 'utf-8');
}

/**
 * 根據解析出的更新資料，依序更新 brand.ts 與 styles.ts
 * 任一檔案更新失敗不影響另一個，錯誤訊息記錄於回傳的 log 中
 */
export function applyDataUpdates(updates: DataUpdate): string[] {
    const log: string[] = [];

    if (updates.brand_principles?.length) {
        try {
            updateBrandTs(updates.brand_principles);
            log.push(`✅ brand.ts：已更新 ${updates.brand_principles.length} 條寫作原則`);
        } catch (e) {
            log.push(`❌ brand.ts 更新失敗：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (updates.styles?.length) {
        try {
            updateStylesTs(updates.styles);
            log.push(`✅ styles.ts：已更新 ${updates.styles.length} 個風格指令`);
        } catch (e) {
            log.push(`❌ styles.ts 更新失敗：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return log;
}
