// GlowPulse Agent — 唯一有副作用的入口
// 讀取 CLI 參數決定執行哪個任務，統一處理結果與退出碼
// 新增任務時：在 tasks/ 建新模組，在此 import 並加入 switch 即可

import 'dotenv/config';
import { runAutoPost } from './tasks/autoPost.js';
import { analyzeAndReply } from './tasks/analyzeReply.js';
import { runWeeklyReport } from './tasks/weeklyReport.js';
import { runImagePost } from './tasks/imagePost.js';
import { runAnalyzeReference } from './tasks/analyzeReference.js';
import { runReplyTo } from './tasks/replyTo.js';
import { runEngage } from './tasks/engage.js';
import { runGenStyles } from './tasks/genStyles.js';

// 從 CLI 參數解析執行模式與選項
// 範例：tsx src/agent.ts --post
//        tsx src/agent.ts --post --max-chars 200
//        tsx src/agent.ts --analyze "貼文內容"
const args = process.argv.slice(2);
const mode = args[0];

/**
 * 解析 --max-chars N 參數
 * 找不到或值非正整數時回傳 undefined（使用預設行為）
 */
function parseMaxChars(): number | undefined {
    const idx = args.indexOf('--max-chars');
    if (idx === -1) return undefined;
    const val = parseInt(args[idx + 1] ?? '', 10);
    if (!Number.isFinite(val) || val <= 0) {
        console.warn('⚠️  --max-chars 需要一個正整數，已忽略此參數。');
        return undefined;
    }
    return val;
}

const maxChars = parseMaxChars();
const useLatest = args.includes('--latest');

// --yes：自動確認所有互動提示，適用於排程執行（GitHub Actions / cron）
// 透過環境變數傳遞，讓 confirm.ts 工具函式能讀到，不需逐層傳遞參數
if (args.includes('--yes')) {
    process.env.GLOW_AUTO_CONFIRM = '1';
}

