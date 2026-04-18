// 任務：生成今日 GlowMoment 宣傳貼文並發布到 Threads
// 此模組只 export 函式，不含 top-level 副作用，由 agent 決定何時呼叫

import { BRAND_CONTEXT } from '../data/brand.js';
import { GLOWMOMENT_FEATURES, type Feature } from '../data/features.js';
import { confirmAction } from '../utils/confirm.js';
import { handleOverflow } from '../utils/publish.js';
import { POST_STYLES, type PostStyle } from '../data/styles.js';
import { generate } from '../services/generate.js';
import {
    getUsableToken,
    createContainer,
    createReplyContainer,
    publishContainer,
} from '../services/threads.js';

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

/**
 * @param forceShorter - true 時在 prompt 加入嚴格字數要求，用於使用者選擇重新生成時
 */
async function generateContent(
    feature: Feature,
    style: PostStyle,
    forceShorter = false,
): Promise<string> {
    const userPrompt = [
        `今天要介紹的功能：「${feature.name}」`,
        ``,
        `目標客群的痛點：${feature.pain}`,
        `GlowMoment 的解法：${feature.solution}`,
        `建議的切入角度：${feature.hook}`,
        ``,
        `發文風格要求：${style.instruction}`,
        ``,
        forceShorter
            ? `重要限制：全文（含 hashtag）必須嚴格控制在 450 字元以內，這是硬性要求。`
            : '',
        `請依照以上資訊，寫出一則 Threads 貼文。只輸出貼文本身，不要加任何前言或說明。`,
    ].filter(Boolean).join('\n');

    return generate('autoPost', BRAND_CONTEXT, userPrompt, 180, 0.85);
}

/**
 * 完整的自動發文流程：取得可用 Token → 生成內容 → 處理超限 → 建立容器 → 發布
 * 若內容超過 Threads 500 字元限制，會詢問使用者選擇重新生成或以留言接續
 */
export async function runAutoPost(): Promise<AutoPostResult> {
    const { feature, style } = getTodaysConfig();

    console.log(`📌 今日功能：${feature.name}`);
    console.log(`🎨 今日風格：${style.name}`);

    console.log('\n🔑 讀取 Threads Access Token...');
    const token = await getUsableToken();

    console.log('\n🤖 正在生成貼文內容...');
    let draft = await generateContent(feature, style);

    // 超限處理：讓使用者選擇重新生成或分割留言
    const overflow = await handleOverflow(draft, () => generateContent(feature, style, true));
    if (!overflow) {
        return { success: false, error: '已取消發布。' };
    }
    const { main: content, reply: replyText } = overflow;

    // 顯示最終內容供確認
    console.log('\n📄 生成的貼文內容：');
    console.log('─'.repeat(40));
    console.log(content);
    if (replyText) {
        console.log('\n💬 接續留言：');
        console.log(replyText);
    }
    console.log('─'.repeat(40));
    console.log(`（主貼文 ${content.length} 字元${replyText ? `，留言 ${replyText.length} 字元` : ''}）`);

    const shouldPublish = await confirmAction(
        replyText ? '是否要發布貼文＋接續留言到 Threads？' : '是否要發布這則貼文到 Threads？',
    );
    if (!shouldPublish) {
        return { success: false, error: '已取消發布。' };
    }

    // 發布主貼文
    console.log('\n📦 正在建立 Threads 媒體容器...');
    const containerId = await createContainer(content, token);
    console.log('\n🚀 正在發布貼文...');
    const postId = await publishContainer(containerId, token);
    console.log(`✅ 貼文發布成功，Post ID：${postId}`);

    // 發布接續留言（若有）
    if (replyText) {
        await new Promise(r => setTimeout(r, 1500)); // 等待主貼文建立完成
        console.log('\n💬 正在發布接續留言...');
        const replyContainerId = await createReplyContainer(replyText, postId, token);
        await publishContainer(replyContainerId, token);
        console.log('✅ 接續留言已發布');
    }

    return { success: true, postId, content, feature: feature.name, style: style.name };
}
