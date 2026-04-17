# 更新專案架構說明

檢查今天修改或新增了哪些檔案，並將變更同步到 `docs/專案架構說明.md`。

## 執行步驟

1. 用 Bash 執行以下指令，列出今天修改過的專案檔案（排除 node_modules 與 reports）：
   ```bash
   find /Users/linjie/Documents/GitHub/GlowPulse/src /Users/linjie/Documents/GitHub/GlowPulse/docs /Users/linjie/Documents/GitHub/GlowPulse/.claude -newer /Users/linjie/Documents/GitHub/GlowPulse/docs/專案架構說明.md -type f 2>/dev/null | grep -v node_modules | grep -v "docs/reports"
   ```

2. 讀取 `docs/專案架構說明.md` 目前的內容

3. 針對每個有變動的檔案，判斷需要更新哪些區塊：
   - **新增檔案** → 加入目錄結構與對應的職責說明
   - **src/services/** 新增或修改 → 更新「外部 API 封裝」區塊與資料流向圖
   - **src/tasks/** 新增或修改 → 更新「業務流程」區塊與資料流向圖、agent.ts 指令表
   - **src/data/** 修改 → 更新「產品知識庫」的修改時機說明
   - **src/agent.ts** 修改 → 更新 CLI 參數對應表
   - **docs/** 新增檔案 → 加入目錄結構
   - **package.json** 修改 → 更新常用指令區塊
   - **.env** 修改（新增變數）→ 更新環境變數表格
   - **後續擴充方向** → 若功能已實作，從「後續可擴充」移到對應的正式區塊

4. 用 Edit 工具更新 `docs/專案架構說明.md`，只修改有變動的區塊，保留其他內容不動

5. 回報更新了哪些區塊，以及原因
