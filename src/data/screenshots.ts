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
        featureName: '專業服務項目彈性設定與管理',
        description: '此SaaS產品截圖顯示服務項目編輯頁面。上方為手機狀態列。核心介面包含可編輯的「服務名稱」（法式手繪美甲）、品牌圖片「Mooni BEAUTY STUDIO」，以及設定「所需時間」（1 小時）、「服務總價」（3000）與「應付訂金」（500）等欄位。使用者可點擊刪除圖示、下方「新增項目」或「儲存服務項目」按鈕進行操作。',
    },
    {
        filename: '2.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/2.png',
        featureName: '客戶預約詳情確認與行動',
        description: '此SaaS產品截圖顯示一筆服務預約的確認頁面。上方為服務提供者Glow，預約服務名稱為「諮詢」，來自Moonni Beauty Studio。顯示已確認的服務地址、2026年4月30日週四07:00-08:00的預約日期與時間。費用為新台幣100元，無需訂金。使用者可選擇「加入 Google 行事曆」或「再次預約」。',
    },
    {
        filename: 'time.png',
        githubUrl: 'https://raw.githubusercontent.com/0rigind1865-bit/GlowPulse/main/assets/screenshots/time.png',
        featureName: '每週營業時段彈性設定與管理',
        description: '此SaaS產品截圖為設定「每週預設時段」的介面。畫面列出週日到週六的項目，每個含一個啟用開關。已啟用（粉紅色）的週一至週四顯示可調整的預約起迄時間，例如週一為上午9點至下午6點。未啟用（灰色）的週日、週五、週六則顯示「本日公休 / 不開放預約」。使用者可透過開關啟用或禁用特定日期的預約，並調整其開放時段。',
    },
];
