// Hugging Face API 底層封裝，兩個任務（發文 / 分析回覆）共用此模組
// 只負責 HTTP 請求與錯誤轉換，不含任何業務邏輯

import { Converter } from 'opencc-js';

// ─── 型別定義 ────────────────────────────────────────────────────────────────

/**
 * Hugging Face Chat Completions API 的回應結構（OpenAI 相容格式）
 * choices 陣列通常只有一個元素，content 即為模型回覆的文字
 */
type ChatCompletionResponse = {
    choices?: Array<{
        message?: { content?: string };
    }>;
};

/**
 * 零樣本分類 API 回傳的單一標籤結果
 * label：候選標籤文字；score：模型對此標籤的信心分數（0～1）
 * 陣列已依 score 由高到低排序，取 [0] 即為最可能的分類
 */
export type ZeroShotItem = {
    label: string;
    score: number;
};

// ─── 常數 ────────────────────────────────────────────────────────────────────

// HF Router 統一入口，支援 OpenAI 相容的 Chat Completion 格式
const HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions';

// HF Router 推理端點（零樣本分類等任務用）
const HF_INFERENCE_BASE = 'https://router.huggingface.co/hf-inference/models';

const toTraditionalChinese = Converter({ from: 'cn', to: 'twp' });
const simplifiedPattern = /[为与这那们个么后开关产发图显线网统务点动备传输页写设话时来会应实无体务头条并从]|说明|页面|用户|系统|数据|显示/g;


// ─── 內部工具函式 ────────────────────────────────────────────────────────────

/**
 * 從環境變數讀取 HF_TOKEN，未設定則立即拋出錯誤
 * 在呼叫 API 前提早失敗，避免發出沒有授權的請求
 */
function getToken(): string {
    const token = process.env.HF_TOKEN;
    if (!token) throw new Error('缺少 HF_TOKEN 環境變數。');
    return token;
}

/**
 * 將模型 ID（如 "facebook/bart-large-mnli"）的每個路徑段落分別 URL 編碼
 * 直接拼接 URL 而不編碼會導致 "/"被解析為路徑分隔符，產生 404
 */
function encodeModelId(model: string): string {
    return model.split('/').map(encodeURIComponent).join('/');
}

// ─── 公開 API ────────────────────────────────────────────────────────────────


/**
 * 呼叫 Hugging Face Chat Completions，適用於支援指令格式的模型（如 Qwen、Mistral）
 * 使用 stream: false 等待完整回應，避免處理串流事件的複雜度
 * @param model      - 模型 ID，例如 'Qwen/Qwen2.5-7B-Instruct'
 * @param messages   - 對話歷史，格式與 OpenAI Chat API 相同
 * @param temperature - 回應隨機性（0 = 確定性最高，1 = 最有創意），預設 0.85
 * @param maxTokens  - 最大輸出 token 數，預設 180（適合短貼文）
 * @returns 模型回覆的純文字字串
 */
export async function callChatCompletion(
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    temperature = 0.85,
    maxTokens = 180,
): Promise<string> {
    const response = await fetch(HF_CHAT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        // stream: false 確保回應是完整的 JSON，不是 SSE 串流
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
    });

    // 無論 HTTP 狀態為何，先嘗試解析 JSON（錯誤回應也是 JSON 格式）
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
        // 優先取 API 回傳的 error 欄位，比狀態碼更有診斷價值
        const msg =
            typeof data === 'object' && data !== null && 'error' in data
                ? JSON.stringify((data as Record<string, unknown>).error)
                : `HF Chat API 失敗：${response.status}`;
        throw new Error(msg);
    }

    // 取 choices[0].message.content，並去除前後空白
    const content = (data as ChatCompletionResponse).choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Chat completion 回傳格式不正確。');

    // Qwen 偶爾仍會回傳簡體，於底層做保底轉換，避免各任務重複實作。
    const normalized = normalizeTraditionalChinese(content);
    return normalized;
}

function normalizeTraditionalChinese(text: string): string {
    if (!text) return text;
    if (!containsCjk(text)) return text;
    if (isLikelyTraditionalChinese(text)) return text;
    return toTraditionalChinese(text);
}

function containsCjk(text: string): boolean {
    return /[\u3400-\u9fff]/.test(text);
}

function isLikelyTraditionalChinese(text: string): boolean {
    return !simplifiedPattern.test(text);
}

/**
 * 呼叫 Hugging Face 零樣本分類模型（facebook/bart-large-mnli）
 * 不需要訓練資料，直接判斷輸入文字最接近哪個候選標籤
 * @param input           - 要分類的文字（例如 Threads 貼文內容）
 * @param candidateLabels - 候選標籤清單（例如 ['預約需求', '美容抱怨', '日常生活', '商業廣告']）
 * @returns 已依信心分數由高到低排序的標籤陣列
 */
export async function callZeroShot(
    input: string,
    candidateLabels: string[],
): Promise<ZeroShotItem[]> {
    const model = 'facebook/bart-large-mnli';

    // 需要對模型 ID 的每個片段分別編碼，避免 "/" 被誤判為 URL 路徑分隔符
    const url = `${HF_INFERENCE_BASE}/${encodeModelId(model)}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inputs: input,
            parameters: { candidate_labels: candidateLabels },
            // wait_for_model: true 避免冷啟動時收到 503；模型載入中時 HF 會等待而非立即報錯
            options: { wait_for_model: true },
        }),
    });

    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
        const msg =
            typeof data === 'object' && data !== null && 'error' in data
                ? JSON.stringify((data as Record<string, unknown>).error)
                : `HF ZeroShot API 失敗：${response.status}`;
        throw new Error(msg);
    }

    // HF Inference API 的回應本身就是排序好的陣列，直接回傳
    return data as ZeroShotItem[];
}
