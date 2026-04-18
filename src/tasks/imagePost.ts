// 任務：讀取截圖 → AI 生成畫面描述 → 生成圖片搭配文案 → 發布到 Threads
// 流程與 autoPost.ts 相似，差異在多了視覺描述步驟，且發布的是圖片貼文

import { BRAND_CONTEXT } from '../data/brand.js';
import { readFile, writeFile } from 'node:fs/promises';
import { confirmAction } from '../utils/confirm.js';
import { handleOverflow } from '../utils/publish.js';
import { GLOWMOMENT_FEATURES, type Feature } from '../data/features.js';
import { POST_STYLES, type PostStyle } from '../data/styles.js';
import { SCREENSHOTS, type Screenshot } from '../data/screenshots.js';
import { generate } from '../services/generate.js';
import { describeImageWithGemini, GeminiServiceError } from '../services/gemini.js';
import {
    getUsableToken,
    createImageContainer,
    createReplyContainer,
    waitForContainerReady,
    publishContainer,
    waitForPostReady,
} from '../services/threads.js';

export type ImagePostResult =
    | { success: true; postId: string; caption: string; filename: string; feature: string }
    | { success: false; error: string };

const SCREENSHOTS_DATA_PATH = new URL('../data/screenshots.ts', import.meta.url);
const FEATURES_DATA_PATH = new URL('../data/features.ts', import.meta.url);

// ─── 選取今日截圖 ────────────────────────────────────────────────────────────

/**
 * 依今年第幾天從截圖清單中輪替選出今日截圖與對應風格
 * 與 autoPost 共用相同的日期輪替邏輯，確保可重現
 */
function getTodaysConfig(useLatest = false): { screenshot: Screenshot; style: PostStyle } {
    return {
        screenshot: useLatest
            ? SCREENSHOTS[SCREENSHOTS.length - 1]           // 最新加入的截圖（陣列最後一筆）
            : SCREENSHOTS[Math.floor(Math.random() * SCREENSHOTS.length)],
        style: POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)],
    };
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
    forceShorter = false,
    maxChars?: number,
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

    const visualInsights = await analyzeVisualDescription(visualDesc, screenshot, featureContext);

    const userPrompt = [
        `這是一張 GlowMoment 產品截圖，畫面內容如下：`,
        `${visualDesc}`,
        ``,
        `請優先參考以下「畫面分析重點」來生成貼文，避免圖文不符：`,
        `${visualInsights}`,
        ``,
        `截圖展示的功能：「${screenshot.featureName}」`,
        featureContext,
        ``,
        `發文風格要求：${style.instruction}`,
        ``,
        `請根據截圖內容與功能資訊，寫出一則適合搭配這張圖片的 Threads 貼文說明文字。`,
        `文字要能讓沒看過圖片的人也能理解產品價值，看過圖片的人更能產生共鳴。`,
        (() => {
            const charLimit = maxChars ?? (forceShorter ? 450 : null);
            return charLimit !== null
                ? `重要限制：全文（含 hashtag）必須嚴格控制在 ${charLimit} 字元以內，這是硬性要求。`
                : '';
        })(),
        `只輸出貼文本身，不要加任何前言或說明。`,
    ].filter(Boolean).join('\n');

    return generate('imageCaption', BRAND_CONTEXT, userPrompt, 180, 0.85);
}

/**
 * 將 Gemini 的原始畫面描述轉成可直接用於發文的結構化重點，降低圖文不符風險。
 */
async function analyzeVisualDescription(
    visualDesc: string,
    screenshot: Screenshot,
    featureContext: string,
): Promise<string> {
    const prompt = [
        `你是一位產品社群編輯，請分析以下截圖描述，輸出發文可用的重點。`,
        ``,
        `截圖功能：${screenshot.featureName}`,
        `功能背景：`,
        featureContext,
        ``,
        `截圖描述：`,
        visualDesc,
        ``,
        `請嚴格用繁體中文輸出，格式固定為三行：`,
        `畫面事實：...（只能寫描述中可直接觀察到的內容）`,
        `使用者價值：...（從畫面事實推導出的價值）`,
        `發文切角：...（最適合的一句主軸）`,
        `不要輸出其他內容。`,
    ].join('\n');

    return generate('visualAnalysis', '你是精準的產品畫面分析助理。只輸出繁體中文。', prompt, 220, 0.2);
}

