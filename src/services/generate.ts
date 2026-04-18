// 統一 AI 生成介面 — 依 models.ts 的任務路由表決定呼叫哪個 provider
// 任務只需呼叫 generate(taskName, system, prompt)，切換 provider 只需改 models.ts

import { MODELS, type TaskName, type ModelRoute, type Provider } from '../data/models.js';
import { callChatCompletion } from './hf.js';
import { callClaude } from './claude.js';
import { generateTextWithGemini } from './gemini.js';

// ─── 內部路由函式 ─────────────────────────────────────────────────────────────

/**
 * 依 provider 分派到對應的 service 函式
 * 統一簽名：system + userPrompt → string
 */
async function callProvider(
    provider: Provider,
    model: string,
    system: string,
    userPrompt: string,
    maxTokens: number,
    temperature: number,
): Promise<string> {
    switch (provider) {
        case 'hf':
            return callChatCompletion(
                model,
                [
                    { role: 'system', content: system },
                    { role: 'user', content: userPrompt },
                ],
                temperature,
                maxTokens,
            );
        case 'claude':
            return callClaude(system, userPrompt, maxTokens, model);
        case 'gemini':
            return generateTextWithGemini(model, system, userPrompt);
        default: {
            // TypeScript exhaustiveness check：新增 provider 時此行會報錯，確保不遺漏
            const _exhaustive: never = provider;
            throw new Error(`未知的 provider：${_exhaustive}`);
        }
    }
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * 統一 AI 文字生成介面
 *
 * 從 models.ts 的 tasks 設定讀取任務的 provider + model，
 * 路由到對應的 service 函式（hf / claude / gemini）。
 * 若設定了 fallback，主要 provider 失敗時自動切換，不需要在 task 層寫 try/catch。
 *
 * @param taskName   - models.ts 中定義的任務名稱，決定使用哪個 provider 與模型
 * @param system     - System prompt（角色設定、語言規範等）
 * @param userPrompt - 使用者提示（包含內容資料與指令）
 * @param maxTokens  - 輸出 token 上限（預設 1000）
 * @param temperature - 回應隨機性，0 = 確定性最高（預設 0.7）
 */
export async function generate(
    taskName: TaskName,
    system: string,
    userPrompt: string,
    maxTokens = 1000,
    temperature = 0.7,
): Promise<string> {
    // as ModelRoute：各任務的 union 型別在 satisfies 推斷後包含/不包含 fallback，
    // 明確斷言為 ModelRoute（fallback 為可選），讓編譯器正確識別 fallback 的存在
    const config = MODELS.tasks[taskName] as ModelRoute;

    try {
        return await callProvider(config.provider, config.model, system, userPrompt, maxTokens, temperature);
    } catch (err) {
        // 沒有設定 fallback，直接向上拋出
        if (!config.fallback) throw err;

        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
            `⚠️  ${config.provider}（${config.model}）失敗，` +
            `退回 ${config.fallback.provider}（${config.fallback.model}）`,
        );
        console.warn(`   原因：${msg.slice(0, 120)}`);

        // HF fallback 時在 system 加入語言指令（hf.ts 有 opencc-js 保底，此為雙重保險）
        const fallbackSystem = config.fallback.provider === 'hf'
            ? `請全程使用繁體中文回應，嚴禁使用簡體中文。\n\n${system}`
            : system;

        return callProvider(
            config.fallback.provider,
            config.fallback.model,
            fallbackSystem,
            userPrompt,
            maxTokens,
            temperature,
        );
    }
}
