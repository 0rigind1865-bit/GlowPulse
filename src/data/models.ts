// 模型設定中心 — 修改此檔案即可切換所有任務使用的 AI 模型
// 無需碰業務邏輯，改完後直接生效
//
// 【角色說明】
//   textGeneration  → 每日自動發文、圖片搭配文案（需要創意、口語感）
//   visualAnalysis  → 將 Gemini 畫面描述轉成結構化發文重點（需要邏輯、低 temperature）
//   intentAnalysis  → 零樣本分類 + 潛在客戶回覆（analyzeReply）
//   hfAnalysis      → 週報 / 參考貼文分析的 HF 備用（Claude 無法使用時）
//   claudeAnalysis  → 週報 / 參考貼文分析的主力（繁體中文品質最穩定）
//   visionCandidates→ Gemini 截圖視覺描述，依序嘗試至第一個成功為止
//
// 【常見替換選項】
//   HF 文案生成：
//     'Qwen/Qwen2.5-7B-Instruct'       → 繁體中文穩定，免費額度較多
//     'mistralai/Mistral-7B-Instruct-v0.3'
//     'meta-llama/Llama-3.1-8B-Instruct'
//   Claude：
//     'claude-haiku-4-5'               → 最便宜，分析品質穩定
//     'claude-sonnet-4-5'              → 分析更深入，成本較高
//   Gemini（vision）：
//     'gemini-2.5-flash'               → 速度快，免費額度最多
//     'gemini-2.5-pro'                 → 描述更精準，額度較少

export const MODELS = {
    /** 文案生成：autoPost 每日發文、imagePost 圖片文案 */
    textGeneration: 'Qwen/Qwen2.5-7B-Instruct',

    /** 畫面分析：imagePost 將視覺描述轉成「畫面事實 / 使用者價值 / 發文切角」 */
    visualAnalysis: 'Qwen/Qwen2.5-7B-Instruct',

    /** 意圖分析：analyzeReply 零樣本分類 + 潛在客戶回覆生成 */
    intentAnalysis: 'Qwen/Qwen2.5-7B-Instruct',

    /** 深度分析備用（HF）：weeklyReport / analyzeReference 在 Claude 無法使用時退回此模型 */
    hfAnalysis: 'Qwen/Qwen2.5-7B-Instruct',

    /** 深度分析主力（Claude）：weeklyReport / analyzeReference 優先使用 */
    claudeAnalysis: 'claude-haiku-4-5',

    /** 截圖視覺描述（Gemini）：依序嘗試，第一個成功就停止 */
    visionCandidates: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'],
} satisfies {
    textGeneration: string;
    visualAnalysis: string;
    intentAnalysis: string;
    hfAnalysis: string;
    claudeAnalysis: string;
    visionCandidates: string[];
};
