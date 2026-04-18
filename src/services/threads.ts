// Threads Graph API 封裝：建立容器、發布貼文、刷新 Token、擷取貼文與互動數據
// 只處理 HTTP 層，錯誤一律轉為 Error 向上拋出

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// ─── 常數 ────────────────────────────────────────────────────────────────────

// Threads Graph API v1.0 的基礎 URL，所有端點都以此為前綴
const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/** Threads 單則貼文或留言的字元上限（API 硬性限制） */
export const THREADS_MAX_TEXT_LENGTH = 500;

// Token 刷新端點獨立於一般 API，使用不同的 URL
const THREADS_TOKEN_REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const TOKEN_MAX_AGE_DAYS = 60;
const TOKEN_REFRESH_BUFFER_DAYS = 5;

// ─── 內部工具函式 ────────────────────────────────────────────────────────────

/**
 * 從環境變數讀取 Threads 認證資訊，缺少或填寫佔位符時立即拋出錯誤
 * 在每次 API 呼叫前驗證，確保不會發出沒有意義的認證失敗請求
 */
function getCredentials(): { token: string; userId: string } {
    const token = process.env.THREADS_ACCESS_TOKEN;
    const userId = process.env.THREADS_USER_ID;
    if (!token || token === 'your_threads_access_token_here') {
        throw new Error('請在 .env 設定有效的 THREADS_ACCESS_TOKEN。');
    }
    if (!userId || userId === 'your_threads_user_id_here') {
        throw new Error('請在 .env 設定有效的 THREADS_USER_ID。');
    }
    return { token, userId };
}

/**
 * 從 API 回應中提取錯誤訊息
 * 優先取 error 欄位（有診斷價值），取不到才用 fallback 字串
 */
function parseError(data: unknown, fallback: string): string {
    return typeof data === 'object' && data !== null && 'error' in data
        ? JSON.stringify((data as Record<string, unknown>).error)
        : fallback;
}

// ─── Token 管理 ──────────────────────────────────────────────────────────────

/**
 * 刷新 Threads 長效 Token（有效期 60 天），並自動寫回 .env
 *
 * Token 生命週期說明：
 * - Threads 預設給「短效 Token」（幾小時到期），不能用此方式刷新
 * - 需先透過 th_exchange_token 換成「長效 Token」（60 天）
 * - 長效 Token 只要在 60 天內執行過一次刷新，就可以永遠不過期
 *
 * @returns 刷新後的新 Token
 * @throws 若 Token 已過期或刷新失敗，拋出含操作步驟的詳細錯誤訊息
 */
export async function refreshToken(): Promise<string> {
    const { token } = getCredentials();

    // th_refresh_token 是長效 Token 專用的刷新 grant type
    const url = new URL(THREADS_TOKEN_REFRESH_URL);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString());
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
        const errMsg = parseError(data, `Token 刷新失敗：${response.status}`);
        // 拋出含重新取得步驟的錯誤，幫助使用者快速恢復，不需要查文件
        throw new Error(
            `Token 已過期且無法自動刷新。\n` +
            `原因：${errMsg}\n\n` +
            `請依照以下步驟重新取得長效 Token：\n` +
            `1. 至 Meta Developer 取得新的短效 Token（確認有 threads_content_publish 權限）\n` +
            `2. 執行：curl "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&access_token=短效Token"\n` +
            `3. 將回傳的 access_token 填入 .env 的 THREADS_ACCESS_TOKEN`
        );
    }

    // 型別收窄：確認回應中確實有 access_token 字串欄位
    const newToken =
        typeof data === 'object' &&
            data !== null &&
            'access_token' in data &&
            typeof (data as Record<string, unknown>).access_token === 'string'
            ? (data as Record<string, string>).access_token
            : null;

    if (!newToken) {
        throw new Error('Token 刷新回應格式異常，請手動更新 .env 的 THREADS_ACCESS_TOKEN。');
    }

    // 自動寫回 .env，下次執行不需要手動更新
    // 同步記錄刷新時間，供後續判斷是否需要再次刷新
    try {
        const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
        const content = readFileSync(envPath, 'utf-8');
        const withToken = upsertEnvLine(content, 'THREADS_ACCESS_TOKEN', newToken);
        const withTimestamp = upsertEnvLine(withToken, 'THREADS_TOKEN_REFRESHED_AT', new Date().toISOString());
        writeFileSync(envPath, withTimestamp, 'utf-8');
        console.log('🔄 Token 已刷新並寫回 .env');
    } catch {
        // 寫回失敗不影響本次執行，僅提示需手動更新
        console.warn('⚠️  無法自動寫回 .env，請手動更新 THREADS_ACCESS_TOKEN。');
    }

    return newToken;
}

