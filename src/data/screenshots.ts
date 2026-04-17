// GlowMoment 截圖清單，每筆對應一張 assets/screenshots/ 下的圖片
// 新增截圖時：放入資料夾 → commit 到 GitHub → 在此新增一筆記錄
// visualDesc 由 AI 自動生成，不需要手動填寫

export type Screenshot = {
    filename: string;      // assets/screenshots/ 下的檔名（含副檔名）
    githubUrl: string;     // raw.githubusercontent.com 的公開 URL，供 Threads API 使用
    featureName: string;   // 對應 features.ts 中的 Feature.name，讓 AI 知道要強調哪個功能
    description?: string;  // 選填：手動描述截圖畫面內容；填寫後跳過視覺 API，立即可用
};

// GitHub raw URL 格式：
// https://raw.githubusercontent.com/使用者名稱/GlowPulse/main/assets/screenshots/檔名

export const SCREENSHOTS: Screenshot[] = [
    {
        filename: 'service-setup.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/service-setup.png',
        featureName: '服務項目管理',
        description: '此SaaS行動應用介面用於編輯服務項目。畫面顯示服務名稱「法式手繪美甲」、品牌圖片及刪除按鈕。下方可輸入服務時間（1小時）、總價（3000）與訂金（500），並有上下調整時間的選擇器。使用者可點擊「新增項目」或「儲存服務項目」按鈕進行操作。',
    },
    {
        filename: '2.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/2.png',
        featureName: '服務項目管理',
        description: '此SaaS行動應用介面用於編輯服務項目。畫面顯示服務名稱「法式手繪美甲」、品牌圖片及刪除按鈕。下方可輸入服務時間（1小時）、總價（3000）與訂金（500），並有上下調整時間的選擇器。使用者可點擊「新增項目」或「儲存服務項目」按鈕進行操作。',
    },
];
