// 任務：分析 Threads 貼文意圖，對潛在客戶貼文產出回覆文案
// 此模組只 export 函式，不含 top-level 副作用，由 agent 決定何時呼叫

import { BRAND_CONTEXT } from '../data/brand.js';
import { generate } from '../services/generate.js';
import { callZeroShot } from '../services/hf.js';

// 零樣本分類的候選標籤，僅前兩個視為潛在客戶
const CANDIDATE_LABELS = ['預約需求', '美容抱怨', '日常生活', '商業廣告'] as const;
const POTENTIAL_CLIENT_LABELS: string[] = ['預約需求', '美容抱怨'];

/**
 * 分析一則 Threads 貼文，判斷是否為潛在客戶並產出回覆文案
 * 流程：零樣本分類（意圖識別）→ 判斷是否潛在客戶 → 生成回覆
 * @param postContent - 原始貼文文字
 * @returns 回覆文字（若為潛在客戶）；null（若不需回覆）
 */
export async function analyzeAndReply(postContent: string): Promise<string | null> {
    // 步驟 A：零樣本分類，判斷貼文意圖
    const classification = await callZeroShot(postContent, [...CANDIDATE_LABELS]);
    const topLabel = classification[0]?.label;

    // 只有「預約需求」和「美容抱怨」才值得主動回覆，其他類型略過
    if (!topLabel || !POTENTIAL_CLIENT_LABELS.includes(topLabel)) {
        return null;
    }

    // 步驟 B：對潛在客戶貼文生成親切自然的品牌回覆
    const replyPrompt = [
        '請針對以下 Threads 貼文內容，寫出一則 50 字以內的回覆。',
        '要求：口吻親切、像真人而非機器人，並自然提到「GlowMoment 預約系統」能解決預約痛點。',
        `貼文內容：${postContent}`,
    ].join('\n');

    return generate('intentReply', BRAND_CONTEXT, replyPrompt, 100, 0.7);
}
