import { GoogleGenerativeAI } from '@google/generative-ai';

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
    if (!_client) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY 缺失');
        // 初始化時明確使用 API Key
        _client = new GoogleGenerativeAI(apiKey);
    }
    return _client;
}

export class GeminiServiceError extends Error {
    code: 'QUOTA_EXCEEDED' | 'MODEL_NOT_FOUND' | 'REQUEST_FAILED';

    constructor(code: 'QUOTA_EXCEEDED' | 'MODEL_NOT_FOUND' | 'REQUEST_FAILED', message: string) {
        super(message);
        this.name = 'GeminiServiceError';
        this.code = code;
    }
}

// Google 在 2026 年已更改模型列表，需要先診斷當前可用模型
export async function listAvailableModels(): Promise<string[]> {
    try {
        const client = getClient();
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1/models?key=' + process.env.GEMINI_API_KEY,
            { method: 'GET' }
        );
        const data = await response.json() as Record<string, unknown>;
        const models = (data.models as Array<{ name?: string }> | undefined) || [];
        return models
            .map(m => m.name?.replace('models/', ''))
            .filter(Boolean) as string[];
    } catch (error) {
        console.debug('[Gemini] ListModels 診斷失敗：', error instanceof Error ? error.message : String(error));
        return [];
    }
}

export async function describeImageWithGemini(imageUrl: string): Promise<string> {
    const { data, mimeType } = await fetchImageAsBase64(imageUrl);

    // 2026 年可用模型（優先選擇 2.5 系列）
    // 舊的 1.5 / 2.0 部分別名已逐步下線，容易出現 404。
    const modelCandidates = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'];

    for (const modelName of modelCandidates) {
        try {
            // 使用 SDK 預設版本（v1beta），不強制指定 apiVersion
            const model = getClient().getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                {
                    inlineData: {
                        mimeType,
                        data,
                    },
                },
                '請用繁體中文描述這張 SaaS 產品截圖的畫面內容。說明有哪些 UI 元素、顯示什麼資訊、使用者可以做什麼操作。約 50～80 字，客觀描述即可，嚴禁使用簡體中文。',
            ]);

            const text = result.response.text().trim();
            if (!text) {
                throw new GeminiServiceError('REQUEST_FAILED', 'Gemini 回傳內容為空。');
            }

            const normalizedText = await enforceTraditionalChinese(modelName, text);
            console.log(`✅ 已使用模型 ${modelName} 成功生成描述`);
            return normalizedText;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            const errorObj = e instanceof Object ? (e as Record<string, unknown>) : {};
            const statusCode = (errorObj.status || '').toString();

            // 調試日誌
            const fullError = JSON.stringify({ statusCode, message, errorKeys: Object.keys(errorObj).slice(0, 5) });
            console.debug(`[Gemini] ${modelName} 錯誤：${fullError}`);

            // 優先判斷配額超限（429 或含 quota 文字）
            if (statusCode === '429' || isQuotaExceeded(message)) {
                throw new GeminiServiceError('QUOTA_EXCEEDED', message);
            }

            if (isModelNotFound(message)) {
                console.debug(`[Gemini] 模型 ${modelName} 不可用，嘗試下一個...`);
                continue;
            }

            console.debug(`[Gemini] 模型 ${modelName} 失敗：${message}`);
            throw new GeminiServiceError('REQUEST_FAILED', message);
        }
    }

    throw new GeminiServiceError('MODEL_NOT_FOUND', 'Gemini 可用模型都失敗（可能 API Key 無效或服務不可用）。請檢查 https://ai.google.dev/');
}

/**
 * 強制輸出繁體中文：
 * 1) 若原文已符合繁體中文，直接回傳
 * 2) 若包含常見簡體字或非中文雜訊，要求模型改寫成繁體
 */
async function enforceTraditionalChinese(modelName: string, text: string): Promise<string> {
    if (isLikelyTraditionalChinese(text)) {
        return text;
    }

    const model = getClient().getGenerativeModel({ model: modelName });
    const rewriteResult = await model.generateContent([
        [
            '請將以下內容改寫為繁體中文（台灣用語），並保持原意。',
            '禁止使用簡體字、英文段落與多餘前言，只輸出改寫後的內容。',
        ].join(' '),
        text,
    ]);

    const rewritten = rewriteResult.response.text().trim();
    if (!rewritten) {
        throw new GeminiServiceError('REQUEST_FAILED', 'Gemini 繁體中文改寫失敗：回傳內容為空。');
    }

    if (!isLikelyTraditionalChinese(rewritten)) {
        throw new GeminiServiceError('REQUEST_FAILED', 'Gemini 繁體中文改寫失敗：輸出仍非繁體中文。');
    }

    return rewritten;
}

async function fetchImageAsBase64(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`無法下載：${response.status}`);
    const mimeType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    return {
        data: Buffer.from(buffer).toString('base64'),
        mimeType
    };
}

function isQuotaExceeded(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes('429') || m.includes('quota') || m.includes('too many requests');
}

function isModelNotFound(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes('404') || m.includes('not found') || m.includes('is not supported for generatecontent');
}

function isLikelyTraditionalChinese(text: string): boolean {
    // 必須至少含有一定比例的中日韓統一表意文字，避免回傳整段英文。
    const cjkChars = text.match(/[\u3400-\u9fff]/g) ?? [];
    const enoughCjk = cjkChars.length >= 20;

    // 常見簡體字檢測（可視需要擴充）。
    const simplifiedPattern = /[为与这那们个么后开关产发图显线网统务点动备传输页写设话时来会应实无体务头条并从]|说明|页面|用户|系统|数据|显示/g;
    const hasSimplified = simplifiedPattern.test(text);

    return enoughCjk && !hasSimplified;
}