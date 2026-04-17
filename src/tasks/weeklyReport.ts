// 任務：擷取過去 7 天的貼文成效，AI 分析高互動貼文的共同特徵，
// 自動更新 data 層（brand.ts / styles.ts），並儲存 Markdown 週報

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getUsableToken, fetchMyPosts, fetchPostInsights, type PostInsights } from '../services/threads.js';
import { callClaude } from '../services/claude.js';
import { callChatCompletion } from '../services/hf.js';
import { BRAND_CONTEXT } from '../data/brand.js';
import { POST_STYLES } from '../data/styles.js';
import { parseDataUpdates, stripUpdatesBlock, applyDataUpdates } from '../utils/dataUpdater.js';

const REPORTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/reports');

// 取前 N 篇高互動貼文送進 AI 分析
const TOP_POSTS_COUNT = 5;

// ─── 格式化與 AI 呼叫 ────────────────────────────────────────────────────────

function formatPostsForAI(posts: PostInsights[]): string {
    return posts
        .map((p, i) => {
            const date = new Date(p.timestamp).toLocaleDateString('zh-TW');
            return [
                `【貼文 ${i + 1}】${date}`,
                `內容：${p.text}`,
                `數據：觀看 ${p.views} ｜ 按讚 ${p.likes} ｜ 回覆 ${p.replies} ｜ 轉發 ${p.reposts} ｜ 引用 ${p.quotes}`,
                `互動分數：${p.engagementScore}`,
            ].join('\n');
        })
        .join('\n\n');
}

/**
 * 請 AI 分析貼文表現，並在回應尾端輸出可自動寫回 data 層的 JSON 更新區塊
 * 優先使用 Claude Haiku（繁體中文穩定），餘額不足時退回 HF
 */
async function analyzeWithAI(
    topPosts: PostInsights[],
    lowPosts: PostInsights[],
): Promise<string> {
    const currentStyles = POST_STYLES.map(s => `- ${s.name}：${s.instruction}`).join('\n');

    const system = [
        '你是一位社群內容策略師，專門協助台灣美業品牌優化 Threads 貼文策略。',
        '請全程使用繁體中文回應，嚴禁使用簡體中文。',
        '分析須具體、可操作，直接給出可貼上使用的文字建議。',
    ].join('\n');

    const prompt = [
        '請根據以下數據，分析這個 Threads 帳號的貼文表現。',
        '',
        '=== 互動分數最高的貼文 ===',
        formatPostsForAI(topPosts),
        '',
        '=== 互動分數最低的貼文 ===',
        formatPostsForAI(lowPosts),
        '',
        '=== 目前的品牌語氣設定 ===',
        BRAND_CONTEXT,
        '',
        '=== 目前的發文風格清單 ===',
        currentStyles,
        '',
        '請依下列順序輸出（全程繁體中文）：',
        '',
        '【第一步】先輸出以下結構化更新區塊（程式自動讀取，請最先輸出、嚴格遵守格式）：',
        '',
        '<<<UPDATES_JSON>>>',
        '{',
        '  "brand_principles": [',
        '    "全程使用繁體中文，嚴禁使用簡體中文",',
        '    "（其餘原則逐條列出，每條為完整文字，不含 - 號）"',
        '  ],',
        '  "styles": [',
        '    { "name": "職人共鳴感", "instruction": "（整合為單一字串的完整風格指令）" },',
        '    { "name": "創業乾貨型", "instruction": "（...）" },',
        '    { "name": "視覺至上型", "instruction": "（...）" }',
        '  ]',
        '}',
        '<<<END_UPDATES_JSON>>>',
        '',
        '【第二步】再輸出以下三個 Markdown 分析區塊：',
        '',
        '## 高互動貼文的共同特徵',
        '（列點說明：開頭方式、句子長度、情緒強度、是否有問句、切入角度等）',
        '',
        '## 低互動貼文的問題所在',
        '（列點說明：哪些寫法讓讀者沒有反應）',
        '',
        '## 對 data 層的具體修改建議',
        '（分成「brand.ts 建議修改」與「styles.ts 建議修改」兩段，',
        '直接給出可以貼上的文字，不要只說「應該更好」這種空話）',
    ].join('\n');

    // 優先 Claude Haiku；餘額不足自動退回 HF
    try {
        return await callClaude(system, prompt, 3000);
    } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('credit balance') || msg.includes('billing')) {
            console.warn('⚠️  Claude 餘額不足，退回使用 Hugging Face（繁體中文品質可能略差，自動更新可能無法執行）');
            console.warn('   充值：https://console.anthropic.com/settings/billing');
            const hfPrompt = `請全程使用繁體中文回應，嚴禁使用簡體中文。\n\n${prompt}`;
            return callChatCompletion(
                'Qwen/Qwen2.5-7B-Instruct',
                [{ role: 'user', content: hfPrompt }],
                0.5,
                2000,
            );
        }
        throw err;
    }
}

// ─── 報告儲存 ────────────────────────────────────────────────────────────────

