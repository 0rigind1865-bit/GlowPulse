// 任務：讀取截圖 → AI 生成畫面描述 → 生成圖片搭配文案 → 發布到 Threads
// 流程與 autoPost.ts 相似，差異在多了視覺描述步驟，且發布的是圖片貼文

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_CONTEXT } from '../data/brand.js';
import { GLOWMOMENT_FEATURES } from '../data/features.js';
import { POST_STYLES, type PostStyle } from '../data/styles.js';
import { SCREENSHOTS, type Screenshot } from '../data/screenshots.js';
import { callVisionDescription, callChatCompletion } from '../services/hf.js';
import { refreshToken, createImageContainer, publishContainer } from '../services/threads.js';

// assets/screenshots/ 的絕對路徑
const SCREENSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../assets/screenshots');

export type ImagePostResult =
    | { success: true; postId: string; caption: string; filename: string; feature: string }
    | { success: false; error: string };

// ─── 選取今日截圖 ────────────────────────────────────────────────────────────

/**
 * 依今年第幾天從截圖清單中輪替選出今日截圖與對應風格
 * 與 autoPost 共用相同的日期輪替邏輯，確保可重現
 */
function getTodaysConfig(): { screenshot: Screenshot; style: PostStyle } {
    const now = new Date();
    const dayOfYear = Math.floor(
        (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000,
    );
    return {
        screenshot: SCREENSHOTS[dayOfYear % SCREENSHOTS.length],
        style: POST_STYLES[dayOfYear % POST_STYLES.length],
    };
}

// ─── 視覺描述 ────────────────────────────────────────────────────────────────

/**
 * 讀取本機截圖檔案並轉換為 base64，送入視覺模型取得繁體中文畫面描述
 * @param filename - assets/screenshots/ 下的檔名
 * @returns 截圖的繁體中文描述文字
 */
async function describeScreenshot(filename: string): Promise<string> {
    const filePath = join(SCREENSHOTS_DIR, filename);
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString('base64');

    // 依副檔名判斷 MIME 類型
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeType =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        ext === 'webp'                   ? 'image/webp' :
                                           'image/png';

    return callVisionDescription(base64, mimeType);
}

// ─── 文案生成 ────────────────────────────────────────────────────────────────

/**
 * 根據截圖描述 + 對應功能資訊 + 品牌語氣生成圖片搭配文案
 * 與 autoPost 的 generateContent 邏輯相同，差異在多了截圖畫面描述作為視覺 context
 */
async function generateCaption(
    visualDesc: string,
    screenshot: Screenshot,
    style: PostStyle,
): Promise<string> {
    // 從 features.ts 找出與截圖對應的功能資訊
    const feature = GLOWMOMENT_FEATURES.find(f => f.name === screenshot.featureName);
    const featureContext = feature
        ? [
            `目標客群的痛點：${feature.pain}`,
            `GlowMoment 的解法：${feature.solution}`,
            `建議的切入角度：${feature.hook}`,
          ].join('\n')
        : `這張截圖展示的是 GlowMoment 的「${screenshot.featureName}」功能`;

    const userPrompt = [
        `這是一張 GlowMoment 產品截圖，畫面內容如下：`,
        `${visualDesc}`,
        ``,
        `截圖展示的功能：「${screenshot.featureName}」`,
        featureContext,
        ``,
        `發文風格要求：${style.instruction}`,
        ``,
        `請根據截圖內容與功能資訊，寫出一則適合搭配這張圖片的 Threads 貼文說明文字。`,
        `文字要能讓沒看過圖片的人也能理解產品價值，看過圖片的人更能產生共鳴。`,
        `只輸出貼文本身，不要加任何前言或說明。`,
    ].join('\n');

    return callChatCompletion('Qwen/Qwen2.5-7B-Instruct', [
        { role: 'system', content: BRAND_CONTEXT },
        { role: 'user',   content: userPrompt },
    ]);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 完整的圖片貼文流程：
 *   1. 選取今日截圖
 *   2. 讀取截圖 → AI 生成繁體中文畫面描述
 *   3. 結合描述 + 功能資訊 → AI 生成貼文文案
 *   4. 刷新 Token → 建立圖片容器（使用 GitHub raw URL）→ 發布
 */
export async function runImagePost(): Promise<ImagePostResult> {
    if (SCREENSHOTS.length === 0) {
        return {
            success: false,
            error: '截圖清單為空。請先將截圖 commit 至 GitHub，並在 src/data/screenshots.ts 中填入對應的記錄。',
        };
    }

    const { screenshot, style } = getTodaysConfig();

    console.log(`🖼️  今日截圖：${screenshot.filename}`);
    console.log(`📌 對應功能：${screenshot.featureName}`);
    console.log(`🎨 發文風格：${style.name}`);

    // 步驟一：視覺描述
    console.log('\n👁️  AI 正在分析截圖畫面...');
    const visualDesc = await describeScreenshot(screenshot.filename);
    console.log('\n📋 截圖描述：');
    console.log('─'.repeat(40));
    console.log(visualDesc);
    console.log('─'.repeat(40));

    // 步驟二：文案生成
    console.log('\n🤖 正在生成圖片搭配文案...');
    const caption = await generateCaption(visualDesc, screenshot, style);
    console.log('\n📄 生成的貼文文案：');
    console.log('─'.repeat(40));
    console.log(caption);
    console.log('─'.repeat(40));

    // 步驟三：發布
    console.log('\n🔑 正在刷新 Threads Access Token...');
    const token = await refreshToken();

    console.log('\n📦 正在建立 Threads 圖片容器...');
    const containerId = await createImageContainer(screenshot.githubUrl, caption, token);
    console.log(`✅ 容器建立成功，ID：${containerId}`);

    console.log('\n🚀 正在發布圖片貼文...');
    const postId = await publishContainer(containerId, token);
    console.log(`✅ 圖片貼文發布成功，Post ID：${postId}`);

    return { success: true, postId, caption, filename: screenshot.filename, feature: screenshot.featureName };
}