/**
 * 取得可用 token：
 * - 預設直接使用現有 token（不每次刷新）
 * - 僅在接近 60 天到期（預設剩 5 天內）時才刷新
 */
export async function getUsableToken(): Promise<string> {
    const { token } = getCredentials();
    const refreshedAtRaw = process.env.THREADS_TOKEN_REFRESHED_AT?.trim();

    if (!refreshedAtRaw) {
        // THREADS_TOKEN_REFRESHED_AT 未設定：無法計算剩餘天數
        // 本地開發時不影響（Token 剛設定通常還很新），但 GitHub Actions 跑久後會悄悄過期
        if (process.env.GITHUB_ACTIONS) {
            console.log('::warning::THREADS_TOKEN_REFRESHED_AT 未設定，無法追蹤 Token 剩餘天數。請在 Repository Secrets 中新增此變數（值為 Token 最後刷新的 ISO 時間，例如 2026-04-19T00:00:00.000Z）。');
        }
        return token;
    }

    const refreshedAt = new Date(refreshedAtRaw);
    if (Number.isNaN(refreshedAt.getTime())) {
        console.warn('⚠️  THREADS_TOKEN_REFRESHED_AT 格式錯誤，請填入 ISO 格式（例：2026-04-19T00:00:00.000Z）。');
        return token;
    }

    const ageDays = (Date.now() - refreshedAt.getTime()) / (24 * 60 * 60 * 1000);
    const daysLeft = Math.floor(TOKEN_MAX_AGE_DAYS - ageDays);

    if (ageDays >= TOKEN_MAX_AGE_DAYS - TOKEN_REFRESH_BUFFER_DAYS) {
        // 剩餘 5 天以內，自動刷新
        console.log(`🔄 Threads Token 剩餘 ${daysLeft} 天，正在自動刷新...`);
        if (process.env.GITHUB_ACTIONS) {
            // 在 GitHub Actions 中刷新後無法自動寫回 Secrets
            // 刷新仍會執行（本次執行正常），但新 Token 不會被持久化
            // 執行後請手動更新 THREADS_ACCESS_TOKEN 與 THREADS_TOKEN_REFRESHED_AT 這兩個 Secret
            console.log('::warning::Token 剩餘天數不足，已嘗試刷新。但 GitHub Actions 無法自動更新 Secrets，請在此次執行後手動更新 THREADS_ACCESS_TOKEN 與 THREADS_TOKEN_REFRESHED_AT。');
        }
        return refreshToken();
    }

    // 正常狀態：顯示剩餘天數供追蹤
    console.log(`   Token 剩餘有效期：${daysLeft} 天`);
    return token;
}

function upsertEnvLine(content: string, key: string, value: string): string {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(content)) {
        return content.replace(pattern, line);
    }
    const suffix = content.endsWith('\n') ? '' : '\n';
    return `${content}${suffix}${line}\n`;
}

// ─── 發文流程（兩步驟） ──────────────────────────────────────────────────────

