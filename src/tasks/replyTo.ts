// 任務：分析指定的 Threads 貼文，若判定為潛在客戶則直接發布回覆
// 接受貼文 URL 或數字 ID；無法取得貼文內容時改由使用者手動貼上

import { BRAND_CONTEXT } from '../data/brand.js';
import { generate } from '../services/generate.js';
import { callZeroShot } from '../services/hf.js';
import { confirmAction } from '../utils/confirm.js';
import {
    getUsableToken,
    parseThreadsPostId,
    getPost,
    createReplyContainer,
    waitForContainerReady,
    publishContainer,
    waitForPostReady,
} from '../services/threads.js';
import * as readline from 'readline';

export type ReplyToResult =
    | { success: true; targetPostId: string; replyPostId: string; replyContent: string }
    | { success: false; error: string; skipped?: boolean };

// 零樣本分類的潛在客戶標籤（與 analyzeReply.ts 保持一致）
const CANDIDATE_LABELS = ['預約需求', '美容抱怨', '日常生活', '商業廣告'] as const;
const POTENTIAL_CLIENT_LABELS = ['預約需求', '美容抱怨'];

/**
 * 若 API 無法自動取得貼文內容，改用互動式提示請使用者手動貼上
 */
async function askForPostContent(): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question('\n📋 請貼上貼文內容（按 Enter 確認）：', answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * 針對一則貼文生成回覆文案
 */
async function generateReply(postContent: string): Promise<string> {
    const replyPrompt = [
        '請針對以下 Threads 貼文內容，寫出一則 50 字以內的回覆。',
        '要求：口吻親切、像真人而非機器人，並自然提到「GlowMoment 預約系統」能解決預約痛點。',
        `貼文內容：${postContent}`,
    ].join('\n');
    return generate('intentReply', BRAND_CONTEXT, replyPrompt, 100, 0.7);
}

/**
 * 回覆指定 Threads 貼文的完整流程：
 *   解析 ID → 取得貼文內容 → 零樣本分類 → 生成回覆 → 確認 → 發布
 *
 * @param input - Threads 貼文 URL 或數字 ID
 */
export async function runReplyTo(input: string): Promise<ReplyToResult> {
    // ── 步驟 1：解析 post ID ─────────────────────────────────────────────────
    let postId: string;
    try {
        postId = parseThreadsPostId(input);
    } catch (e) {
        return { success: false, error: String(e) };
    }
    console.log(`🔗 目標貼文 ID：${postId}`);

    // ── 步驟 2：取得 Token ──────────────────────────────────────────────────
    console.log('\n🔑 讀取 Threads Access Token...');
    const token = await getUsableToken();

    // ── 步驟 3：取得貼文內容（失敗時請使用者手動提供）──────────────────────
    let postContent: string;
    let postAuthor = '（未知）';
    try {
        const post = await getPost(postId, token);
        postContent = post.text;
        postAuthor = post.username;
        console.log(`\n📝 貼文作者：@${postAuthor}`);
    } catch {
        console.warn('\n⚠️  無法透過 API 取得貼文內容（貼文可能不公開，或需要進階權限）。');
        postContent = await askForPostContent();
        if (!postContent) {
            return { success: false, error: '未提供貼文內容，已取消。' };
        }
    }

    console.log('\n貼文內容：');
    console.log('─'.repeat(40));
    console.log(postContent);
    console.log('─'.repeat(40));

    // ── 步驟 4：零樣本分類，判斷是否值得回覆 ─────────────────────────────
    console.log('\n🔍 分析貼文意圖...');
    const classification = await callZeroShot(postContent, [...CANDIDATE_LABELS]);
    const topLabel = classification[0]?.label ?? '';
    const topScore = ((classification[0]?.score ?? 0) * 100).toFixed(0);
    console.log(`   分類結果：${topLabel}（信心 ${topScore}%）`);

    if (!POTENTIAL_CLIENT_LABELS.includes(topLabel)) {
        console.log('\n⏭️  此貼文不屬於潛在客戶（類別：' + topLabel + '），略過。');
        return { success: false, error: '非潛在客戶貼文', skipped: true };
    }

    // ── 步驟 5：生成回覆文案 ───────────────────────────────────────────────
    console.log('\n🤖 正在生成回覆...');
    const replyContent = await generateReply(postContent);

    console.log('\n💬 建議回覆：');
    console.log('─'.repeat(40));
    console.log(replyContent);
    console.log('─'.repeat(40));
    console.log(`（${replyContent.length} 字元）`);

    // ── 步驟 6：使用者確認 ─────────────────────────────────────────────────
    const shouldPost = await confirmAction(`是否要回覆 @${postAuthor} 的這則貼文？`);
    if (!shouldPost) {
        return { success: false, error: '已取消回覆。' };
    }

    // ── 步驟 7：等待目標貼文就緒，發布回覆 ───────────────────────────────
    console.log('\n⏳ 確認目標貼文狀態...');
    await waitForPostReady(postId, token);

    console.log('\n📦 建立回覆容器...');
    const containerID = await createReplyContainer(replyContent, postId, token);

    const { status, errorMessage } = await waitForContainerReady(containerID, token);
    console.log(`   容器狀態：${status}`);

    let replyPostId: string;
    if (status === 'PUBLISHED') {
        replyPostId = containerID;
        console.log(`✅ 回覆已自動發布，Reply Post ID：${replyPostId}`);
    } else if (status === 'FINISHED') {
        console.log('🚀 發布回覆...');
        replyPostId = await publishContainer(containerID, token);
        console.log(`✅ 回覆已發布，Reply Post ID：${replyPostId}`);
    } else {
        throw new Error(`回覆容器狀態異常（${status}）：${errorMessage ?? '未知原因'}`);
    }

    console.log('   （請至目標貼文的串留言查看）');
    return { success: true, targetPostId: postId, replyPostId, replyContent };
}
