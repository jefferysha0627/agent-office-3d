# AGENTS.md: setting up Agent Office 3D for a user

This file is for AI coding agents (Claude Code, Codex, Cursor and others) that were asked to install Agent Office 3D for a user. Follow it in order. A Traditional Chinese summary is at the end.

## Hard rules (read before doing anything)

- **The Minecraft EULA is accepted by the user, never by you.** Only the user may accept it, by typing `yes` themselves when `npm run minecraft:setup` asks, in their own terminal. Do not pipe or echo `yes`, do not send input to that prompt, do not create or edit `minecraft/eula.txt`, and do not accept it in any other way. When the EULA step is needed, stop, explain why, and ask the user to run the command themselves.
- **Local only.** The office (port 4870) and the Minecraft server (port 25570) bind to `127.0.0.1`. Do not change the bind address, open firewall ports, set up port forwarding, tunnels (ngrok, cloudflared, Tailscale Funnel and similar), reverse proxies or any deployment. If the user asks for remote access, explain the risk below and do not set it up.
- **Terminal output stays on this machine.** The office reads the user's agent terminals. Do not read that output (for example from `/api/state` or the agent panel) to send it anywhere, and never upload terminal output, board data or project files to any external service.
- **Ask before installing system software.** Node.js, Java, Homebrew, winget and apt packages need the user's consent. Show the exact command, explain what it installs, and wait for a yes. Running `npm ci` inside this repo is fine.
- **Guests do not open the server.** You may add the user's player names to `minecraft.guests` so they can watch from inside the game, but never change the bind address, `online-mode`, or open any network access because of it. Guests must play on the same computer.
- **Herdr stays read-only.** If you connect Herdr, the office only runs `herdr agent list`, `get` and `read`. Do not run `herdr agent prompt`, `send-keys` or any other command that types into the user's agents.

Why: the EULA is a legal agreement between the user and Mojang. The office shows terminal content that may include code, paths or secrets, so it must not be reachable from the network.

## Setup flow

### 1. Check the environment

```bash
npm run doctor          # human-readable
npm run doctor -- --json  # machine-readable
```

Exit codes:

| Code | Meaning | Next step |
|---|---|---|
| `0` | Office and Minecraft demo are ready | Go to step 4 |
| `2` | Office is ready, Minecraft is not (Java missing/old, or `minecraft:setup` not done) | Steps 3–4, or skip Minecraft and run `npm start` |
| `1` | Office is not ready (Node too old, packages missing, config invalid, port in use) | Fix the ✗ items, then step 2 |

Every ✗ line comes with a suggested fix. Run `npm run doctor` again after each fix.

### 2. Node.js and packages

- Needs **Node.js 20 or newer**. If it is missing, tell the user and propose (ask first): macOS `brew install node`, Windows `winget install OpenJS.NodeJS.LTS`, or the installer from https://nodejs.org/.
- Then install the packages:

```bash
npm ci
```

### 3. Java 21 and Minecraft (optional, for the Minecraft demo)

- Needs **Java 21 or newer**. If it is missing or older, tell the user and propose (ask first):
  - macOS: `brew install openjdk@21`, then set `"minecraft": { "java": "/opt/homebrew/opt/openjdk@21/bin/java" }` in `office.config.json` (Intel Macs: `/usr/local/opt/openjdk@21/bin/java`), or set the `MC_JAVA` environment variable.
  - Windows: `winget install Microsoft.OpenJDK.21`, then open a new terminal.
  - Linux (Debian/Ubuntu): `sudo apt install openjdk-21-jre-headless`.
- If `npm run doctor` shows the server jar, EULA or `server.properties` as ✗: **stop and ask the user** to run this in their own terminal and type `yes` themselves after reading the EULA:

```bash
npm run minecraft:setup
```

  It checks Java, shows the EULA link (https://aka.ms/MinecraftEULA), downloads the official 1.21.4 server from Mojang with a SHA-1 check, and writes a `server.properties` bound to `127.0.0.1`. If the user declines, nothing is downloaded; continue with `npm start` instead.

### 4. Start the Minecraft demo

```bash
npm run demo:minecraft
```

- Demo staff plus Minecraft, no config change needed. The first run generates a world (1–2 minutes). The browser opens at http://127.0.0.1:4870/ once the bots are in the world, and within seconds idle staff start playing on their monitors.
- It is a long-running server. Run it in the background or ask the user to run it in a terminal, and stop it with `Ctrl+C` (the world is saved first).
- Exit code `3` means the EULA is not accepted and there was no interactive terminal to ask. Go back to step 3 and ask the user.
- Office only (no Java needed): `npm start`.

### 5. Ask whether to connect Herdr

Ask the user if they use [Herdr](https://github.com/herdrdev/herdr) to run their agents. If yes:

1. Check that Herdr works with a read-only command: `herdr agent list`. If `herdr` is not on PATH, ask the user for the path to the executable.
2. Copy the example config if there is no `office.config.json` yet:
   - macOS/Linux: `cp office.config.example.json office.config.json`
   - Windows PowerShell: `Copy-Item office.config.example.json office.config.json`
3. In `office.config.json`, set `"source": { "type": "herdr", "herdr": { "bin": "herdr" } }` (use the full path if needed).
4. Set `staff[].id` to the agent names from `herdr agent list`. Show the user the list and confirm which agents should get a front-row desk (up to 8; agents not in the list get the remaining seats).
5. Restart the office (`Ctrl+C`, then `npm start`) and run `npm run doctor`.

If they do not use Herdr, keep `"type": "demo"`. Other tools need an adapter in `lib/sources.js`.

### 6. Help the user customize

Edit `office.config.json` (create it from the example first). The server reads it at start, so restart after changes.

| What | Field |
|---|---|
| Company name | `company.name` |
| Currency on the board | `company.currency` (for example `$`, `€`, `¥`) |
| Wall sign logo (wide image) | `company.logo`: copy the user's file into `public/brand/` and point to it; SVG, PNG, JPG or WebP |
| Small icon (header, favicon, uniform badge) | `company.mark`: square image works best |
| The person at the front desk | `owner.name`, `owner.title` |
| Staff | `staff[]`: `id` (agent name), `title`, `color` (`#rrggbb`), up to 8 |
| Cat | `cat.name` |
| Port | `port` (default 4870) |
| Watch from inside Minecraft | `minecraft.guests`: the user's Minecraft player names (or `MC_GUESTS=name1,name2`); they join `localhost:25570` with Java Edition 1.21.4 on the same computer and become spectators |

Board, bookshelf and task data live in `data/`; the format is in [docs/board-format.md](docs/board-format.md). The board reloads within a few seconds after `data/board.json` changes, no restart needed. Do not put passwords or tokens in these files.

### 7. Finish

- Run `npm run doctor` and confirm exit code `0` (or `2` if the user skipped Minecraft).
- Tell the user the URL (http://127.0.0.1:4870/), how to stop it (`Ctrl+C`), and which commands to use next time (`npm run demo:minecraft` or `npm start`).

## Reference

| Command | What it does |
|---|---|
| `npm run doctor` | Read-only checks: Node, packages, config, ports 4870 and 25570, Java, Minecraft files, EULA status |
| `npm start` | Start the office with `office.config.json` (falls back to the example config) |
| `npm run demo:minecraft` | Demo staff + Minecraft, opens the browser when the bots are ready |
| `npm run minecraft:setup` | **User runs this.** Java check, EULA (user types `yes`), official download, local-only `server.properties` |
| `npm run check` / `npm run smoke` | Syntax check / demo-mode smoke test |

- Windows support is experimental.
- `office.config.json`, `data/board.json` and `minecraft/` are git-ignored. Never commit them.

---

## 繁體中文摘要

給 AI Agent 的安裝流程。照順序做，最前面的界線一定要遵守。

**硬性界線**
- Minecraft EULA 只能由使用者本人在自己的終端機執行 `npm run minecraft:setup`，讀完後自己輸入 `yes`。Agent 不得用管線、echo、修改 `minecraft/eula.txt` 或任何方式代為同意；需要時停下來請使用者自己操作。
- 服務只綁本機（4870、25570）。不得改綁定位址、開防火牆、做 port forwarding、通道或反向代理，也不得部署到網路上。
- 辦公室會讀使用者的 Agent 終端畫面。Agent 不讀取這些內容拿去他用，也不上傳終端內容、布告欄資料或專案檔到任何外部服務。
- 安裝 Node.js、Java 等系統軟體前，先列出指令並取得使用者同意（repo 內的 `npm ci` 可以直接跑）。
- 可以幫使用者設定 `minecraft.guests`（讓他從遊戲裡看員工），但不得因此改綁定位址、改 online-mode 或開放對外連線；真人玩家只能在同一台電腦上連。
- 接 Herdr 時只用唯讀指令（`agent list／get／read`），不送鍵、不下指令。

**流程**
1. `npm run doctor`：結束碼 0＝全部就緒、2＝辦公室可用但 Minecraft 還沒好、1＝辦公室還不能跑。每個 ✗ 都附修正建議。
2. 缺 Node.js 20：告訴使用者怎麼裝並徵求同意；接著 `npm ci`。
3. 缺 Java 21：告訴使用者怎麼裝並徵求同意。Minecraft 還沒設定時，請使用者自己執行 `npm run minecraft:setup` 並輸入 `yes`。
4. `npm run demo:minecraft`：示範員工＋Minecraft，機器人進世界後自動開瀏覽器；`Ctrl+C` 停止並存檔。結束碼 3 表示 EULA 還沒同意。只想看辦公室：`npm start`。
5. 詢問要不要接 Herdr：要的話先用 `herdr agent list` 確認，再把 `office.config.json` 的 `source.type` 改成 `herdr`、`staff[].id` 改成 Agent 名稱（跟使用者確認），重新啟動。
6. 協助客製公司名稱、貨幣、Logo（放到 `public/brand/`）、負責人、員工、貓的名字；改設定後重新啟動。
7. 最後再跑一次 `npm run doctor`，告訴使用者網址、怎麼停止、下次用哪個指令。