async function generateFeatureFromDescription(visualDesc: string): Promise<Feature> {
    const featureNames = GLOWMOMENT_FEATURES.map(f => f.name);
    const prompt = [
        '請根據截圖描述，產生一筆可加入 GLOWMOMENT_FEATURES 的功能資料。',
        '若候選名稱已經很貼切，可以沿用；否則建立新名稱。',
        '請只輸出 JSON，格式如下：',
        '{"name":"...","pain":"...","solution":"...","hook":"..."}',
        'name 請 8~18 字，且必須繁體中文。',
        'pain/solution/hook 必須是繁體中文，且內容具體可用。',
        '',
        `候選功能：${featureNames.join('、')}`,
        '',
        '截圖描述：',
        visualDesc,
    ].join('\n');

    const raw = await generate('visualAnalysis', '你是產品功能規劃助手。必須回傳合法 JSON，不可輸出多餘文字。', prompt, 320, 0.2);

    const parsed = tryParseJson(raw);
    if (!parsed) {
        throw new Error(`無法解析功能 JSON，模型輸出：${raw}`);
    }

    const name = sanitizeFeatureName(typeof parsed.name === 'string' ? parsed.name : '');
    const pain = sanitizeFeatureText(typeof parsed.pain === 'string' ? parsed.pain : '');
    const solution = sanitizeFeatureText(typeof parsed.solution === 'string' ? parsed.solution : '');
    const hook = sanitizeFeatureText(typeof parsed.hook === 'string' ? parsed.hook : '');

    if (!name || !pain || !solution || !hook) {
        throw new Error(`功能 JSON 欄位不完整，模型輸出：${raw}`);
    }

    return { name, pain, solution, hook };
}

function tryParseJson(raw: string): Record<string, unknown> | null {
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        const block = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!block) return null;
        try {
            return JSON.parse(block) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
}

