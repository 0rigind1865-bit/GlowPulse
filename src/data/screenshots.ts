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
        featureName: '已確認預約詳情',
        description: '此SaaS產品截圖顯示預約確認畫面。上方標示服務提供者「Glow」及「已確認」狀態。左側有服務圖片與「諮詢」名稱。右側列出地址、2026年4月30日週四的日期，以及07:00-08:00的時間。下方顯示NT$100費用（不需訂金），並提供「加入 Google 行事曆」和「再次預約」操作按鈕。',
    },
    {
        filename: '2.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/2.png',
        featureName: '',
        description: '',
    },
];
