# 布告欄資料格式 / Bulletin board format

布告欄的內容全部來自 `data/board.json`。第一次啟動時，伺服器會從 `data/board.example.json` 複製一份；之後你（或你的 AI Agent）直接編輯 `data/board.json` 就好。`data/board.json` 不進版控。

The board reads `data/board.json`. On first start it is copied from `data/board.example.json`; after that, edit `data/board.json` directly (by hand or let an agent do it). It is git-ignored.

- 頁面每 2 秒檢查一次檔案有沒有變，改完幾秒內就會自動更新，不用重新整理。
- 伺服器只會在兩種情況寫這個檔：在布告欄介面勾選／取消勾選待辦、換月自動結算。寫之前都會備份成 `board.json.bak`。

## 編輯時的注意事項

1. **原子寫入**：先寫到同資料夾的暫存檔，確認內容正確後再改名成 `board.json`，避免辦公室剛好讀到寫一半的檔案。
2. **合法 JSON**：UTF-8、雙引號、不能有尾逗號或註解。格式錯誤時，布告欄繼續顯示上一版內容並出現紅色提示，伺服器不會覆蓋壞掉的檔案。
3. **先讀再改**：可能剛有人勾掉待辦，所以每次都先讀最新的檔案，只改要改的欄位，保留其他欄位（包括 `done`、`doneAt`、`history`、`lastMonth`）。
4. **數字就寫數字**：金額、件數不要加逗號、單位或引號，例如 `18500`。未知就寫 `null`。
5. **id**：只能用英數、`-`、`_`，最長 40 字，同一個陣列裡不能重複。
6. 不要動 `history`（每月快照由伺服器換月時自動產生）和 `lastMonth`，除非要更正歷史。
7. 檔案裡不要放密碼、token 或客戶個資。

## 欄位

完整範例見 [`data/board.example.json`](../data/board.example.json)。

| 欄位 | 說明 |
|---|---|
| `goal.text` | 年度目標，一兩句話（最多 500 字） |
| `goal.amount` | 年度營收目標金額（數字，未定就寫 `null`，介面顯示「目標待定」） |
| `kpis[]` | KPI 卡：`id`、`name`、`unit`、`type`（`manual` 或 `auto`）、`value`、`target`、`note`。達標（`value ≥ target`）時卡片轉金色 |
| 自動 KPI `cases` | 書架上狀態為「進行中」的專案數 |
| 自動 KPI `tasks-done` | 任務資料夾裡本月修改過、有一行 `- 狀態：完成…`（或 `- Status: done…`）的 md 檔數 |
| KPI `revenue` | 首頁「本月實收」顯示這張卡的 `value` |
| `weekly[]` | 本週重點便利貼：`{ "id", "text" }`，最多顯示 6 張 |
| `todos[]` | 待辦：`{ "id", "text", "done", "file" }`。`file` 是任務資料夾裡的檔名，點了可以看全文。已完成的變灰排在後面，只顯示最近 5 筆 |
| `archive.projects[]` | 各案：`name`、`period`、`status`（進行中／暫停／已結案）、`contract`（合約金額）、`received`（已收）、`note` |
| `history[]` | 每月快照（伺服器換月時自動產生），KPI 趨勢線用最近 5 個月加本月 |
| `lastMonth` | 目前月份（YYYY-MM），由伺服器維護 |

計算方式：

- 已收總額＝所有案子 `received` 加總。
- 待收尾款＝各案 `contract − received` 加總（`contract` 是 `null` 的案子不算，介面會標「合約待補」）。
- 已結案收入合計＝狀態含「結案」的 `received` 加總。
- 舊欄位 `revenue`（只有一個收入數字）仍可讀：只在記憶體裡當成 `received`，不會改寫檔案。

貨幣符號在 `office.config.json` 的 `company.currency` 設定（預設 `$`）。

## 書架（專案資料庫）

`data/projects/` 底下每個子資料夾是一本書。資料夾裡可以放 `project.json`：

```json
{ "name": "燈塔咖啡官網", "spine": "燈塔咖啡", "status": "進行中" }
```

- `spine` 是書背文字（中文一字一行，英數字連在一起橫寫，最多 6 組），`status` 決定書背顏色：深藍＝進行中、琥珀＝暫停、灰綠＝已結案。
- 介面列出資料夾第一層的檔案，以及再下一層子資料夾裡的檔案。Markdown 和 `.txt` 顯示內容，圖片顯示縮圖，其他檔案（程式、試算表等）只顯示檔名。
- 名稱含 `evidence`、`screenshot`、`證據`、`截圖` 的子資料夾只列圖片。
- 內容疑似含 API 金鑰、token 或密碼的文字檔，以及檔名含 secret／token／password／`.env` 等字的檔案，一律不列出。
- 書架資料夾路徑在 `office.config.json` 的 `data.projects` 設定。
