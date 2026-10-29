# Agent Office 3D

把你的 AI Coding Agent 變成一間 3D 辦公室裡的員工：誰在工作、誰閒著、誰卡在權限確認，一眼就看得到。閒著的員工會去倒咖啡、上跑步機、摸貓，或是偷玩 Minecraft。

Turn your AI coding agents into staff in a little 3D office. See at a glance who is working, who is idle and who is stuck on a permission prompt. Idle staff grab coffee, hit the treadmill, pet the cat, or sneak in a round of Minecraft.

[English](#english) ・ Built with [Claude Code](https://claude.com/claude-code) ・ Made by SparCode studio

![Agent Office 3D 預設畫面（示範模式）](docs/screenshots/office.png)

> 截圖都是示範模式（demo），員工、任務、專案和金額全部是虛構的。

⭐ 覺得有趣的話，歡迎幫這個 repo 點個星星，讓更多人看到！
⭐ If you find this fun, a star on the repo would mean a lot!

## 功能

- **員工即時狀態**：每位 Agent 一個座位，狀態燈與名牌顯示「工作中／閒置／完成待命／需要確認」。需要確認時名牌變紅、頭上冒驚嘆號。
- **看終端畫面**：點員工可以看他最近的終端輸出（只讀，不能從這裡下指令）。
- **閒置時的小動作**：倒咖啡、喝水、跑步機、伸懶腰、打瞌睡、偷玩內建小遊戲；有開 Minecraft 的話，螢幕上是他自己的 Minecraft 機器人第一人稱畫面。
- **布告欄**：年度目標、KPI、本週重點、現金流、待辦清單。點布告欄會飛過去打開全螢幕介面，待辦可以直接勾選。
- **書架＝專案資料庫**：每本書是一個專案資料夾，點了可以看裡面的 Markdown 文件和截圖（只讀）。
- **任務清單**：右側列出任務資料夾裡的檔案，點了看全文。
- **一隻貓**：在走道散步、趴睡、跳上空桌。

| 布告欄 | 書架專案介面 |
|---|---|
| ![布告欄首頁：現金流與年度目標](docs/screenshots/board.png) | ![書架：專案資料庫](docs/screenshots/bookshelf.png) |

## 需求

- **Node.js 20 以上**（必要）
- **Java 21 以上＋ Minecraft Java 版伺服器**（選用，只有想讓員工玩 Minecraft 才需要）
- 一個支援 WebGL 的瀏覽器（Chrome、Edge、Safari、Firefox）

支援平台：macOS、Linux。**Windows 為實驗性支援**：CI 會在 Windows 上跑安裝、語法檢查與示範模式測試，但作者沒有 Windows 實機驗證過，Minecraft 在 Windows 上也還沒實測。

## 安裝與啟動

### macOS／Linux

```bash
git clone https://github.com/jefferysha0627/agent-office-3d.git agent-office-3d
cd agent-office-3d
npm ci
npm start
```

### Windows（PowerShell）

```powershell
git clone https://github.com/jefferysha0627/agent-office-3d.git agent-office-3d
cd agent-office-3d
npm ci
npm start
```

啟動後會自動打開 http://127.0.0.1:4870/ 。預設是**示範模式**：不需要任何 Agent，員工狀態會自動輪播，讓你先看到效果。按 `Ctrl+C` 停止。

## 設定

把 `office.config.example.json` 複製成 `office.config.json` 再修改（`office.config.json` 不進版控）。沒有 `office.config.json` 時會直接用範例設定。

```bash
cp office.config.example.json office.config.json        # macOS／Linux
Copy-Item office.config.example.json office.config.json  # Windows PowerShell
```

| 欄位 | 說明 |
|---|---|
| `port` | 連接埠，預設 `4870` |
| `openBrowser` | 啟動後是否自動開瀏覽器 |
| `company.name` | 公司名稱（標題列） |
| `company.currency` | 布告欄的貨幣符號，例如 `$`、`NT$` |
| `company.logo` | 牆上招牌的 Logo（寬版圖，SVG／PNG／JPG），路徑相對於專案資料夾 |
| `company.mark` | 小圖示（標題列、網頁圖示、制服徽章），建議正方形 |
| `owner.name`、`owner.title` | 坐在主管桌的人（你）的名字與職稱。主管桌只是擺設，不接任何狀態 |
| `cat.name` | 貓的名字 |
| `staff[]` | 員工清單：`id`（Agent 名稱，要和狀態來源裡的名字一樣）、`title`（職稱）、`color`（制服滾邊顏色）。最多 8 位，依序坐前排再坐後排；剩下的座位給清單以外的 Agent |
| `source.type` | 狀態來源：`demo`（假狀態輪播，預設）或 `herdr` |
| `source.herdr.bin` | Herdr 執行檔，預設找 PATH 上的 `herdr`；也可以寫完整路徑 |
| `source.herdr.args` | 加在每個 herdr 指令前面的參數（一般不用設） |
| `data.board` | 布告欄資料，預設 `data/board.json`（第一次啟動從 `data/board.example.json` 複製） |
| `data.projects` | 書架的專案資料夾，預設 `data/projects` |
| `data.tasks` | 任務清單資料夾，預設 `data/tasks` |
| `minecraft.enabled` | 是否啟動 Minecraft，預設 `false` |
| `minecraft.java` | Java 執行檔，預設 `java` |
| `minecraft.memory` | Minecraft 伺服器記憶體上限，預設 `2G` |

布告欄與書架的資料格式見 [docs/board-format.md](docs/board-format.md)。

### 接上真的 Agent：Herdr 模式

[Herdr](https://github.com/herdrdev/herdr) 是給 Coding Agent 用的終端機多工工具。用 Herdr 開好你的 Agent 之後：

1. `office.config.json` 的 `source.type` 改成 `"herdr"`。
2. `staff[].id` 改成你在 Herdr 裡的 Agent 名稱。
3. `npm start`。

辦公室只會呼叫 Herdr 的唯讀指令（`herdr agent list`、`herdr agent read`），程式裡有白名單擋住其他指令，不會送鍵、不會替你按確認。Herdr 在 Windows 上目前是 beta；Herdr 模式在 Windows 上未經實測。

想接其他工具？在 `lib/sources.js` 加一個 adapter，回傳同樣格式的員工清單（名稱、狀態、終端最後幾行）即可。

## Minecraft（選用）

員工閒置時會進同一個 Minecraft 世界：挖礦、砍樹、蓋小屋。每位員工一個 [Mineflayer](https://github.com/PrismarineJS/mineflayer) 機器人，畫面用 [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) 串到他桌上的螢幕。

![員工螢幕上的 Minecraft 第一人稱畫面：準星、快捷欄、手持方塊都是機器人的真實狀態](docs/screenshots/minecraft.png)

```bash
npm run minecraft:setup
```

這個指令會依序：

1. 檢查 Java 21 以上；沒有的話，顯示 macOS、Windows、Linux 的安裝方式。
2. 顯示 [Minecraft EULA](https://aka.ms/MinecraftEULA) 連結，**你自己讀完並輸入 `yes`** 才會寫入 `eula=true`。輸入其他內容就取消，不會下載任何東西。
3. 從 Mojang 官方版本清單下載 1.21.4 伺服器 jar，並驗證 sha1。
4. 寫入只綁 `127.0.0.1` 的 `server.properties`（白名單只有辦公室的機器人）。

完成後把 `office.config.json` 的 `minecraft.enabled` 改成 `true`，再 `npm start`。第一次產生世界約需 1～2 分鐘。

- 這個 repo 不包含任何 Mojang 的檔案；伺服器 jar、EULA、世界存檔都在本機的 `minecraft/`，不進版控。
- 在 `npm start` 的終端機輸入文字會轉給 Minecraft 主控台（例如 `time set day`、`list`）。
- 關閉時會先讓機器人離線，再請伺服器存檔關閉。

## 常見問題

**玩 Minecraft 會耗 Token 嗎？**
不會。Minecraft 裡的員工是照規則跑的 Mineflayer 機器人（找樹、挖礦、蓋東西），不會呼叫任何 AI 模型。只有你的 Agent 真的在工作時才會用到 Token，而且那跟這個辦公室無關。

**辦公室會替我的 Agent 下指令嗎？**
不會。辦公室只讀狀態和終端畫面；唯一的寫入是在布告欄勾選待辦（寫進 `data/board.json`）。

**沒有 Agent 也能玩嗎？**
可以。預設的示範模式就是給你先看效果用的。

**為什麼我的員工都「不在線」？**
Herdr 模式下，`staff[].id` 要和 `herdr agent list` 裡的名稱完全一樣。

## 安全提醒

- 這個辦公室會**讀取你的 Agent 終端畫面**，裡面可能有程式碼、路徑或其他敏感內容。
- 伺服器只綁 `127.0.0.1`，並檢查 Host 標頭（防 DNS rebinding）。**不要改成對外開放，也不要用反向代理或通道把它公開到網路上。**
- 唯一的寫入 API（勾選待辦）要求同源、JSON 與自訂標頭。
- 書架只讀你設定的資料夾，擋路徑穿越與跳出去的符號連結；疑似含金鑰的檔案不會列出。即使如此，也不要把密碼或 token 放在專案資料夾裡。
- Minecraft 伺服器只綁 `127.0.0.1`，並開啟白名單。

## 開發

```bash
npm run check   # 所有 JS 語法檢查＋ JSON 格式檢查
npm run smoke   # 示範模式冒煙測試（啟動伺服器、打 API、關閉）
```

網址參數（開發用）：`?fast`（動作加速）、`?idle=coffee`（閒置員工都做某個動作，名稱見 `public/behavior.js`）、`?cat=nap`（貓的行程）。

```
server.js              本機伺服器（只綁 127.0.0.1）
lib/config.js          讀設定檔
lib/sources.js         狀態來源 adapter（demo、herdr）
lib/board-store.js     布告欄資料
lib/projects-store.js  書架專案資料庫（只讀）
public/                前端（Three.js）
mc/                    Minecraft 機器人與畫面串流
scripts/               minecraft:setup、語法檢查、冒煙測試
data/                  範例資料（全部虛構）
```

## 第三方套件與授權

本專案以 [MIT License](LICENSE) 授權，著作權人 Jeffery Sha。

| 套件 | 授權 | 用途 |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D 辦公室 |
| [mineflayer](https://github.com/PrismarineJS/mineflayer) | MIT | Minecraft 機器人 |
| [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | MIT | 機器人尋路 |
| [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | MIT | 機器人第一人稱畫面 |
| [socket.io](https://github.com/socketio/socket.io)（透過 prismarine-viewer） | MIT | 畫面串流 |

其他間接相依套件以 MIT、BSD、ISC、Apache-2.0 為主，完整清單見 `package-lock.json`，各套件授權見 `node_modules/<套件>/LICENSE`。prismarine-viewer 套件內附的方塊材質屬於 Mojang，受 Minecraft 使用條款約束；本 repo 本身不包含任何 Mojang 檔案。

本專案與 Mojang、Microsoft 無關，也未獲其認可。Minecraft 是 Mojang Synergies AB 的商標。

---

## English

Agent Office 3D renders your AI coding agents as staff in a small low-poly 3D office running on your own machine.

### Features

- **Live status** for each agent: working / idle / done / needs confirmation (red name tag and a "!" bubble).
- **Read-only terminal view**: click a staff member to see their recent terminal output. You cannot send commands from the office.
- **Idle animations**: coffee, water, treadmill, stretching, napping, built-in mini games, or **Minecraft** (each agent gets a Mineflayer bot whose first-person view shows up on their monitor).
- **Bulletin board**: yearly goal, KPIs, weekly focus, cash flow and a to-do list you can tick off.
- **Bookshelf project library**: each book is a project folder; click it to read its Markdown files and screenshots (read-only).
- **Task list** sidebar and an office cat.

### Requirements

- **Node.js 20+** (required)
- **Java 21+ and the Minecraft Java Edition server** (optional, only for Minecraft breaks)
- A WebGL-capable browser

macOS and Linux are supported. **Windows support is experimental**: CI runs install, syntax checks and a demo-mode smoke test on Windows, but it has not been tested on real Windows hardware, and Minecraft on Windows is untested.

### Quick start

```bash
git clone https://github.com/jefferysha0627/agent-office-3d.git agent-office-3d
cd agent-office-3d
npm ci
npm start
```

The office opens at http://127.0.0.1:4870/ in **demo mode**: fake statuses rotate so you can see it working without any agent. Press `Ctrl+C` to stop.

### Configuration

Copy `office.config.example.json` to `office.config.json` and edit it (it is git-ignored). Key fields: `company` (name, currency, logo), `owner` (the person at the front desk), `staff[]` (`id` must match the agent name in your status source, plus `title` and uniform `color`, up to 8), `source.type` (`demo` or `herdr`), `data.*` (board, bookshelf and task folders) and `minecraft.*`. See the Chinese table above for every field and [docs/board-format.md](docs/board-format.md) for the board and bookshelf data format.

**Herdr mode**: set `source.type` to `"herdr"` and use your [Herdr](https://github.com/herdrdev/herdr) agent names as `staff[].id`. The office only runs the read-only commands `herdr agent list` and `herdr agent read`, enforced by an allowlist. To support another tool, add an adapter in `lib/sources.js`.

### Minecraft (optional)

![A staff member's Minecraft first-person view with crosshair, real hotbar and held block](docs/screenshots/minecraft.png)

```bash
npm run minecraft:setup
```

1. Checks for Java 21+ and prints install instructions for macOS, Windows and Linux if missing.
2. Shows the [Minecraft EULA](https://aka.ms/MinecraftEULA). **You must read it and type `yes` yourself**; anything else cancels without downloading anything.
3. Downloads the 1.21.4 server jar from Mojang's official version manifest and verifies its SHA-1.
4. Writes a `server.properties` bound to `127.0.0.1` with a whitelist.

Then set `minecraft.enabled` to `true` and run `npm start`. No Mojang files are included in this repo.

### FAQ

**Does Minecraft burn tokens?** No. The in-game staff are rule-based Mineflayer bots (chop trees, mine, build). They never call an AI model.

**Can the office control my agents?** No. It only reads status and terminal output. The only write is ticking a to-do on the board.

### Security

- The office **reads your agents' terminal output**, which may contain code, paths or other sensitive data.
- The server binds to `127.0.0.1` only and checks the Host header. **Do not expose it to the network**, and do not put it behind a public proxy or tunnel.
- The only write endpoint (ticking a to-do) requires same-origin, JSON and a custom header.
- The bookshelf only reads the folder you configure, blocks path traversal and escaping symlinks, and hides files that look like they contain secrets.

### Credits and license

Built with [Claude Code](https://claude.com/claude-code). Made by SparCode studio.

[MIT License](LICENSE), copyright Jeffery Sha. Third-party packages: three, mineflayer, mineflayer-pathfinder, prismarine-viewer and socket.io (all MIT); see the table above. Not affiliated with or endorsed by Mojang or Microsoft. Minecraft is a trademark of Mojang Synergies AB.
