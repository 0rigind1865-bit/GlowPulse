// 共用發布輔助工具：處理 Threads 貼文超過字元限制的情境
// autoPost.ts 與 imagePost.ts 共用，避免重複邏輯

import { promptChoice } from './confirm.js';
import { THREADS_MAX_TEXT_LENGTH, splitForThread } from '../services/threads.js';

/** handleOverflow 回傳值：主貼文 + 接續留言（null 代表無需留言） */
export type OverflowResult = {
    main: string;
    reply: string | null;
};

/**
 * 偵測貼文是否超過 Threads 字元限制，若超過則詢問使用者處理方式：
 *   [1] 重新生成較短版本 — 呼叫 regenerateFn() 後重新檢查
 *   [2] 以第一則留言接續 — 在自然斷點切分，overflow 部分作為留言發布
 *   [3] 取消
 *
 * 若文字未超限，直接回傳 { main: text, reply: null }，不詢問。
 * 若使用者取消，回傳 null（呼叫端應視為取消整個發布流程）。
 *
 * @param text          - 待檢查的完整文字
 * @param regenerateFn  - 使用者選擇重新生成時呼叫的函式（應加入更嚴格的字數限制）
 */
export async function handleOverflow(
    text: string,
    regenerateFn: () => Promise<string>,
): Promise<OverflowResult | null> {
    if (text.length <= THREADS_MAX_TEXT_LENGTH) {
        return { main: text, reply: null };
    }

    console.log(
        `\n⚠️  生成的內容超過 Threads ${THREADS_MAX_TEXT_LENGTH} 字元限制` +
        `（目前 ${text.length} 字元）`,
    );

    const choice = await promptChoice('請選擇處理方式', [
        '重新生成較短版本',
        '以第一則留言接續發布',
        '取消',
    ]);

    if (choice === 1) {
        console.log('\n🔄 重新生成較短版本...');
        const newText = await regenerateFn();
        if (newText.length > THREADS_MAX_TEXT_LENGTH) {
            // 重新生成後仍超限，遞迴再問一次
            console.log(`   生成後仍有 ${newText.length} 字元，超過限制`);
            return handleOverflow(newText, regenerateFn);
        }
        return { main: newText, reply: null };
    }

    if (choice === 2) {
        const [main, reply] = splitForThread(text);
        console.log(
            `\n✂️  已在自然斷點分割：主貼文 ${main.length} 字元 ／` +
            ` 接續留言 ${reply.length} 字元`,
        );
        return { main, reply: reply || null };
    }

    return null; // 使用者取消
}
