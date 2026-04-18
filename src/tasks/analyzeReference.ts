// 任務：解析 docs/reference-posts.md，AI 提取高流量貼文的寫作模式，
// 自動更新 data 層（brand.ts / styles.ts），讓日常發文更容易獲得互動
// 設計為每日可觸發，與 weeklyReport 互補：
//   weeklyReport  → 從「自己的成效數據」學習什麼有效
//   analyzeReference → 從「外部優質貼文」學習怎麼寫

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../services/generate.js';
import { BRAND_CONTEXT } from '../data/brand.js';
import { POST_STYLES } from '../data/styles.js';
import { parseDataUpdates, stripUpdatesBlock, applyDataUpdates } from '../utils/dataUpdater.js';
import { confirmAction } from '../utils/confirm.js';

const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs');

// ─── 型別定義 ────────────────────────────────────────────────────────────────

/** 從 reference-posts.md 解析出的單筆貼文記錄 */
type ReferencePost = {
    category: string;  // 對應 styles.ts 的風格名稱（職人共鳴感 / 創業乾貨型 / 視覺至上型 / 其他）
    url: string;       // 原始貼文網址（僅供追溯，分析只用 text）
    text: string;      // 貼文完整原文
    reason: string;    // 收錄原因，說明這篇的亮點
};

// ─── 解析 reference-posts.md ─────────────────────────────────────────────────

/**
 * 解析 reference-posts.md，提取所有真實貼文記錄
 *
 * 解析規則：
 * - `### 分類名稱` 切換當前分類
 * - `#### 編號` 開始一筆貼文記錄
 * - `URL:` 提取來源網址
 * - `文字：` 之後到 `為何收錄：` 之前是貼文原文（可跨多行）
 * - `為何收錄：` 提取收錄原因
 * - HTML 注解（<!-- -->）整塊略過（範例用途，非真實貼文）
 */
function parseReferencePosts(markdown: string): ReferencePost[] {
    // 移除 HTML 注解區塊與 code block（兩者都是說明用途，非真實貼文）
    const cleaned = markdown
        .replace(/<!--[\s\S]*?-->/g, '')    // <!-- --> 注解
        .replace(/```[\s\S]*?```/g, '')     // ``` 程式碼區塊（如「新增格式」說明）
        .replace(/`[^`]+`/g, '');           // 單行行內 code

    const posts: ReferencePost[] = [];
    let currentCategory = '';
    const lines = cleaned.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        // 分類標題（### ...）
        if (line.startsWith('### ')) {
            currentCategory = line.slice(4).trim();
            i++;
            continue;
        }

        // 貼文條目（#### ...）— 必須有分類才處理
        if (line.startsWith('#### ') && currentCategory) {
            i++;
            let url = '';
            let reason = '';
            let inText = false;
            const textLines: string[] = [];

            // 逐行讀取此條目的欄位，直到遇到下一個 #### / ### / --- 為止
            while (i < lines.length) {
                const current = lines[i];
                const trimmed = current.trim();

                if (trimmed.startsWith('#### ') || trimmed.startsWith('### ') || trimmed === '---') break;

                if (trimmed.startsWith('URL:')) {
                    url = trimmed.slice(4).trim();
                    inText = false;
                } else if (/^文字[：:]/.test(trimmed)) {
                    inText = true;
                    // 若「文字：」同行後面就有內容，也一起收
                    const inline = trimmed.replace(/^文字[：:]/, '').trim();
                    if (inline) textLines.push(inline);
                } else if (/^為何收錄[：:]/.test(trimmed)) {
                    reason = trimmed.replace(/^為何收錄[：:]/, '').trim();
                    inText = false;
                } else if (inText) {
                    // 保留原始縮排，維持貼文的換行節奏
                    textLines.push(current);
                }

                i++;
            }

            const text = textLines.join('\n').trim();
            // 只收錄有實際內容的貼文（過濾空殼條目）
            if (text) {
                posts.push({ category: currentCategory, url, text, reason });
            }
            continue;
        }

        i++;
    }

    return posts;
}

// ─── 格式化給 AI ──────────────────────────────────────────────────────────────

/**
 * 將解析出的貼文依分類分組，格式化成 AI 容易閱讀的文字區塊
 * 收錄原因一同附上，幫助 AI 理解每篇的亮點所在
 */
function formatPostsForAI(posts: ReferencePost[]): string {
    // 依分類聚合
    const byCategory = new Map<string, ReferencePost[]>();
    for (const p of posts) {
        if (!byCategory.has(p.category)) byCategory.set(p.category, []);
        byCategory.get(p.category)!.push(p);
    }

    return Array.from(byCategory.entries())
        .map(([category, categoryPosts]) => {
            const entries = categoryPosts.map((p, idx) => {
                const indentedText = p.text.split('\n').map(l => `    ${l}`).join('\n');
                const lines = [
                    `  【貼文 ${idx + 1}】`,
                    `  原文：`,
                    indentedText,
                ];
                if (p.reason) lines.push(`  收錄原因：${p.reason}`);
                return lines.join('\n');
            });
            return `### ${category}（${categoryPosts.length} 篇）\n${entries.join('\n\n')}`;
        })
        .join('\n\n');
}

