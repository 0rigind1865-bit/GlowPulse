// 共用互動確認工具：在任何不可逆操作前要求使用者輸入 y 確認
// 適用場景：發布到 Threads、寫回 brand.ts / styles.ts 等 data 層變更

import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * 顯示提示訊息，等待使用者輸入 y / yes 才回傳 true
 * 任何其他輸入（包含 Enter）都回傳 false，操作取消
 *
 * @param message - 顯示給使用者的確認問題，會自動加上「輸入 y 確認，其他任意鍵取消：」後綴
 * @param preview - 可選的操作預覽內容，顯示在問句之前，讓使用者看清楚即將做什麼
 */
export async function confirmAction(message: string, preview?: string): Promise<boolean> {
    if (preview) {
        console.log('\n' + preview);
    }

    const rl = createInterface({ input, output });
    try {
        const answer = (await rl.question(`\n⚠️  ${message}（輸入 y 確認，其他任意鍵取消）：`))
            .trim()
            .toLowerCase();
        return answer === 'y' || answer === 'yes';
    } finally {
        rl.close();
    }
}
