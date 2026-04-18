// Anthropic Claude API 封裝，使用 models.ts 設定的模型生成分析內容
// 只處理 HTTP 層，錯誤一律轉為 Error 向上拋出

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../data/models.js';

// ─── Client 初始化 ───────────────────────────────────────────────────────────

/**
 * 延遲初始化 Anthropic client，避免在 import 階段就讀取環境變數
 * 此時 dotenv 可能尚未執行，process.env.ANTHROPIC_API_KEY 還是 undefined
 */
let _client: Anthropic | null = null;

function getClient(): Anthropic {
    if (!_client) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        // 明確區分「未設定」與「填了預設佔位符」兩種情況，讓錯誤訊息更清楚
        if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
            throw new Error('請在 .env 設定有效的 ANTHROPIC_API_KEY。取得方式：https://console.anthropic.com/');
        }
        _client = new Anthropic({ apiKey });
    }
    return _client;
}

// ─── 公開 API ────────────────────────────────────────────────────────────────

/**
 * 以串流方式呼叫 Claude Haiku，等待完整回應後回傳
 *
 * 使用串流（而非單次請求）的原因：
 * - 週報分析輸出較長，單次請求在網路層容易逾時
 * - SDK 的 .stream() + .finalMessage() 自動處理重試與串流組合
 *
 * 使用 claude-haiku-4-5 的原因：
 * - 成本最低（$1/$5 per 1M tokens），適合週報這類定期執行的任務
 * - 繁體中文品質穩定，不像開源模型容易混入簡體
 * - Haiku 不支援 adaptive thinking，故不傳 thinking 參數
 *
 * @param system    - System prompt，設定 AI 角色與語言規範
 * @param userPrompt - 完整的使用者提示，包含貼文數據與分析指令
 * @param maxTokens  - 輸出 token 上限，預設 2000（週報分析建議 1500～3000）
 * @returns AI 回覆的完整繁體中文文字
 */
export async function callClaude(
    system: string,
    userPrompt: string,
    maxTokens = 2000,
    model = MODELS.claudeAnalysis,
): Promise<string> {
    const client = getClient();

    // stream() 建立串流連線；finalMessage() 等待所有 chunk 合併為完整 Message 物件
    const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userPrompt }],
    });

    const response = await stream.finalMessage();

    // content 是 ContentBlock 陣列（可能含 text / tool_use 等型別）
    // 只取 text 型別的區塊，過濾掉其他類型後合併為單一字串
    const text = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

    if (!text) throw new Error('Claude 回覆內容為空，請確認提示是否正確。');
    return text;
}