// ─── AI 分析 ──────────────────────────────────────────────────────────────────

/**
 * 請 AI 從參考貼文中提取可操作的寫作模式，並更新風格指令
 * 分析角度：開頭鉤子、懸念設計、句子節奏、情緒觸發、結尾策略
 * 優先 Claude Haiku，無餘額退回 HF Qwen
 */
async function analyzeWithAI(posts: ReferencePost[]): Promise<string> {
    const currentStyles = POST_STYLES.map(s => `- ${s.name}：${s.instruction}`).join('\n');
    const formattedPosts = formatPostsForAI(posts);

    const system = [
        '你是一位專精台灣 Threads 社群的內容策略師，擅長從高互動貼文中提取可複製的寫作技巧。',
        '請全程使用繁體中文回應，嚴禁使用簡體中文。',
        '分析要具體到可以直接套用，例如「第一句用數字建立可信度」而非「語氣要活潑」。',
    ].join('\n');

    const prompt = [
        '以下是一批在 Threads 上值得學習的參考貼文，分類對應我們的發文風格。',
        '請分析這些貼文的寫作技巧，更新我們的風格指令，讓 AI 生成的貼文更容易獲得流量。',
        '',
        '=== 參考貼文 ===',
        formattedPosts,
        '',
        '=== 目前的品牌語氣設定 ===',
        BRAND_CONTEXT,
        '',
        '=== 目前的發文風格指令 ===',
        currentStyles,
        '',
        '請從以下五個維度提取具體可操作的寫作模式：',
        '1. 開頭鉤子 — 第一句話如何讓人停下來（數字？直接接住痛點？反常識開場？）',
        '2. 懸念設計 — 如何讓人讀完全文、甚至想留言（製造資訊缺口、「看留言」技巧等）',
        '3. 句子節奏 — 長短句交錯的方式、斷行邏輯、視覺留白',
        '4. 情緒觸發 — 哪種情緒語氣讓人最想互動（共鳴感、實用感、好奇心、認同感）',
        '5. 結尾設計 — 如何收尾才能最大化留言與分享（提問？金句？開放式結尾？）',
        '',
        '請依下列順序輸出（全程繁體中文）：',
        '',
        '【第一步】先輸出結構化更新區塊（程式自動讀取，最先輸出，嚴格遵守格式）：',
        '',
        '關於 brand_principles 的格式要求（非常重要）：',
        '每一條必須包含三個部分，寫成一句話：「技巧描述，說明為什麼有效，加上可直接套用的例句」',
        '範例格式：「開頭直接接住讀者正在問的問題（例：最近很常看到有人在問...），讀者立刻覺得被理解，比自我介紹開場的停留率高」',
        '嚴禁只寫抽象方向（例：「語氣要自然」「多用口語」），這樣的條目無效。',
        '',
        '<<<UPDATES_JSON>>>',
        '{',
        '  "brand_principles": [',
        '    "全程使用繁體中文，嚴禁使用簡體中文",',
        '    "（技巧描述 + 為什麼有效 + 可直接套用的例句，三者合為一句，從這批參考貼文中萃取）"',
        '  ],',
        '  "styles": [',
        '    { "name": "職人共鳴感", "instruction": "（保留原有指令核心，加入從參考貼文學到的具體句型範例，讓 AI 可以直接模仿，不要只說方向）" },',
        '    { "name": "創業乾貨型", "instruction": "（...）" },',
        '    { "name": "視覺至上型", "instruction": "（...）" }',
        '  ]',
        '}',
        '<<<END_UPDATES_JSON>>>',
        '',
        '【第二步】輸出分析內容：',
        '',
        '## 從參考貼文提取的寫作模式',
        '（按五個維度列點，每條寫法要具體到可以立刻模仿，附上從哪篇貼文學到的）',
        '',
        '## 對風格指令的具體修改',
        '（說明每個風格指令改了什麼、為什麼這樣改，讓 AI 生成的文字更接近參考貼文的質感）',
    ].join('\n');

    return generate('referenceAnalysis', system, prompt, 3000, 0.5);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

export type AnalyzeReferenceResult =
    | { success: true; postsAnalyzed: number; updatedFiles: string[] }
    | { success: false; error: string };

/**
 * 完整的參考貼文分析流程：
 *   1. 讀取並解析 docs/reference-posts.md
 *   2. 過濾出真實貼文（排除空殼與 HTML 注解範例）
 *   3. AI 分析寫作模式，產出 Markdown + JSON 更新區塊
 *   4. 自動寫回 brand.ts / styles.ts
 */
export async function runAnalyzeReference(): Promise<AnalyzeReferenceResult> {
    // 步驟一：讀取參考貼文
    const referenceFile = join(DOCS_DIR, 'reference-posts.md');
    let markdown: string;
    try {
        markdown = readFileSync(referenceFile, 'utf-8');
    } catch {
        return { success: false, error: `找不到 ${referenceFile}，請先建立參考貼文庫。` };
    }

    const posts = parseReferencePosts(markdown);

    if (posts.length === 0) {
        return {
            success: false,
            error: [
                'reference-posts.md 中尚無有效貼文記錄。',
                '請依格式加入至少一篇參考貼文後再執行：',
                '',
                '#### 1',
                'URL: https://www.threads.net/@帳號/post/ID',
                '文字：',
                '（貼文原文）',
                '為何收錄：（說明亮點）',
            ].join('\n'),
        };
    }

    // 顯示各分類的貼文數量
    const countByCategory = posts.reduce<Record<string, number>>((acc, p) => {
        acc[p.category] = (acc[p.category] ?? 0) + 1;
        return acc;
    }, {});
    console.log('\n📚 參考貼文庫概況：');
    for (const [cat, count] of Object.entries(countByCategory)) {
        console.log(`   ${cat}：${count} 篇`);
    }

    // 步驟二：AI 分析
    console.log('\n🤖 AI 正在分析寫作模式...');
    const rawAiOutput = await analyzeWithAI(posts);

    // 步驟三：解析並套用 data 層更新
    const updates = parseDataUpdates(rawAiOutput);
    let updatedFiles: string[] = [];

    if (updates) {
        const preview = [
            '📋 AI 建議更新以下 data 層：',
            updates.brand_principles?.length
                ? `   brand.ts：${updates.brand_principles.length} 條寫作技巧`
                : '',
            updates.styles?.length
                ? `   styles.ts：${updates.styles.length} 個風格指令`
                : '',
        ].filter(Boolean).join('\n');

        const shouldUpdate = await confirmAction('是否將分析結果寫回 brand.ts / styles.ts？', preview);
        if (shouldUpdate) {
            console.log('\n🔧 更新 data 層...');
            const log = applyDataUpdates(updates);
            log.forEach(line => console.log(`   ${line}`));
            if (updates.brand_principles?.length) updatedFiles.push('brand.ts');
            if (updates.styles?.length) updatedFiles.push('styles.ts');
        } else {
            console.log('   已跳過 data 層更新');
        }
    } else {
        console.log('   ⚠️  未解析到結構化更新區塊，跳過自動更新');
        console.log('   （請手動參考以下分析內容調整 data 層）');
    }

    // 步驟四：輸出分析內容供參考
    const analysis = stripUpdatesBlock(rawAiOutput);
    if (analysis) {
        console.log('\n' + '─'.repeat(50));
        console.log(analysis);
        console.log('─'.repeat(50));
    }

    return { success: true, postsAnalyzed: posts.length, updatedFiles };
}
