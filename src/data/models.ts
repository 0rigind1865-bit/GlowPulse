// 模型路由設定中心 — 修改此檔即可切換任意任務的 AI 服務商與模型
//
// 每個任務（task）有一組 candidates 候選清單，依序嘗試，第一個成功即回傳。
// 只需調整候選順序或替換 provider / model，不需要改任何任務程式碼。
//
// 使用範例：把 autoPost 換成 Claude 優先，Gemini 備援
//   autoPost: { candidates: [
//     { provider: 'claude', model: 'claude-haiku-4-5' },
//     { provider: 'gemini', model: 'gemini-2.5-flash' },
//   ]},
//
// ⚠️  每個 provider 只接受對應平台的模型名稱，不可跨區填寫：
// ┌──────────────┬──────────────────────────────────────┬──────────────────────────┐
// │  provider    │ API 路由                              │ 可填的模型來源           │
// ├──────────────┼──────────────────────────────────────┼──────────────────────────┤
// │  hf          │ router.huggingface.co                │ HuggingFace Hub 模型     │
// │  claude      │ api.anthropic.com                    │ Anthropic 模型           │
// │  gemini      │ generativelanguage.googleapis.com    │ Google Gemini 模型       │
// └──────────────┴──────────────────────────────────────┴──────────────────────────┘

export type Provider = 'hf' | 'claude' | 'gemini';

export type ModelCandidate = {
    provider: Provider;
    model: string;
};

export type ModelRoute = {
    /** 依序嘗試的候選模型清單，第一個成功即回傳，全部失敗才拋出錯誤 */
    candidates: [ModelCandidate, ...ModelCandidate[]];  // 至少一個
};

export const MODELS = {

    // ── 各任務候選清單 ────────────────────────────────────────────────────────
    // candidates 第一個是主力，之後依序為備援，可隨時增減或調換順序
    tasks: {

        /**
         * autoPost.ts：每日文字貼文生成
         * 換模型選項（hf）：
         *   'Qwen/Qwen2.5-7B-Instruct'  → 繁體中文穩定，免費額度多
         *   'Qwen/Qwen2.5-72B-Instruct' → 品質更好，速度較慢
         * 換模型選項（gemini）：
         *   'gemini-2.5-flash'           → 速度快，免費 tier 額度充足
         *   'gemini-2.5-pro'             → 品質更好，額度較少
         * 換模型選項（claude）：
         *   'claude-haiku-4-5'           → 最低成本，$1/$5 per 1M tokens
         *   'claude-sonnet-4-6'          → 品質更高，成本約 3 倍
         */
        autoPost: {
            candidates: [
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * imagePost.ts：圖片搭配文案生成
         * Gemini 為多模態模型，理解截圖相關的語境更準確
         */
        imageCaption: {
            candidates: [
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * imagePost.ts：截圖視覺描述 → 結構化分析重點
         * 注意：此任務的 prompt 描述截圖內容，不直接傳入圖片；
         * 若要直接分析截圖圖片，請使用 describeImageWithGemini()（走 MODELS.gemini.visionCandidates）
         */
        visualAnalysis: {
            candidates: [
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * analyzeReply.ts：潛在客戶回覆生成
         */
        intentReply: {
            candidates: [
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * weeklyReport.ts：發文成效深度分析 + data 層更新建議
         * 三層備援：Claude（最佳繁體品質）→ Gemini（多模態，品質次之）→ HF（保底）
         */
        weeklyAnalysis: {
            candidates: [
                { provider: 'claude', model: 'claude-haiku-4-5' },
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * analyzeReference.ts：參考貼文寫作模式分析 + data 層更新建議
         * 三層備援：Claude → Gemini → HF
         */
        referenceAnalysis: {
            candidates: [
                { provider: 'claude', model: 'claude-haiku-4-5' },
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

        /**
         * genStyles.ts：從 BRAND_CONTEXT 技巧衍生新 PostStyle 條目
         * 需要理解品牌語境並輸出結構化 JSON，三層備援
         */
        genStyles: {
            candidates: [
                { provider: 'claude', model: 'claude-haiku-4-5' },
                { provider: 'gemini', model: 'gemini-2.5-flash' },
                { provider: 'hf',     model: 'Qwen/Qwen2.5-7B-Instruct' },
            ],
        },

    } satisfies Record<string, ModelRoute>,

    // ── Gemini 視覺模型（直接圖片輸入，不走 generate()）────────────────────────
    // describeImageWithGemini() 使用，依序嘗試至第一個成功為止
    gemini: {
        visionCandidates: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'],
    },

};

/** 所有可傳入 generate() 的任務名稱 */
export type TaskName = keyof typeof MODELS.tasks;