/**
 * 步驟一：建立 Threads 媒體容器（文字貼文）
 *
 * 容器建立後貼文尚未公開，狀態為 DRAFT
 * 必須再呼叫 publishContainer() 才會正式出現在時間軸上
 * 設計成兩步驟的原因：讓平台有時間做內容審核，降低發布失敗率
 *
 * @param text  - 貼文文字內容（不含 HTML，純文字）
 * @param token - 已刷新的 Access Token
 * @returns creation_id（容器 ID），用於後續發布步驟
 */
export async function createContainer(text: string, token: string): Promise<string> {
    const { userId } = getCredentials();
    const url = new URL(`${THREADS_API_BASE}/${userId}/threads`);
    url.searchParams.set('media_type', 'TEXT');  // 純文字貼文，不含圖片或影片
    url.searchParams.set('text', text);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString(), { method: 'POST' });
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `Threads 建立容器失敗：${response.status}`));

    const id = (data as { id?: string }).id;
    if (!id) throw new Error('Threads 容器回應中缺少 id 欄位。');
    return id;
}

/**
 * 步驟一（圖片版）：建立含圖片的 Threads 媒體容器
 *
 * 與純文字容器的差異：
 * - media_type 改為 IMAGE
 * - 需要額外傳入 image_url（必須是公開 HTTPS URL，不能是 base64 或本機路徑）
 * - text 作為圖片說明文字（caption），可選但建議填入
 *
 * @param imageUrl - 圖片的公開 HTTPS URL（例如 GitHub raw URL）
 * @param caption  - 貼文說明文字
 * @param token    - 已刷新的 Access Token
 * @returns creation_id，用於後續發布步驟
 */
export async function createImageContainer(
    imageUrl: string,
    caption: string,
    token: string,
): Promise<string> {
    const { userId } = getCredentials();
    const url = new URL(`${THREADS_API_BASE}/${userId}/threads`);
    url.searchParams.set('media_type', 'IMAGE');
    url.searchParams.set('image_url', imageUrl);  // 必須是公開可存取的 HTTPS URL
    url.searchParams.set('text', caption);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString(), { method: 'POST' });
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `Threads 建立圖片容器失敗：${response.status}`));

    const id = (data as { id?: string }).id;
    if (!id) throw new Error('Threads 圖片容器回應中缺少 id 欄位。');
    return id;
}

/**
 * 步驟二：將媒體容器發布為公開貼文
 *
 * 呼叫後貼文立即對外公開，無法撤回（只能在 Threads App 手動刪除）
 * 建議在正式環境使用前，先以測試帳號確認貼文內容
 *
 * @param containerId - createContainer() 回傳的 creation_id
 * @param token       - 已刷新的 Access Token
 * @returns 已發布貼文的唯一 ID（可用於後續查詢互動數據）
 */
export async function publishContainer(containerId: string, token: string): Promise<string> {
    const { userId } = getCredentials();
    const url = new URL(`${THREADS_API_BASE}/${userId}/threads_publish`);
    url.searchParams.set('creation_id', containerId);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString(), { method: 'POST' });
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `Threads 發布貼文失敗：${response.status}`));

    const id = (data as { id?: string }).id;
    if (!id) throw new Error('Threads 發布回應中缺少 id 欄位。');
    return id;
}

/**
 * 在不超過字元限制的前提下，於自然斷點分割貼文
 *
 * 分割優先順序：
 *   1. 段落空行（\n\n）→ 最自然的閱讀斷點
 *   2. 句尾標點 + 換行（。\n / ！\n / ？\n）→ 中文句子邊界
 *   3. 純句尾標點（。／！／？）→ 沒有換行也接受
 *   4. 行尾（\n）→ 最後才考慮
 *   5. 硬截斷（強制在限制處切開）→ 保底
 *
 * @param text     - 原始完整文字
 * @param maxChars - 每段上限，預設使用 Threads API 上限（500）
 * @returns [主貼文, 接續留言]；若原文未超限，接續留言為空字串
 */
