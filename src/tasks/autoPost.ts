// 任務：生成今日 GlowMoment 宣傳貼文並發布到 Threads
// 此模組只 export 函式，不含 top-level 副作用，由 agent 決定何時呼叫

import { BRAND_CONTEXT } from '../data/brand.js';
import { GLOWMOMENT_FEATURES, type Feature } from '../data/features.js';
import { confirmAction } from '../utils/confirm.js';
import { POST_STYLES, type PostStyle } from '../data/styles.js';
import { callChatCompletion } from '../services/hf.js';
import { getUsableToken, createContainer, publishContainer } from '../services/threads.js';

export type AutoPostResult =
    | { success: true; postId: string; content: string; feature: string; style: string }
    | { success: false; error: string };

/**
 * 根據今天是今年第幾天決定功能與風格
 * 用日期而非隨機，確保每天執行結果一致（可重現），且 8×3 = 24 天一個循環不重疊
 */
function getTodaysConfig(): { feature: Feature; style: PostStyle } {
    const now = new Date();
    const dayOfYear = Math.floor(
        (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000,
    );
    return {
        feature: GLOWMOMENT_FEATURES[dayOfYear % GLOWMOMENT_FEATURES.length],
        style: POST_STYLES[dayOfYear % POST_STYLES.length],
    };
}

async function generateContent(feature: Feature, style: PostStyle): Promise<string> {
    const userPrompt = [
        `今天要介紹的功能：「${feature.name}」`,
        ``,
        `目標客群的痛點：${feature.pain}`,
        `GlowMoment 的解法：${feature.solution}`,
        `建議的切入角度：${feature.hook}`,
        ``,
        `發文風格要求：${style.instruction}`,
        ``,
        `請依照以上資訊，寫出一則 Threads 貼文。只輸出貼文本身，不要加任何前言或說明。`,
    ].join('\n');

    return callChatCompletion('Qwen/Qwen2.5-7B-Instruct', [
        { role: 'system', content: BRAND_CONTEXT },
        { role: 'user', content: userPrompt },
    ]);
}
/**
 * 完整的自動發文流程：取得可用 Token → 生成內容 → 建立容器 → 發布
 */
export async function runAutoPost(): Promise<AutoPostResult> {
    const { feature, style } = getTodaysConfig();

    console.log(`📌 今日功能：${feature.name}`);
    console.log(`🎨 今日風格：${style.name}`);

    console.log('\n🔑 讀取 Threads Access Token...');
    const token = await getUsableToken();

    console.log('\n🤖 正在生成貼文內容...');
    const content = await generateContent(feature, style);
    console.log('\n📄 生成的貼文內容：');
    console.log('─'.repeat(40));
    console.log(content);
    console.log('─'.repeat(40));
    const shouldPublish = await confirmAction('是否要發布這則貼文到 Threads？');
    if (!shouldPublish) {
        return {
            success: false,
            error: '已取消發布（測試模式）。',
        };
    }
    console.log('\n📦 正在建立 Threads 媒體容器...');
    const containerId = await createContainer(content, token);
    console.log(`✅ 容器建立成功，ID：${containerId}`);

    console.log('\n🚀 正在發布貼文...');
    const postId = await publishContainer(containerId, token);
    console.log(`✅ 貼文發布成功，Post ID：${postId}`);

    return { success: true, postId, content, feature: feature.name, style: style.name };
}
