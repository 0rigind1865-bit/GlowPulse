// 任務：掃描自己最近貼文的留言，找出潛在客戶並回覆
// 流程：取得近期貼文 → 拉每篇的留言 → 分類 → 逐一確認 → 發布回覆

import { BRAND_CONTEXT } from '../data/brand.js';
import { generate } from '../services/generate.js';
import { callZeroShot } from '../services/hf.js';
import { confirmAction } from '../utils/confirm.js';
import {
    getUsableToken,
    fetchMyPosts,
    getPostReplies,
    createReplyContainer,
    waitForContainerReady,
    publishContainer,
    waitForPostReady,
    type ThreadsReply,
} from '../services/threads.js';

export type EngageResult =
    | { success: true; postsScanned: number; repliesAnalyzed: number; replied: number }
    | { success: false; error: string };

// 零樣本分類的潛在客戶標籤（與 analyzeReply.ts 保持一致）
const CANDIDATE_LABELS = ['預約需求', '美容抱怨', '日常生活', '商業廣告'] as const;
const POTENTIAL_CLIENT_LABELS = ['預約需求', '美容抱怨'];

/** 掃描最近幾天的貼文（預設 7 天） */
const SCAN_DAYS = 7;

/**
 * 針對一則留言生成回覆文案
 */
async function generateReply(replyContent: string): Promise<string> {
    const prompt = [
        '請針對以下 Threads 留言，寫出一則 50 字以內的回覆。',
        '要求：口吻親切、像真人而非機器人，並自然提到「GlowMoment 預約系統」能解決預約痛點。',
        `留言內容：${replyContent}`,
    ].join('\n');
    return generate('intentReply', BRAND_CONTEXT, prompt, 100, 0.7);
}

/**
 * 發布一則回覆留言（含容器狀態輪詢）
 * @returns 已發布的回覆 Post ID
 */
async function postReply(targetPostId: string, replyText: string, token: string): Promise<string> {
    await waitForPostReady(targetPostId, token);
    const containerId = await createReplyContainer(replyText, targetPostId, token);
    const { status, errorMessage } = await waitForContainerReady(containerId, token);

    if (status === 'PUBLISHED') return containerId;
    if (status === 'FINISHED') return publishContainer(containerId, token);
    throw new Error(`回覆容器狀態異常（${status}）：${errorMessage ?? '未知原因'}`);
}

/**
 * 完整的 engage 流程：
 *   取近期自己的貼文 → 拉每篇留言 → 分類潛在客戶 → 逐一確認並回覆
 *
 * @param scanDays - 往前掃描幾天的貼文（預設 7 天）
 */
export async function runEngage(scanDays = SCAN_DAYS): Promise<EngageResult> {
    console.log(`\n🔑 讀取 Threads Access Token...`);
    const token = await getUsableToken();

    // ── 步驟 1：取得近期自己的貼文 ──────────────────────────────────────────
    const since = new Date(Date.now() - scanDays * 86_400_000).toISOString();
    console.log(`\n📋 掃描最近 ${scanDays} 天的貼文（${since.slice(0, 10)} 之後）...`);
    const myPosts = await fetchMyPosts(token, since);
    console.log(`   找到 ${myPosts.length} 篇貼文`);

    if (myPosts.length === 0) {
        return { success: true, postsScanned: 0, repliesAnalyzed: 0, replied: 0 };
    }

    // ── 步驟 2：對每篇貼文取得留言 ───────────────────────────────────────────
    let totalAnalyzed = 0;
    let totalReplied = 0;
    const potentialLeads: Array<{ reply: ThreadsReply; parentPostId: string; parentText: string }> = [];

    for (const post of myPosts) {
        const preview = post.text.slice(0, 30).replace(/\n/g, ' ');
        process.stdout.write(`   📝 「${preview}…」 — 取得留言中...`);
        const replies = await getPostReplies(post.id, token);
        process.stdout.write(` ${replies.length} 則\n`);

        for (const reply of replies) {
            totalAnalyzed++;
            const classification = await callZeroShot(reply.text, [...CANDIDATE_LABELS]);
            const topLabel = classification[0]?.label ?? '';
            if (POTENTIAL_CLIENT_LABELS.includes(topLabel)) {
                potentialLeads.push({ reply, parentPostId: post.id, parentText: post.text });
            }
        }
    }

    console.log(`\n📊 分析完畢：${totalAnalyzed} 則留言中，找到 ${potentialLeads.length} 則潛在客戶留言`);

    if (potentialLeads.length === 0) {
        console.log('   沒有需要回覆的留言。');
        return {
            success: true,
            postsScanned: myPosts.length,
            repliesAnalyzed: totalAnalyzed,
            replied: 0,
        };
    }

    // ── 步驟 3：逐一確認並回覆 ───────────────────────────────────────────────
    console.log('\n' + '═'.repeat(50));
    for (let i = 0; i < potentialLeads.length; i++) {
        const { reply, parentPostId, parentText } = potentialLeads[i];
        const parentPreview = parentText.slice(0, 40).replace(/\n/g, ' ');

        console.log(`\n[${i + 1}/${potentialLeads.length}] @${reply.username} 在你的貼文底下留言：`);
        console.log(`   原始貼文：「${parentPreview}…」`);
        console.log('─'.repeat(40));
        console.log(reply.text);
        console.log('─'.repeat(40));

        // 生成回覆建議
        console.log('\n🤖 正在生成回覆...');
        const replyContent = await generateReply(reply.text);
        console.log('\n💬 建議回覆：');
        console.log('─'.repeat(40));
        console.log(replyContent);
        console.log('─'.repeat(40));
        console.log(`（${replyContent.length} 字元）`);

        const shouldPost = await confirmAction(`是否要回覆 @${reply.username} ？`);
        if (!shouldPost) {
            console.log('   ⏭️  略過。');
            continue;
        }

        try {
            console.log('\n📦 發布回覆中...');
            const replyPostId = await postReply(reply.id, replyContent, token);
            console.log(`✅ 已回覆，Reply Post ID：${replyPostId}`);
            totalReplied++;
        } catch (err) {
            console.error(`❌ 回覆失敗：${err instanceof Error ? err.message : err}`);
        }
    }

    console.log('\n' + '═'.repeat(50));
    console.log(`\n🎉 Engage 完成！掃描 ${myPosts.length} 篇貼文 · 分析 ${totalAnalyzed} 則留言 · 回覆 ${totalReplied} 則`);

    return {
        success: true,
        postsScanned: myPosts.length,
        repliesAnalyzed: totalAnalyzed,
        replied: totalReplied,
    };
}