export function splitForThread(
    text: string,
    maxChars = THREADS_MAX_TEXT_LENGTH,
): [string, string] {
    if (text.length <= maxChars) return [text, ''];

    const searchIn = text.slice(0, maxChars);
    const minBreak = Math.floor(maxChars * 0.4); // 至少保留 40% 才算有意義的斷點

    // 優先順序：段落 > 句子+換行 > 句尾標點 > 行尾
    const candidates: Array<[string, number]> = [
        ['\n\n', 0],
        ['。\n', 1], ['！\n', 1], ['？\n', 1],
        ['。', 2], ['！', 2], ['？', 2],
        ['\n', 3],
    ];

    for (const [mark] of candidates) {
        const idx = searchIn.lastIndexOf(mark);
        if (idx >= minBreak) {
            const breakAt = idx + mark.length;
            return [
                text.slice(0, breakAt).trimEnd(),
                text.slice(breakAt).trimStart(),
            ];
        }
    }

    // 保底：硬截斷
    return [searchIn.trimEnd(), text.slice(maxChars).trimStart()];
}

/**
 * 輪詢 Threads API，等待指定貼文可被查詢（確認 Threads 後端已完成處理）
 *
 * Threads 採非同步後端處理：publishContainer() 回傳 postId 後，
 * 系統可能尚未將貼文完整寫入索引。若此時建立 reply_to_id 指向該貼文的容器，
 * Threads 驗證失敗會刪除 reply container，導致後續 publishContainer 找不到。
 *
 * 每秒輪詢一次，最多等 maxWaitMs（預設 30 秒），超時後不拋錯（靜默繼續）。
 *
 * @param postId    - 要確認存在的已發布貼文 ID
 * @param token     - 有效的 Access Token
 * @param maxWaitMs - 最長等待毫秒數（預設 30000）
 */
export async function waitForPostReady(
    postId: string,
    token: string,
    maxWaitMs = 30_000,
): Promise<void> {
    const started = Date.now();
    const pollInterval = 1500;

    while (Date.now() - started < maxWaitMs) {
        try {
            const url = new URL(`${THREADS_API_BASE}/${postId}`);
            url.searchParams.set('fields', 'id');
            url.searchParams.set('access_token', token);
            const res = await fetch(url.toString());
            if (res.ok) {
                const data = await res.json().catch(() => null);
                if ((data as { id?: string })?.id) return; // 貼文已可查詢
            }
        } catch {
            // 網路暫時失敗，繼續輪詢
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, pollInterval));
    }
    // 超時後靜默繼續，讓後續步驟嘗試
    process.stdout.write('\n');
}

/**
 * 建立 Threads 留言容器（回覆到指定貼文下方）
 *
 * 與 createContainer 差異：加入 reply_to_id 指定目標貼文
 * 容器建立後仍需呼叫 publishContainer() 才會公開
 *
 * @param text      - 留言文字（同樣受 500 字元限制）
 * @param replyToId - 目標貼文的已發布 Post ID（publishContainer 回傳值）
 * @param token     - 已刷新的 Access Token
 * @returns creation_id，用於後續發布步驟
 */
/**
 * 查詢 Threads 媒體容器的處理狀態
 *
 * 可能的狀態值：
 *   FINISHED   - 容器已就緒，可呼叫 publishContainer() 發布
 *   IN_PROGRESS- 正在處理（圖片 / 影片上傳中）
 *   PUBLISHED  - 已直接發布（部分 TEXT reply container 會跳過 staging）
 *   ERROR      - 處理失敗；error_message 包含原因
 *
 * @returns { status, errorMessage } — errorMessage 只在 ERROR 時有值
 */
