// GlowMoment 截圖清單，每筆對應一張 assets/screenshots/ 下的圖片
// 新增截圖時：放入資料夾 → commit 到 GitHub → 在此新增一筆記錄
// visualDesc 由 AI 自動生成，不需要手動填寫

export type Screenshot = {
    filename: string;     // assets/screenshots/ 下的檔名（含副檔名）
    githubUrl: string;    // raw.githubusercontent.com 的公開 URL，供 Threads API 使用
    featureName: string;  // 對應 features.ts 中的 Feature.name，讓 AI 知道要強調哪個功能
};

// GitHub raw URL 格式：
// https://raw.githubusercontent.com/使用者名稱/GlowPulse/main/assets/screenshots/檔名

export const SCREENSHOTS: Screenshot[] = [
    {
        filename: 'service-setup.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/service-setup.png',
        featureName: '質感預約頁面',
    },
];
