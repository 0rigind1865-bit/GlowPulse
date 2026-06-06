// GlowMoment 品牌背景說明，注入 system prompt 讓 AI 有完整的產品認知。
//
// 資料來源為 brand.json（載入時以 zod 驗證）：
//   - template：靜態品牌模板（定位、語氣、Hashtag、誘導留言格式），手動維護
//   - principles：【從優質貼文學到的技巧】清單，由 AI 透過 dataUpdater 累積更新
//   - link：產品連結與 UTM 設定，用來追蹤 Threads 帶來的點擊
// 對外仍 export 同名的 BRAND_CONTEXT 字串，呼叫端無需更動。

import { loadData, BrandSchema } from './schema.js';

const brand = loadData('brand.json', BrandSchema);

/**
 * 組出帶 UTM 參數的追蹤連結；url 為空字串時回傳 ''（功能停用）。
 * medium 區分流量來源：'post'（貼文內文）vs 'bio'（個人檔案），方便在分析後台分流統計。
 */
export function buildTrackedLink(medium: 'post' | 'bio'): string {
    const { url, utmCampaign } = brand.link;
    if (!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}utm_source=threads&utm_medium=${medium}&utm_campaign=${utmCampaign}`;
}

/** 個人檔案（bio）應設定的追蹤連結，供文件與設定參考 */
export const BIO_LINK = buildTrackedLink('bio');

// 貼文內文用的追蹤連結。已設定 url 時，明確指示 AI 使用此連結（不要改寫 UTM）；
// url 留空時這段為空字串，BRAND_CONTEXT 維持原樣（安全停用）。
const postLink = buildTrackedLink('post');
const linkInstruction = postLink
    ? [
        '',
        '',
        '【產品連結（請在行動呼籲處自然帶上這個連結）】',
        postLink,
        '只使用上面這個連結，務必完整保留 utm_ 參數，不要自行改寫、縮短或省略。',
    ].join('\n')
    : '';

export const BRAND_CONTEXT = (
    brand.template + '\n' + brand.principles.map(p => `- ${p}`).join('\n') + linkInstruction
).trim();