async function main(): Promise<void> {
    switch (mode) {
        case '--post': {
            // 自動生成並發布今日 GlowMoment 宣傳貼文
            const result = await runAutoPost(maxChars);
            if (!result.success) {
                console.error('\n❌ 發文失敗：', result.error);
                process.exit(1);
            }
            console.log('\n🎉 自動發文完成！');
            console.log(`   功能：${result.feature}　風格：${result.style}`);
            console.log(`   Post ID：${result.postId}`);
            break;
        }

        case '--analyze': {
            // 分析指定貼文並產出回覆文案（貼文內容從第二個參數傳入）
            const postContent = args[1];
            if (!postContent) {
                console.error('用法：ts-node --esm src/agent.ts --analyze "貼文內容"');
                process.exit(1);
            }
            console.log(`🔍 正在分析貼文：${postContent}`);
            const reply = await analyzeAndReply(postContent);
            if (reply) {
                console.log('\n✅ 建議回覆：');
                console.log('─'.repeat(40));
                console.log(reply);
                console.log('─'.repeat(40));
            } else {
                console.log('\n⏭️  此貼文不屬於潛在客戶，略過。');
            }
            break;
        }

        case '--all': {
            // 完整每日任務：先發文，再分析範例貼文（未來可接爬蟲資料）
            console.log('=== [1/2] 自動發文 ===');
            const postResult = await runAutoPost();
            if (!postResult.success) {
                console.error('❌ 發文失敗：', postResult.error);
            } else {
                console.log(`🎉 發文完成，Post ID：${postResult.postId}`);
            }

            console.log('\n=== [2/2] 分析示範貼文 ===');
            const samplePost = '最近預約美甲都要私訊好久喔，小編都不回，超煩的...';
            console.log(`📝 示範貼文：${samplePost}`);
            const reply = await analyzeAndReply(samplePost);
            if (reply) {
                console.log('\n✅ 建議回覆：', reply);
            } else {
                console.log('⏭️  略過（非潛在客戶貼文）。');
            }
            break;
        }

        case '--report': {
            // 產生過去 7 天的發文成效週報，並輸出 AI 改進建議
            const result = await runWeeklyReport();
            if (!result.success) {
                console.error('\n❌ 週報產生失敗：', result.error);
                process.exit(1);
            }
            console.log(`\n🎉 週報完成！分析了 ${result.totalPosts} 篇貼文`);
            console.log(`   報告位置：${result.reportPath}`);
            break;
        }

        case '--image-post': {
            // 讀取截圖 → AI 生成畫面描述與文案 → 發布圖片貼文
            const result = await runImagePost(maxChars, useLatest);
            if (!result.success) {
                console.error('\n❌ 圖片發文失敗：', result.error);
                process.exit(1);
            }
            console.log('\n🎉 圖片貼文發布完成！');
            console.log(`   截圖：${result.filename}　功能：${result.feature}`);
            console.log(`   Post ID：${result.postId}`);
            break;
        }

        case '--reply-to': {
            // 分析指定貼文，若為潛在客戶則直接回覆到 Threads
            const urlOrId = args[1];
            if (!urlOrId) {
                console.error('用法：npm run reply-to "https://www.threads.net/@user/post/XXXXX"');
                console.error('      npm run reply-to "數字ID"');
                process.exit(1);
            }
            const result = await runReplyTo(urlOrId);
            if (!result.success) {
                if (result.skipped) {
                    console.log('\n⏭️  略過（非潛在客戶貼文）。');
                } else {
                    console.error('\n❌ 回覆失敗：', result.error);
                    process.exit(1);
                }
            } else {
                console.log('\n🎉 回覆發布完成！');
                console.log(`   Reply Post ID：${result.replyPostId}`);
            }
            break;
        }

        case '--engage': {
            // 掃描自己近期貼文的留言，找潛在客戶並逐一確認回覆
            const result = await runEngage();
            if (!result.success) {
                console.error('\n❌ Engage 失敗：', result.error);
                process.exit(1);
            }
            console.log(`\n✅ 完成！掃描 ${result.postsScanned} 篇 · 分析 ${result.repliesAnalyzed} 則留言 · 回覆 ${result.replied} 則`);
            break;
        }

        case '--analyze-reference': {
            // 解析參考貼文庫，AI 提取寫作模式，自動更新 brand.ts / styles.ts
            const result = await runAnalyzeReference();
            if (!result.success) {
                console.error('\n❌ 分析失敗：', result.error);
                process.exit(1);
            }
            console.log(`\n🎉 參考貼文分析完成！共分析 ${result.postsAnalyzed} 篇貼文`);
            if (result.updatedFiles.length > 0) {
                console.log(`   已更新：${result.updatedFiles.join('、')}`);
            }
            break;
        }

        case '--gen-styles': {
            // 從 BRAND_CONTEXT 的寫作技巧自動衍生新 POST_STYLES，擴充風格庫
            const result = await runGenStyles();
            if (!result.success) {
                console.error('\n❌ 風格生成失敗：', result.error);
                process.exit(1);
            }
            if (result.newStylesCount > 0) {
                console.log(`\n🎉 風格庫已擴充！新增 ${result.newStylesCount} 個風格，共 ${result.totalStyles} 個`);
            } else {
                console.log('\n✅ 完成（未新增風格）');
            }
            break;
        }

        default:
            console.log(`
GlowPulse Agent — GlowMoment 社群自動化工具

用法：
  npm run post                              自動生成並發布今日宣傳貼文
  npm run post -- --max-chars 150          發布 150 字元以內的短貼文
  npm run image-post                               讀取截圖，AI 生成描述與文案後發布圖片貼文
  npm run image-post -- --latest                   使用最新加入的截圖（screenshots.ts 最後一筆）
  npm run image-post -- --max-chars 200            發布 200 字元以內的圖片貼文
  npm run image-post -- --latest --max-chars 200   最新截圖 + 字數限制
  npm run analyze "貼文內容"               分析貼文並產出回覆建議（不發布）
  npm run reply-to "貼文URL或ID"           分析指定貼文，若為潛在客戶則直接回覆到 Threads
  npm run engage                           掃描自己近期貼文的留言，逐一回覆潛在客戶
  npm run all                              執行完整每日任務（發文 + 分析）
  npm run learn                            分析 reference-posts.md，AI 提取寫作模式並更新 data 層
  npm run gen-styles                       從 brand.ts 的寫作技巧自動衍生新發文風格，擴充風格庫
  npm run report                           產生本週發文成效報告 + AI 改進建議

選項：
  --max-chars N        限制貼文字數上限為 N 字元；超過時會詢問重新生成或留言接續
                       適用於 --post 與 --image-post
  --latest             使用 screenshots.ts 最後一筆截圖（最新加入的）
                       適用於 --image-post

模式說明：
  --post               依今日日期選定功能與風格，AI 生成貼文後發布到 Threads
  --image-post         隨機選取截圖，AI 分析截圖畫面並生成搭配文案，發布圖片貼文
  --analyze            對指定貼文進行零樣本分類，判斷是否為潛在客戶並產出回覆
  --reply-to           接受 Threads 貼文 URL 或數字 ID；自動取得貼文內容（公開貼文）
                       → 零樣本分類 → 生成回覆 → 確認後發布到 Threads
                       若 API 無法取得貼文內容，會要求手動貼上
  --engage             取最近 7 天自己貼文的留言 → 分類每則留言 → 找到潛在客戶後
                       逐一顯示建議回覆，確認後發布；需要帳號有 threads_manage_replies 權限
  --all                依序執行 post 與 analyze（適合排程使用）
  --analyze-reference  讀取 docs/reference-posts.md，AI 提取高流量貼文的寫作模式，
                       自動更新 brand.ts（寫作原則）與 styles.ts（風格指令）
  --gen-styles         讀取 BRAND_CONTEXT 的【從優質貼文學到的技巧】，AI 將每條技巧
                       轉化成新的 PostStyle 條目，擴充 styles.ts 風格庫（7-9 個風格）
  --report             擷取過去 7 天貼文的互動數據，AI 分析高低互動差異，
                       輸出對 brand.ts / styles.ts 的具體修改建議，
                       報告儲存於 docs/reports/YYYY-MM-DD.md
`);
            break;
    }
}

main().catch((error) => {
    console.error('\n💥 發生未預期的錯誤：', error);
    process.exit(1);
});