function saveReport(content: string, weekStart: string): string {
    mkdirSync(REPORTS_DIR, { recursive: true });
    const filePath = join(REPORTS_DIR, `${weekStart}.md`);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

export type WeeklyReportResult =
    | { success: true; reportPath: string; totalPosts: number; weekStart: string }
    | { success: false; error: string };

/**
 * 完整週報流程：
 *   1. 取得可用 Token（接近到期才刷新）
 *   2. 取得過去 7 天貼文列表
 *   3. 逐篇取得互動數據
 *   4. AI 分析高低互動差異，產出 Markdown + JSON 更新區塊
 *   5. 自動寫回 brand.ts / styles.ts
 *   6. 儲存週報至 docs/reports/YYYY-MM-DD.md
 */
export async function runWeeklyReport(): Promise<WeeklyReportResult> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekStart = weekAgo.toISOString().split('T')[0];

    console.log(`📅 分析週期：${weekStart} ～ ${now.toISOString().split('T')[0]}`);
    console.log('\n🔑 讀取 Token...');
    const token = await getUsableToken();

    console.log('\n📥 取得過去 7 天的貼文...');
    const posts = await fetchMyPosts(token, weekAgo.toISOString());
    if (posts.length === 0) {
        return { success: false, error: '過去 7 天內沒有貼文，無法產生報告。' };
    }
    console.log(`   找到 ${posts.length} 篇貼文`);

    console.log('\n📊 取得各篇貼文的互動數據...');
    const insights: PostInsights[] = [];
    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        process.stdout.write(`   [${i + 1}/${posts.length}] ${post.id}... `);
        try {
            const data = await fetchPostInsights(post.id, post.text, post.timestamp, token);
            insights.push(data);
            process.stdout.write(`✅ 分數 ${data.engagementScore}\n`);
        } catch (err) {
            process.stdout.write(`⚠️  跳過（${err instanceof Error ? err.message : '未知錯誤'}）\n`);
        }
        if (i < posts.length - 1) await new Promise(r => setTimeout(r, 120));
    }
    if (insights.length === 0) {
        return { success: false, error: '所有貼文的互動數據取得失敗。' };
    }

    const sorted = [...insights].sort((a, b) => b.engagementScore - a.engagementScore);
    const topPosts = sorted.slice(0, Math.min(TOP_POSTS_COUNT, sorted.length));
    const lowPosts = sorted.slice(-Math.min(TOP_POSTS_COUNT, sorted.length)).reverse();

    console.log('\n🤖 AI 正在分析貼文模式...');
    const rawAiOutput = await analyzeWithAI(topPosts, lowPosts);

    // 解析並套用 data 層更新
    console.log('\n🔧 自動更新 data 層...');
    const updates = parseDataUpdates(rawAiOutput);
    if (updates) {
        const log = applyDataUpdates(updates);
        log.forEach(line => console.log(`   ${line}`));
    } else {
        console.log('   ⚠️  未解析到結構化更新區塊，跳過自動更新（手動參考報告中的建議）');
    }

    // 從報告中移除 JSON 區塊，只保留 Markdown 分析
    const aiAnalysis = stripUpdatesBlock(rawAiOutput);

    const totalEngagement = insights.reduce((sum, p) => sum + p.engagementScore, 0);
    const avgEngagement = Math.round(totalEngagement / insights.length);
    const topPost = sorted[0];

    const reportLines = [
        `# GlowPulse 週報 ${weekStart}`,
        '',
        '## 數據總覽',
        '',
        '| 指標 | 數值 |',
        '|---|---|',
        `| 分析週期 | ${weekStart} ～ ${now.toISOString().split('T')[0]} |`,
        `| 發文總篇數 | ${insights.length} 篇 |`,
        `| 平均互動分數 | ${avgEngagement} |`,
        `| 最高互動分數 | ${topPost.engagementScore}（${new Date(topPost.timestamp).toLocaleDateString('zh-TW')}）|`,
        '',
        '## 本週最佳貼文',
        '',
        '```',
        topPost.text,
        '```',
        '',
        `觀看 ${topPost.views} ｜ 按讚 ${topPost.likes} ｜ 回覆 ${topPost.replies} ｜ 轉發 ${topPost.reposts} ｜ 引用 ${topPost.quotes}`,
        '',
        '## 所有貼文排名',
        '',
        '| 排名 | 日期 | 分數 | 貼文摘要 |',
        '|---|---|---|---|',
        ...sorted.map((p, i) => {
            const date = new Date(p.timestamp).toLocaleDateString('zh-TW');
            const preview = p.text.slice(0, 30).replace(/\n/g, ' ') + (p.text.length > 30 ? '…' : '');
            return `| ${i + 1} | ${date} | ${p.engagementScore} | ${preview} |`;
        }),
        '',
        '---',
        '',
        aiAnalysis,
        '',
        '---',
        '',
        `*由 GlowPulse 自動產生於 ${now.toLocaleString('zh-TW')}*`,
    ];

    const reportPath = saveReport(reportLines.join('\n'), weekStart);
    console.log(`\n📝 報告已儲存至：${reportPath}`);
    return { success: true, reportPath, totalPosts: insights.length, weekStart };
}
