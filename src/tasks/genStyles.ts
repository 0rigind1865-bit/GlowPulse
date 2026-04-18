// 任務：從 BRAND_CONTEXT 的【從優質貼文學到的技巧】自動衍生更多 POST_STYLES
// 每條技巧對應一種寫作切入角度，AI 會將技巧轉化成可直接套用的風格指令
// 流程：讀取技巧清單 → AI 分析 → 生成新風格 → 確認後寫回 styles.ts

import { generate } from '../services/generate.js';
import { BRAND_CONTEXT } from '../data/brand.js';
import { POST_STYLES } from '../data/styles.js';
import { parseDataUpdates, stripUpdatesBlock, updateStylesTs } from '../utils/dataUpdater.js';
import { confirmAction } from '../utils/confirm.js';

// ─── 型別定義 ────────────────────────────────────────────────────────────────

export type GenStylesResult =
    | { success: true; newStylesCount: number; totalStyles: number }
    | { success: false; error: string };

// ─── 從 BRAND_CONTEXT 提取技巧區塊 ──────────────────────────────────────────

/**
 * 從 BRAND_CONTEXT 字串中提取【從優質貼文學到的技巧】區塊
 * 這些技巧是寫好文章的具體方法，每條都對應一個可操作的寫作角度
 */
function extractTechniquesSection(brandContext: string): string {
    const marker = '【從優質貼文學到的技巧】';
    const idx = brandContext.indexOf(marker);
    if (idx === -1) return '';
    // 取從標記到字串結尾的全部內容
    return brandContext.slice(idx).trim();
}

// ─── AI 生成新風格 ────────────────────────────────────────────────────────────

/**
 * 讓 AI 將技巧轉化成可直接套用的 PostStyle 條目
 * 保留現有風格不動，只新增尚未涵蓋的寫作角度
 */
