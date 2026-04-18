// 統一 AI 生成介面 — 依 models.ts 的候選清單依序嘗試，第一個成功即回傳
// 任務只需呼叫 generate(taskName, system, prompt)，切換模型只需改 models.ts

import { MODELS, type TaskName, type Provider } from '../data/models.js';
import { callChatCompletion } from './hf.js';
import { callClaude } from './claude.js';
import { generateTextWithGemini } from './gemini.js';

// ─── 內部路由函式 ─────────────────────────────────────────────────────────────

/**
 * 依 provider 分派到對應的 service 函式
 * HF 使用 HF Router；Claude 使用 Anthropic API；Gemini 使用 Google API
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
            // HF 的 system prompt 透過 messages 陣列傳入
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
 * 從 models.ts 讀取任務的 candidates 清單，依序嘗試每個候選，
 * 第一個成功即回傳；全部失敗才拋出最後一個錯誤。
 *
 * @param taskName    - models.ts 中定義的任務名稱
 * @param system      - System prompt（角色設定、語言規範等）
 * @param userPrompt  - 使用者提示（包含內容資料與指令）
 * @param maxTokens   - 輸出 token 上限（預設 1000）
 * @param temperature - 回應隨機性，0 = 確定性最高（預設 0.7）
 */
export async function generate(
    taskName: TaskName,
    system: string,
    userPrompt: string,
    maxTokens = 1000,
    temperature = 0.7,
): Promise<string> {
    const { candidates } = MODELS.tasks[taskName];
    let lastError: unknown;

    for (const { provider, model } of candidates) {
        try {
            // HF 輸出偶爾夾雜簡體，在 system 加入語言指令作為雙重保險
            // （hf.ts 底層已有 opencc-js 保底，此為額外提示）
            const effectiveSystem = provider === 'hf'
                ? `請全程使用繁體中文回應，嚴禁使用簡體中文。\n\n${system}`
                : system;

            return await callProvider(provider, model, effectiveSystem, userPrompt, maxTokens, temperature);
        } catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️  ${provider}（${model}）失敗，嘗試下一個候選...`);
            console.warn(`   原因：${msg.slice(0, 120)}`);
        }
    }

    throw lastError ?? new Error(`${taskName}：所有候選模型均失敗`);
}
