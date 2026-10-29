// Java 版本檢查（minecraft:setup 與 demo:minecraft 共用）
import { spawnSync } from 'node:child_process';

export function javaMajor(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return null;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return null;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

export function javaHelp() {
  console.log(`
需要 Java 21 以上。安裝方式：
  macOS（Homebrew）： brew install openjdk@21
                     然後把 office.config.json 的 minecraft.java 設成 /opt/homebrew/opt/openjdk@21/bin/java
                     （Intel Mac 是 /usr/local/opt/openjdk@21/bin/java），或設定環境變數 MC_JAVA
  Windows：          winget install Microsoft.OpenJDK.21
                     裝好後重新開一個終端機視窗，java -version 應該顯示 21
  Linux（Debian／Ubuntu）： sudo apt install openjdk-21-jre-headless
也可以從 https://adoptium.net/ 下載 Temurin 21。
如果 java 不在 PATH 上，請在 office.config.json 設定 minecraft.java（或環境變數 MC_JAVA）為 java 執行檔的完整路徑。`);
}