export async function getContainerStatus(
    containerId: string,
    token: string,
): Promise<{ status: string; errorMessage?: string }> {
    const url = new URL(`${THREADS_API_BASE}/${containerId}`);
    url.searchParams.set('fields', 'status,error_message');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    const data = await res.json().catch(() => null);
    const d = data as Record<string, unknown> | null;

    return {
        status: (d?.status as string | undefined) ?? 'UNKNOWN',
        errorMessage: d?.error_message as string | undefined,
    };
}

/**
 * 輪詢 container 狀態，等到 FINISHED 或 PUBLISHED 後回傳最終狀態
 *
 * IN_PROGRESS 是正常的中間狀態（圖片上傳 / reply 驗證都會經過），
 * 需要持續輪詢直到終態才能進行下一步。
 *
 * @param containerId - 要等待的容器 ID
 * @param token       - 有效的 Access Token
 * @param maxWaitMs   - 最長等待毫秒數（預設 30000）
 * @returns 最終狀態字串；超時仍回傳最後一次查到的狀態
 */
export async function waitForContainerReady(
    containerId: string,
    token: string,
    maxWaitMs = 30_000,
): Promise<{ status: string; errorMessage?: string }> {
    const started = Date.now();
    const pollInterval = 1500;
    let last: { status: string; errorMessage?: string } = { status: 'IN_PROGRESS' };

    while (Date.now() - started < maxWaitMs) {
        last = await getContainerStatus(containerId, token);
        if (last.status === 'FINISHED' || last.status === 'PUBLISHED' || last.status === 'ERROR') {
            return last;
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, pollInterval));
    }
    process.stdout.write('\n');
    return last; // 超時，回傳最後狀態讓呼叫端決定
}

export async function createReplyContainer(
    text: string,
    replyToId: string,
    token: string,
): Promise<string> {
    const { userId } = getCredentials();
    const url = new URL(`${THREADS_API_BASE}/${userId}/threads`);
    url.searchParams.set('media_type', 'TEXT');
    url.searchParams.set('text', text);
    url.searchParams.set('reply_to_id', replyToId);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString(), { method: 'POST' });
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `Threads 建立留言容器失敗：${response.status}`));

    const id = (data as { id?: string }).id;
    if (!id) throw new Error('Threads 留言容器回應中缺少 id 欄位。');
    return id;
}

// ─── 資料擷取型別 ────────────────────────────────────────────────────────────

/**
 * 單篇貼文的基本資訊
 * 從 GET /{userId}/threads 取得，只包含 id、內文與發文時間
 */
export type ThreadPost = {
    id: string;
    text: string;
    timestamp: string;  // ISO 8601 格式，例如 "2026-04-10T08:00:00+0000"
};

/**
 * 單篇貼文的互動數據（包含加權後的綜合分數）
 *
 * engagementScore 加權邏輯：
 * - 回覆（×4）、轉發（×5）、引用（×4）比按讚（×3）更代表真實互動品質
 * - 按讚可能是習慣性行為，回覆與轉發才代表讀者真正被打動
 */
export type PostInsights = {
    postId: string;
    text: string;
    timestamp: string;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    engagementScore: number;  // 綜合互動分數：likes×3 + replies×4 + reposts×5 + quotes×4
};

// ─── 資料擷取 API ────────────────────────────────────────────────────────────

/**
 * 取得自己帳號的貼文列表，可指定起始日期篩選
 *
 * Threads API 限制：單次最多回傳 25 筆，超過需使用 pagination cursor
 * 目前以 limit=50 請求，若單週超過 50 篇可能需要實作分頁邏輯
 *
 * @param token     - Access Token
 * @param sinceDate - 只取此時間之後的貼文（ISO 字串，例如 weekAgo.toISOString()）
 * @returns 貼文陣列，依時間由新到舊排列，已過濾純圖片等無文字貼文
 */
