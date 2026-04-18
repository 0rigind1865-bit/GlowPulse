// 模型設定中心 — 修改此檔案即可切換所有任務使用的 AI 模型
// ⚠️  重要：每個 provider 只能填該平台的模型，不可跨區填寫
//
// ┌─────────────────────────────────────────────────────────────────┐
// │  provider      │ API 路由                  │ 可填的模型來源     │
// ├─────────────────────────────────────────────────────────────────┤
// │  hf            │ router.huggingface.co     │ HuggingFace 模型   │
// │  claude        │ api.anthropic.com         │ Anthropic 模型     │
// │  gemini        │ generativelanguage.google │ Google Gemini 模型 │
// └─────────────────────────────────────────────────────────────────┘

export const MODELS = {
    // ── Hugging Face（HuggingFace Hub 上的開源模型）──────────────────
    // 換模型選項：
    //   'Qwen/Qwen2.5-7B-Instruct'            → 繁體中文穩定，免費額度多
    //   'Qwen/Qwen2.5-72B-Instruct'           → 品質更好，速度較慢
    //   'mistralai/Mistral-7B-Instruct-v0.3'  → 英文強，中文一般
    //   'meta-llama/Llama-3.1-8B-Instruct'    → Meta 開源，中文普通
    hf: {
        /** autoPost 每日發文、imagePost 圖片文案生成 */
        textGeneration: 'Qwen/Qwen2.5-7B-Instruct',

        /** imagePost 將視覺描述轉成「畫面事實 / 使用者價值 / 發文切角」結構 */
        visualAnalysis: 'Qwen/Qwen2.5-7B-Instruct',

        /** analyzeReply 意圖分類後的客戶回覆生成 */
        intentReply: 'Qwen/Qwen2.5-7B-Instruct',

        /** weeklyReport / analyzeReference 在 Claude 無法使用時退回此模型 */
        analysisBackup: 'Qwen/Qwen2.5-7B-Instruct',
    },

    // ── Anthropic Claude ─────────────────────────────────────────────
    // 換模型選項：
    //   'claude-haiku-4-5'   → 最便宜，週報分析品質穩定（$1/$5 per 1M）
    //   'claude-sonnet-4-5'  → 分析更深入，成本約 3 倍
    //   'claude-opus-4-7'    → 最強，成本最高
    claude: {
        /** weeklyReport / analyzeReference 深度分析主力 */
        analysis: 'claude-haiku-4-5',
    },

    // ── Google Gemini ─────────────────────────────────────────────────
    // 換模型選項：
    //   'gemini-2.5-flash'  → 速度快，免費額度最多（推薦日常使用）
    //   'gemini-2.5-pro'    → 視覺描述更精準，免費額度較少
    //   'gemini-flash-latest' → 別名，自動對應最新 flash 版本
    gemini: {
        /** 截圖視覺描述，依序嘗試至第一個成功為止 */
        visionCandidates: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'],
    },
} satisfies {
    hf: { textGeneration: string; visualAnalysis: string; intentReply: string; analysisBackup: string };
    claude: { analysis: string };
    gemini: { visionCandidates: string[] };
};