function sanitizeFeatureName(name: string): string {
    return name
        .replace(/[「」"'`]/g, '')
        .replace(/\s+/g, '')
        .slice(0, 20);
}

function sanitizeFeatureText(text: string): string {
    return text
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function ensureFeatureInDataFile(feature: Feature): Promise<string> {
    const existing = GLOWMOMENT_FEATURES.find(f => f.name === feature.name);
    if (existing) {
        return existing.name;
    }

    const source = await readFile(FEATURES_DATA_PATH, 'utf8');
    const insertBlock = [
        '    {',
        `        name: '${escapeForSingleQuote(feature.name)}',`,
        `        pain: '${escapeForSingleQuote(feature.pain)}',`,
        `        solution: '${escapeForSingleQuote(feature.solution)}',`,
        `        hook: '${escapeForSingleQuote(feature.hook)}',`,
        '    },',
    ].join('\n');

    const marker = 'export const GLOWMOMENT_FEATURES: Feature[] = [';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error('features.ts 格式不符：找不到 GLOWMOMENT_FEATURES 宣告。');
    }

    const insertAt = source.indexOf('\n', markerIndex + marker.length);
    if (insertAt === -1) {
        throw new Error('features.ts 格式不符：無法定位插入位置。');
    }

    const next = `${source.slice(0, insertAt + 1)}${insertBlock}\n${source.slice(insertAt + 1)}`;
    await writeFile(FEATURES_DATA_PATH, next, 'utf8');
    return feature.name;
}

async function persistScreenshotMetadata(
    screenshot: Screenshot,
    featureName: string,
    description: string,
): Promise<void> {
    const source = await readFile(SCREENSHOTS_DATA_PATH, 'utf8');
    // [^{}]* 而非 [\s\S]*?：禁止穿越 {} 邊界，確保只匹配包含目標 filename 的那一筆 entry
    // screenshots.ts 的 entry 是扁平物件（無巢狀 {}），所以此限制安全且精確
    const entryPattern = new RegExp(`\\{[^{}]*filename:\\s*'${escapeRegExp(screenshot.filename)}'[^{}]*\\},`);
    const match = source.match(entryPattern);
    if (!match) {
        throw new Error(`找不到對應截圖記錄：${screenshot.filename}`);
    }

    const originalBlock = match[0];
    let updatedBlock = originalBlock.replace(/featureName:\s*'[^']*'/, `featureName: '${escapeForSingleQuote(featureName)}'`);

    if (/description:\s*'[^']*'/.test(updatedBlock)) {
        updatedBlock = updatedBlock.replace(/description:\s*'[^']*'/, `description: '${escapeForSingleQuote(description)}'`);
    } else {
        const indent = (updatedBlock.match(/^(\s*)featureName:\s*'[^']*',/m)?.[1] ?? '        ');
        updatedBlock = updatedBlock.replace(/(featureName:\s*'[^']*',)/, `$1\n${indent}description: '${escapeForSingleQuote(description)}',`);
    }

    const next = source.replace(originalBlock, updatedBlock);
    await writeFile(SCREENSHOTS_DATA_PATH, next, 'utf8');
}

function escapeForSingleQuote(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n');
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 完整的圖片貼文流程：
 *   1. 選取今日截圖
 *   2. 讀取截圖 → AI 生成繁體中文畫面描述
 *   3. 結合描述 + 功能資訊 → AI 生成貼文文案
 *   4. 刷新 Token → 建立圖片容器（使用 GitHub raw URL）→ 發布
 */
export async function runImagePost(maxChars?: number, useLatest = false): Promise<ImagePostResult> {
    if (SCREENSHOTS.length === 0) {
        return {
            success: false,
            error: '截圖清單為空。請先將截圖 commit 至 GitHub，並在 src/data/screenshots.ts 中填入對應的記錄。',
        };
    }

    const { screenshot, style } = getTodaysConfig(useLatest);
    if (useLatest) {
        console.log('🆕 使用最新截圖（--latest）');
    }

    // Meta API 要求圖片 URL 只能含 ASCII 字元
    // 中文、空格、特殊字元都會導致「影音素材 URI 不符合規定」錯誤
    if (/[^\x00-\x7F]/.test(screenshot.githubUrl)) {
        return {
            success: false,
            error: [
                `❌ 截圖檔名含有非 ASCII 字元，Meta API 不接受此 URL：`,
                `   ${screenshot.githubUrl}`,
                ``,
                `請將截圖檔名改為純英數字，例如：`,
                `   ✗ 截圖 2026-04-18 晚上8.14.31.png`,
                `   ✓ booking-confirm.png 或 screenshot-20260418.png`,
                ``,
                `步驟：`,
                `1. 在 assets/screenshots/ 重新命名檔案（只用英文、數字、連字號）`,
                `2. git add . && git commit && git push`,
                `3. 更新 src/data/screenshots.ts 的 filename 與 githubUrl`,
            ].join('\n'),
        };
    }

    let workingScreenshot = screenshot;

    console.log(`🖼️  今日截圖：${screenshot.filename}`);
    console.log(`📌 對應功能：${screenshot.featureName}`);
    console.log(`🎨 發文風格：${style.name}`);

    // 步驟一：視覺描述
    // 規則：只有 featureName 與 description 皆為空，才呼叫 Gemini 並回寫 screenshots.ts
    const isFeatureEmpty = !workingScreenshot.featureName.trim();
    const isDescEmpty = !workingScreenshot.description?.trim();

    let visualDesc: string;
    if (isFeatureEmpty && isDescEmpty) {
        console.log('\n👁️  Gemini 正在分析截圖畫面（首次建立快取）...');
        try {
            visualDesc = await describeImageWithGemini(workingScreenshot.githubUrl);
            const generatedFeature = await generateFeatureFromDescription(visualDesc);
            const finalFeatureName = await ensureFeatureInDataFile(generatedFeature);
            await persistScreenshotMetadata(workingScreenshot, finalFeatureName, visualDesc);

            workingScreenshot = {
                ...workingScreenshot,
                featureName: finalFeatureName,
                description: visualDesc,
            };
            console.log('✅ 已將 featureName 與 description 回寫到 src/data/screenshots.ts');
            console.log('✅ 已同步更新 src/data/features.ts 功能清單');
        } catch (error: unknown) {
            if (error instanceof GeminiServiceError) {
                if (error.code === 'QUOTA_EXCEEDED' || (error.code === 'MODEL_NOT_FOUND' && error.message.toLowerCase().includes('quota'))) {
                    return {
                        success: false,
                        error: '⚠️ Gemini 免費配額已用盡。\n解決方案：\n1. 升級至 https://ai.google.dev 付費版本\n2. 或手動在 src/data/screenshots.ts 填入 featureName 與 description',
                    };
                }
                if (error.code === 'MODEL_NOT_FOUND') {
                    return {
                        success: false,
                        error: '❌ Gemini 可用模型無法使用（可能 API Key 無效）。請檢查 https://ai.google.dev/',
                    };
                }
            }
            return {
                success: false,
                error: `❌ 無法建立截圖描述快取\n${error instanceof Error ? error.message : String(error)}`,
            };
        }
    } else if (!isFeatureEmpty && !isDescEmpty) {
        console.log('\n📋 使用 screenshots.ts 既有描述（不重跑 Gemini）');
        visualDesc = workingScreenshot.description!.trim();
    } else {
        return {
            success: false,
            error: '❌ screenshots.ts 資料不完整：featureName 與 description 需同時有值或同時為空。',
        };
    }

    console.log('\n📋 截圖描述：');
    console.log('─'.repeat(40));
    console.log(visualDesc);
    console.log('─'.repeat(40));

    // 步驟二：文案生成（先分析截圖描述，再生成貼文）
    if (maxChars) {
        console.log(`📏 字數限制：${maxChars} 字元以內`);
    }
    console.log('\n🤖 正在生成圖片搭配文案...');
    const draft = await generateCaption(visualDesc, workingScreenshot, style, false, maxChars);

    // 超限處理：使用者指定 maxChars 時以該值為閾值，否則用 Threads API 上限（500）
    const overflow = await handleOverflow(
        draft,
        () => generateCaption(visualDesc, workingScreenshot, style, true, maxChars),
        maxChars,
    );
    if (!overflow) {
        return { success: false, error: '已取消發布。' };
    }
    const { main: caption, reply: replyText } = overflow;

    console.log('\n📄 生成的貼文文案：');
    console.log('─'.repeat(40));
    console.log(caption);
    if (replyText) {
        console.log('\n💬 接續留言：');
        console.log(replyText);
    }
    console.log('─'.repeat(40));
    console.log(`（主貼文 ${caption.length} 字元${replyText ? `，留言 ${replyText.length} 字元` : ''}）`);

    const shouldPublish = await confirmAction(
        replyText ? '是否要發布圖片貼文＋接續留言到 Threads？' : '是否要發布這則圖片貼文到 Threads？',
    );
    if (!shouldPublish) {
        return { success: false, error: '已取消發布。' };
    }

    // 步驟三：發布
    console.log('\n🔑 讀取 Threads Access Token...');
    const token = await getUsableToken();

    console.log('\n📦 正在建立 Threads 圖片容器...');
    const containerId = await createImageContainer(workingScreenshot.githubUrl, caption, token);
    console.log('\n🚀 正在發布圖片貼文...');
    const postId = await publishContainer(containerId, token);
    console.log(`✅ 圖片貼文發布成功，Post ID：${postId}`);

    // 發布接續留言（若有）
    if (replyText) {
        // 輪詢等待主貼文在 Threads 系統中完全可查詢後，再建立 reply container
        console.log('\n⏳ 等待主貼文在 Threads 完成處理...');
        await waitForPostReady(postId, token);
        console.log('\n💬 正在建立接續留言容器...');
        const replyContainerId = await createReplyContainer(replyText, postId, token);
        console.log(`   留言容器 ID：${replyContainerId}`);

        const { status, errorMessage } = await waitForContainerReady(replyContainerId, token);
        console.log(`   容器狀態：${status}${errorMessage ? ` — ${errorMessage}` : ''}`);

        if (status === 'PUBLISHED') {
            console.log(`✅ 接續留言已自動發布，Reply Post ID：${replyContainerId}`);
        } else if (status === 'FINISHED') {
            console.log('🚀 正在發布接續留言...');
            const replyPostId = await publishContainer(replyContainerId, token);
            console.log(`✅ 接續留言已發布，Reply Post ID：${replyPostId}`);
        } else {
            throw new Error(`留言容器狀態異常（${status}）：${errorMessage ?? '未知原因'}`);
        }
        console.log('   （請點入原始貼文查看串留言，留言不會出現在個人頁列表）');
    }

    return { success: true, postId, caption, filename: workingScreenshot.filename, feature: workingScreenshot.featureName };
}