async function generateNewStyles(techniquesSection: string): Promise<string> {
    const existingStylesSummary = POST_STYLES
        .map((s, i) => `${i + 1}. 【${s.name}】：${s.instruction.slice(0, 80)}…`)
        .join('\n');

    const system = [
        '你是一位專精台灣 Threads 社群的內容策略師，擅長將寫作技巧轉化為可操作的風格指令。',
        '請全程使用繁體中文回應，嚴禁使用簡體中文。',
        '每個風格指令必須具體到 AI 能直接套用，包含：切入角度、句型範例、情緒基調、結尾策略。',
    ].join('\n');

    const prompt = [
        '以下是我們在 Threads 上學到的高互動貼文寫作技巧，以及目前已有的發文風格。',
        '請從這些技巧中，衍生出新的發文風格條目，擴大我們的風格庫。',
        '',
        '=== 從優質貼文學到的技巧 ===',
        techniquesSection,
        '',
        '=== 目前已有的發文風格（請勿重複）===',
        existingStylesSummary,
        '',
        '【任務說明】',
        '1. 從上方技巧清單中，找出尚未被現有三個風格涵蓋的寫作角度',
        '2. 每個角度衍生成一個新的 PostStyle 條目',
        '3. 目標生成 4-6 個新風格，讓整體風格庫達到 7-9 種不同切入方式',
        '4. 每個新風格的 instruction 必須包含：',
        '   - 明確的切入角度（怎麼開頭）',
        '   - 至少一個可直接模仿的句型範例（用『』包住）',
        '   - 情緒基調說明（讀者讀完後的感受）',
        '   - 結尾策略（如何引導留言或點進連結）',
        '   - 如何自然帶入 GlowMoment 預約系統',
        '',
        '【請依下列格式輸出（嚴格遵守）】：',
        '',
        '<<<UPDATES_JSON>>>',
        '{',
        '  "brand_principles": [],',
        '  "styles": [',
        '    { "name": "職人共鳴感", "instruction": "（保留原有，不修改）" },',
        '    { "name": "創業乾貨型", "instruction": "（保留原有，不修改）" },',
        '    { "name": "視覺至上型", "instruction": "（保留原有，不修改）" },',
        '    { "name": "（新風格名稱，2-5 字）", "instruction": "（新風格的完整指令）" },',
        '    （更多新風格...）',
        '  ]',
        '}',
        '<<<END_UPDATES_JSON>>>',
        '',
        '輸出 JSON 之後，再輸出每個新風格的設計說明：',
        '',
        '## 新增風格說明',
        '（說明每個新風格對應哪條技巧、為什麼這樣設計、適合哪種場景發文）',
    ].join('\n');

    return generate('genStyles', system, prompt, 4000, 0.6);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 從 BRAND_CONTEXT 的寫作技巧自動衍生新 POST_STYLES 並寫回 styles.ts
 *
 * 執行流程：
 *   1. 提取 BRAND_CONTEXT 中的技巧清單
 *   2. AI 分析現有風格的覆蓋範圍，衍生新風格條目
 *   3. 確認後更新 styles.ts（包含現有 3 個 + 新增的 N 個）
 */
export async function runGenStyles(): Promise<GenStylesResult> {
    console.log('\n📖 讀取品牌技巧清單...');
    const techniquesSection = extractTechniquesSection(BRAND_CONTEXT);

    if (!techniquesSection) {
        return { success: false, error: 'BRAND_CONTEXT 中找不到【從優質貼文學到的技巧】區塊' };
    }

    // 計算技巧條數（每條以「-」開頭）
    const techniqueCount = techniquesSection.split('\n').filter(l => l.trim().startsWith('-')).length;
    console.log(`   找到 ${techniqueCount} 條寫作技巧`);
    console.log(`   目前已有 ${POST_STYLES.length} 個發文風格`);

    console.log('\n🤖 AI 正在衍生新發文風格...');
    const rawAiOutput = await generateNewStyles(techniquesSection);

    // 解析結構化更新區塊
    const updates = parseDataUpdates(rawAiOutput);

    if (!updates || !updates.styles?.length) {
        console.log('\n⚠️  未解析到結構化風格輸出，顯示原始內容供參考：');
        console.log('─'.repeat(50));
        console.log(rawAiOutput.slice(0, 2000));
        console.log('─'.repeat(50));
        return { success: false, error: 'AI 未輸出符合格式的 styles 區塊' };
    }

    const newStylesCount = updates.styles.length - POST_STYLES.length;
    const newNames = updates.styles.slice(POST_STYLES.length).map(s => s.name);

    // 顯示新增的風格清單供確認
    console.log(`\n📋 AI 建議新增 ${newStylesCount > 0 ? newStylesCount : 0} 個風格（共 ${updates.styles.length} 個）：`);
    updates.styles.forEach((s, i) => {
        const isNew = i >= POST_STYLES.length;
        const tag = isNew ? ' ✨ 新增' : ' （現有）';
        console.log(`   ${i + 1}. 【${s.name}】${tag}`);
        if (isNew) {
            // 顯示前 60 字元的指令預覽
            console.log(`      ${s.instruction.slice(0, 80)}...`);
        }
    });

    // 顯示設計說明
    const analysis = stripUpdatesBlock(rawAiOutput);
    if (analysis) {
        console.log('\n' + '─'.repeat(50));
        console.log(analysis);
        console.log('─'.repeat(50));
    }

    if (newStylesCount <= 0) {
        console.log('\n⚠️  AI 未生成額外風格（可能認為現有風格已足夠覆蓋所有技巧）。');
        return { success: true, newStylesCount: 0, totalStyles: POST_STYLES.length };
    }

    const preview = `新增風格：${newNames.join('、')}`;
    const shouldUpdate = await confirmAction(`是否將 ${updates.styles.length} 個風格寫回 styles.ts？`, preview);

    if (!shouldUpdate) {
        console.log('   已略過寫入。');
        return { success: true, newStylesCount: 0, totalStyles: POST_STYLES.length };
    }

    try {
        updateStylesTs(updates.styles);
        console.log(`\n✅ styles.ts 已更新，共 ${updates.styles.length} 個風格`);
        return { success: true, newStylesCount, totalStyles: updates.styles.length };
    } catch (e) {
        return { success: false, error: `寫入 styles.ts 失敗：${e instanceof Error ? e.message : String(e)}` };
    }
}