export async function fetchMyPosts(token: string, sinceDate: string): Promise<ThreadPost[]> {
    const { userId } = getCredentials();
    const url = new URL(`${THREADS_API_BASE}/${userId}/threads`);
    url.searchParams.set('fields', 'id,text,timestamp');  // 只取分析需要的欄位，節省流量
    url.searchParams.set('since', sinceDate);
    url.searchParams.set('access_token', token);
    url.searchParams.set('limit', '50');  // 略高於預設的 25，確保一週以上的貼文都能取到

    const response = await fetch(url.toString());
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `取得貼文列表失敗：${response.status}`));

    type ApiResponse = { data?: Array<{ id: string; text?: string; timestamp: string }> };
    const posts = (data as ApiResponse).data ?? [];

    // 過濾掉純圖片等沒有文字的貼文，避免空字串進入 AI 分析造成錯誤
    return posts
        .filter(p => p.text && p.text.trim().length > 0)
        .map(p => ({ id: p.id, text: p.text!, timestamp: p.timestamp }));
}

/**
 * 取得單篇貼文的互動數據，並計算加權互動分數
 *
 * @param postId    - 貼文 ID（來自 fetchMyPosts 的結果）
 * @param postText  - 貼文文字（一起帶入方便後續分析，避免再次查詢）
 * @param timestamp - 發文時間（同上理由一起帶入）
 * @param token     - Access Token
 * @returns 包含各項互動數值與加權分數的 PostInsights 物件
 */
export async function fetchPostInsights(
    postId: string,
    postText: string,
    timestamp: string,
    token: string,
): Promise<PostInsights> {
    const url = new URL(`${THREADS_API_BASE}/${postId}/insights`);
    // 一次取得所有需要的互動指標，減少 API 呼叫次數
    url.searchParams.set('metric', 'views,likes,replies,reposts,quotes');
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString());
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new Error(parseError(data, `取得貼文洞察失敗：${response.status}`));

    // API 回傳格式：[{ name: 'likes', values: [{ value: 5 }] }, ...]
    // 用 get() 輔助函式統一處理取值與找不到時的預設值 0
    type MetricItem = { name: string; values: Array<{ value: number }> };
    type InsightsResponse = { data?: MetricItem[] };
    const metrics = (data as InsightsResponse).data ?? [];
    const get = (name: string) => metrics.find(m => m.name === name)?.values[0]?.value ?? 0;

    const likes = get('likes');
    const replies = get('replies');
    const reposts = get('reposts');
    const quotes = get('quotes');

    return {
        postId,
        text: postText,
        timestamp,
        views: get('views'),
        likes,
        replies,
        reposts,
        quotes,
        // 加權分數：以轉發（×5）和引用（×4）為主要訊號，兩者難以自行刷高
        // replies 不計入：bot 自動回覆留言會計入此數字，造成分數虛高
        // views 不計入：曝光量龐大會稀釋真實互動的比例差異
        engagementScore: likes * 3 + reposts * 5 + quotes * 4,
    };
}

/**
 * 取得自己帳號的基本資料（id 與 username）
 * 用於 engage 過濾自己的留言，避免 bot 重複回覆自己的回應
 */
export async function getMyProfile(token: string): Promise<{ id: string; username: string }> {
    const url = new URL(`${THREADS_API_BASE}/me`);
    url.searchParams.set('fields', 'id,username');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(parseError(data, `取得帳號資料失敗：${res.status}`));

    const d = data as { id?: string; username?: string };
    if (!d.id || !d.username) throw new Error('API 回應缺少 id 或 username 欄位。');
    return { id: d.id, username: d.username };
}

// ─── 外部貼文查詢 ────────────────────────────────────────────────────────────

/**
 * 將 Threads 貼文 URL 或 shortcode 解析成數字型 media ID
 *
 * Threads URL 格式：https://www.threads.net/@username/post/SHORTCODE
 * Shortcode 是以下 64 字元字母表的 Base64 編碼整數：
 *   ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_
 *
 * @param input - 接受三種格式：
 *   1. 完整 URL（https://www.threads.net/@user/post/XXXXX）
 *   2. 純 shortcode（英數字與 -_）
 *   3. 純數字 ID（直接回傳）
 */
