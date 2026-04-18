// 模型路由設定中心 — 修改此檔即可切換任意任務的 AI 服務商與模型
//
// 每個任務（task）對應一筆設定：
//   provider  — 服務商（hf / claude / gemini），決定走哪個 API
//   model     — 該服務商的模型 ID（只能填對應平台的模型名稱）
//   fallback  — 可選。主要服務失敗時自動切換到備用（provider + model 可跨服務商）
//
// 使用範例：把 autoPost 從 HF 換到 Claude
//   autoPost: { provider: 'claude', model: 'claude-haiku-4-5' },
//
// ⚠️  每個 provider 只接受對應平台的模型名稱，不可跨區填寫：
// ┌──────────────┬──────────────────────────────────┬────────────────────────┐
// │  provider    │ API 路由                          │ 可填的模型來源         │
// ├──────────────┼──────────────────────────────────┼────────────────────────┤
// │  hf          │ router.huggingface.co            │ HuggingFace Hub 模型   │
// │  claude      │ api.anthropic.com                │ Anthropic 模型         │
// │  gemini      │ generativelanguage.googleapis.com│ Google Gemini 模型     │
// └──────────────┴──────────────────────────────────┴────────────────────────┘

export type Provider = 'hf' | 'claude' | 'gemini';

export type ModelRoute = {
    provider: Provider;
    model: string;
    /** 主要服務失敗時（配額、認證錯誤等）自動退回此設定 */
    fallback?: { provider: Provider; model: string };
};

export const MODELS = {

    // ── 各任務路由表 ──────────────────────────────────────────────────────────
    // 修改 provider 即可跨服務商切換；fallback 在主要服務不可用時自動啟用
    tasks: {

        /** autoPost.ts：每日文字貼文生成 */
        autoPost: {
            provider: 'hf',
            model: 'Qwen/Qwen2.5-7B-Instruct',
        },

        /** imagePost.ts：圖片搭配文案生成 */
        imageCaption: {
            provider: 'hf',
            model: 'Qwen/Qwen2.5-7B-Instruct',
        },

        /** imagePost.ts：截圖視覺描述 → 結構化分析重點 */
        visualAnalysis: {
            provider: 'hf',
            model: 'Qwen/Qwen2.5-7B-Instruct',
        },

        /** analyzeReply.ts：潛在客戶回覆生成 */
        intentReply: {
            provider: 'hf',
            model: 'Qwen/Qwen2.5-7B-Instruct',
        },

        /** weeklyReport.ts：發文成效深度分析 + data 層更新建議 */
        weeklyAnalysis: {
            provider: 'claude',
            model: 'claude-haiku-4-5',
            fallback: { provider: 'hf', model: 'Qwen/Qwen2.5-7B-Instruct' },
        },

        /** analyzeReference.ts：參考貼文寫作模式分析 + data 層更新建議 */
        referenceAnalysis: {
            provider: 'claude',
            model: 'claude-haiku-4-5',
            fallback: { provider: 'hf', model: 'Qwen/Qwen2.5-7B-Instruct' },
        },

    } satisfies Record<string, ModelRoute>,

    // ── Gemini 視覺模型（特殊用途，不走 generate()）──────────────────────────
    // describeImageWithGemini() 依序嘗試，第一個成功即停止
    // 換模型選項：
    //   'gemini-2.5-flash'    → 速度快，免費額度最多（推薦日常使用）
    //   'gemini-2.5-pro'      → 視覺描述更精準，免費額度較少
    //   'gemini-flash-latest' → 別名，自動對應最新 flash 版本
    gemini: {
        visionCandidates: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'],
    },

};

/** 所有可傳入 generate() 的任務名稱 */
export type TaskName = keyof typeof MODELS.tasks;
