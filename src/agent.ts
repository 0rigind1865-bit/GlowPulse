// GlowPulse Agent — 唯一有副作用的入口
// 讀取 CLI 參數決定執行哪個任務，統一處理結果與退出碼
// 新增任務時：在 tasks/ 建新模組，在此 import 並加入 switch 即可

import 'dotenv/config';
import { runAutoPost } from './tasks/autoPost.js';
import { analyzeAndReply } from './tasks/analyzeReply.js';
import { runWeeklyReport } from './tasks/weeklyReport.js';
import { runImagePost } from './tasks/imagePost.js';
import { runAnalyzeReference } from './tasks/analyzeReference.js';

// 從 CLI 參數解析執行模式
// 範例：ts-node --esm src/agent.ts --post
//        ts-node --esm src/agent.ts --analyze "貼文內容"
const args = process.argv.slice(2);
const mode = args[0];

async function main(): Promise<void> {
    switch (mode) {
        case '--post': {
            // 自動生成並發布今日 GlowMoment 宣傳貼文
            const result = await runAutoPost();
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
            const result = await runImagePost();
            if (!result.success) {
                console.error('\n❌ 圖片發文失敗：', result.error);
                process.exit(1);
            }
            console.log('\n🎉 圖片貼文發布完成！');
            console.log(`   截圖：${result.filename}　功能：${result.feature}`);
            console.log(`   Post ID：${result.postId}`);
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

        default:
            console.log(`
GlowPulse Agent — GlowMoment 社群自動化工具

用法：
  npm run post                         自動生成並發布今日宣傳貼文
  npm run image-post                   讀取截圖，AI 生成描述與文案後發布圖片貼文
  npm run analyze "貼文內容"            分析貼文並產出回覆建議
  npm run all                          執行完整每日任務（發文 + 分析）
  npm run learn                        分析 reference-posts.md，AI 提取寫作模式並更新 data 層
  npm run report                       產生本週發文成效報告 + AI 改進建議

模式說明：
  --post               依今日日期選定功能與風格，AI 生成貼文後發布到 Threads
  --image-post         依今日日期選定截圖，AI 分析截圖畫面並生成搭配文案，發布圖片貼文
  --analyze            對指定貼文進行零樣本分類，判斷是否為潛在客戶並產出回覆
  --all                依序執行 post 與 analyze（適合排程使用）
  --analyze-reference  讀取 docs/reference-posts.md，AI 提取高流量貼文的寫作模式，
                       自動更新 brand.ts（寫作原則）與 styles.ts（風格指令）
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