export function parseThreadsPostId(input: string): string {
    const trimmed = input.trim();

    // 已經是數字 ID，直接回傳
    if (/^\d+$/.test(trimmed)) return trimmed;

    // 從 URL 取出 shortcode
    const urlMatch = trimmed.match(/\/post\/([A-Za-z0-9_-]+)/);
    const shortcode = urlMatch ? urlMatch[1] : trimmed;

    // 確認是有效的 shortcode 格式（長度 8+ 且只含 Base64URL 字元）
    if (!/^[A-Za-z0-9_-]{8,}$/.test(shortcode)) {
        throw new Error(
            `無法解析：「${input}」\n` +
            `請提供 Threads 貼文 URL（如 https://www.threads.net/@user/post/XXXXX）或數字 ID。`,
        );
    }

    // Base64URL → 數字 ID（使用 BigInt 避免 JS 整數精度問題）
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let n = 0n;
    for (const ch of shortcode) {
        const idx = ALPHA.indexOf(ch);
        if (idx === -1) throw new Error(`shortcode 含無效字元：${ch}`);
        n = n * 64n + BigInt(idx);
    }
    return n.toString();
}

/**
 * 單則外部（或自己的）貼文資訊
 * 由 getPost() 回傳，包含作者帳號名稱
 */
export type ThreadsPostDetail = {
    id: string;
    text: string;
    username: string;
    timestamp: string;
};

/**
 * 取得指定貼文的內容與作者資訊
 *
 * 注意：讀取他人貼文需要貼文為公開狀態；
 * 若 API 回傳 403 / 100，表示沒有讀取權限（貼文不公開或需要進階 scope）。
 *
 * @param postId - Threads media ID（數字字串）
 * @param token  - Access Token
 */
export async function getPost(postId: string, token: string): Promise<ThreadsPostDetail> {
    const url = new URL(`${THREADS_API_BASE}/${postId}`);
    url.searchParams.set('fields', 'id,text,username,timestamp');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) throw new Error(parseError(data, `取得貼文失敗：${res.status}`));

    const d = data as Partial<ThreadsPostDetail>;
    if (!d.id) throw new Error('API 回應缺少貼文 id 欄位。');
    return {
        id: d.id,
        text: d.text ?? '',
        username: d.username ?? '（未知）',
        timestamp: d.timestamp ?? '',
    };
}

/**
 * 單則留言（貼文下的直接回覆）
 */
export type ThreadsReply = {
    id: string;
    text: string;
    username: string;
    timestamp: string;
};

/**
 * 取得指定貼文的直接留言列表
 *
 * 需要帳號擁有 threads_manage_replies 或 threads_read_replies 權限。
 * 只取第一頁（最多 25 則）；高互動貼文可能需要分頁（目前未實作）。
 *
 * @param postId - 要查詢留言的貼文 ID
 * @param token  - Access Token
 * @returns 留言陣列；若該貼文無留言或無權限則回傳空陣列
 */
export async function getPostReplies(postId: string, token: string): Promise<ThreadsReply[]> {
    const url = new URL(`${THREADS_API_BASE}/${postId}/replies`);
    url.searchParams.set('fields', 'id,text,username,timestamp');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) {
        // 沒有讀取留言的權限時，靜默回傳空陣列（不中止整個 engage 流程）
        console.warn(`   ⚠️  無法取得貼文 ${postId} 的留言（${res.status}），略過。`);
        return [];
    }

    type RepliesResponse = { data?: Array<Partial<ThreadsReply>> };
    const items = (data as RepliesResponse).data ?? [];
    return items
        .filter(r => r.id && r.text && r.text.trim().length > 0)
        .map(r => ({
            id: r.id!,
            text: r.text!,
            username: r.username ?? '（未知）',
            timestamp: r.timestamp ?? '',
        }));
}
