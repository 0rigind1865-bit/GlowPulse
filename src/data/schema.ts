// 資料層 schema 與載入器：把 JSON 資料檔在「載入當下」就驗證結構。
//
// 為什麼存在：brand / styles 等資料會被 AI 自動更新。過去它們是 .ts 模組，
// 一旦 AI 寫入未跳脫的引號就會讓整個服務 SyntaxError 掛掉、且難以察覺。
// 改存 JSON 後，寫入交給 JSON.stringify（不會產生語法錯誤），讀取時用 zod
// 驗證；萬一資料真的壞了，會在載入階段拋出「明確、可定位」的錯誤，而不是
// 在執行某個任務時才神祕崩潰。

import { z } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// 資料檔與本檔同目錄（src/data/）
const DATA_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Schema 定義 ─────────────────────────────────────────────────────────────

/** 品牌資料：靜態模板（手動維護）＋ AI 累積的寫作技巧清單 */
export const BrandSchema = z.object({
    template: z.string().min(1),
    principles: z.array(z.string().min(1)),
});
export type Brand = z.infer<typeof BrandSchema>;

/** 單一發文風格 */
export const PostStyleSchema = z.object({
    name: z.string().min(1),
    instruction: z.string().min(1),
});

/** 發文風格清單（至少一個） */
export const StylesSchema = z.array(PostStyleSchema).min(1);
export type StyleData = z.infer<typeof PostStyleSchema>;

// ─── 載入器 ──────────────────────────────────────────────────────────────────

/**
 * 讀取並驗證 src/data/ 下的 JSON 資料檔。
 * 讀檔失敗、JSON 格式錯誤、或結構不符 schema 時，一律拋出含檔名與原因的錯誤，
 * 讓問題在「載入時」就暴露，而非散落到各任務執行期。
 */
export function loadData<T>(fileName: string, schema: z.ZodType<T>): T {
    const fullPath = join(DATA_DIR, fileName);

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(fullPath, 'utf-8'));
    } catch (e) {
        throw new Error(`資料檔 ${fileName} 無法讀取或不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
    }

    const result = schema.safeParse(raw);
    if (!result.success) {
        const detail = result.error.issues
            .map(i => `${i.path.join('.') || '(root)'}：${i.message}`)
            .join('；');
        throw new Error(`資料檔 ${fileName} 結構驗證失敗：${detail}`);
    }
    return result.data;
}
