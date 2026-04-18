// 共用互動確認工具：在任何不可逆操作前要求使用者確認
// 適用場景：發布到 Threads、寫回 brand.ts / styles.ts 等 data 層變更
//
// 自動確認模式：設定環境變數 GLOW_AUTO_CONFIRM=1（或執行時傳入 --yes 旗標）
// 排程任務（GitHub Actions）使用此模式跳過所有互動提示

import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/** 判斷目前是否處於自動確認模式（排程執行） */
export function isAutoConfirm(): boolean {
    return process.env.GLOW_AUTO_CONFIRM === '1';
}

/**
 * 顯示提示訊息，等待使用者輸入 y / yes 才回傳 true
 * 任何其他輸入（包含 Enter）都回傳 false，操作取消
 * 自動確認模式下（GLOW_AUTO_CONFIRM=1）：直接回傳 true，不等待輸入
 *
 * @param message - 顯示給使用者的確認問題，會自動加上「輸入 y 確認，其他任意鍵取消：」後綴
 * @param preview - 可選的操作預覽內容，顯示在問句之前，讓使用者看清楚即將做什麼
 */
export async function confirmAction(message: string, preview?: string): Promise<boolean> {
    if (preview) {
        console.log('\n' + preview);
    }

    if (isAutoConfirm()) {
        console.log(`\n✅ ${message} [自動確認]`);
        return true;
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

/**
 * 顯示編號選項讓使用者選擇，回傳 1-based 選項編號
 * 輸入非法（非數字或超出範圍）時回傳 null，視為取消
 * 自動確認模式下：自動選擇選項 2（以留言接續），保留所有內容不截棄
 *
 * @param message - 問題描述，顯示在選項清單上方
 * @param choices - 選項文字陣列（至少一個）
 * @returns 選擇的選項編號（1-based），或 null（取消）
 */
export async function promptChoice(
    message: string,
    choices: readonly string[],
): Promise<number | null> {
    if (isAutoConfirm()) {
        const autoChoice = Math.min(2, choices.length); // 自動選留言接續，保留所有內容
        console.log(`\n${message} [自動選擇: ${choices[autoChoice - 1]}]`);
        return autoChoice;
    }

    const rl = createInterface({ input, output });
    try {
        console.log(`\n${message}：`);
        choices.forEach((c, i) => console.log(`  [${i + 1}] ${c}`));
        const answer = (await rl.question('\n請輸入選項數字：')).trim();
        const n = parseInt(answer, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= choices.length) return n;
        console.log('   無效輸入，視為取消。');
        return null;
    } finally {
        rl.close();
    }
}
