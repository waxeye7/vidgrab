import { spawn, type ChildProcess } from "node:child_process";
import { stat, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_JS_RUNTIMES = "deno,node";
const DEFAULT_PROXY = "socks5h://warp-proxy:1080";
const DEFAULT_POT_PROVIDER_URL = "http://pot-provider:4416";

const FORMAT_NO_AUTH =
  "best[ext=mp4][height<=1440][fps<=60]/bestvideo*[height<=1440][fps<=60]+bestaudio/best[height<=1440][fps<=60]/best";
const FORMAT_WITH_AUTH =
  "bestvideo*[height<=1440][fps<=60]+bestaudio/best[ext=mp4][height<=1440][fps<=60]/best[height<=1440][fps<=60]/best";
const FORMAT_CONSERVATIVE =
  "best[ext=mp4][height<=720][fps<=30]/best[height<=720][fps<=30]/best";

const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 900_000];
const MAX_ATTEMPTS = 5;
const MAX_MODES_PER_ATTEMPT = 4;

const PLAYER_CLIENTS_NO_COOKIES = [
  "default",
  "web_safari",
  "tv_simply",
  "ios",
  "mweb",
] as const;

const PLAYER_CLIENTS_WITH_COOKIES = ["web", "tv"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function resolveProxy(): string {
  return getEnv("YT_DLP_SSRF_PROXY", DEFAULT_PROXY);
}

function resolvePotProviderUrl(): string | null {
  const url = process.env.YT_DLP_POT_PROVIDER_URL?.trim();
  return url || null;
}

function resolveCookiesFile(): string | null {
  return process.env["YT_DLP_COOKIES_FILE"]?.trim() || null;
}

interface DownloadCandidate {
  label: string;
  playerClient: string;
  forceNoCookies: boolean;
  formatFilter: string;
  proxy: string;
}

function buildCandidatePool(proxy: string, cookiesFile: string | null): DownloadCandidate[] {
  const hasCookies = Boolean(cookiesFile);
  const clients = hasCookies
    ? [
        ...PLAYER_CLIENTS_WITH_COOKIES.map((pc) => ({
          playerClient: pc,
          forceNoCookies: false,
          formatFilter: FORMAT_WITH_AUTH,
        })),
        ...PLAYER_CLIENTS_NO_COOKIES.map((pc) => ({
          playerClient: pc,
          forceNoCookies: true,
          formatFilter: FORMAT_NO_AUTH,
        })),
        {
          playerClient: "default",
          forceNoCookies: true,
          formatFilter: FORMAT_CONSERVATIVE,
        },
      ]
    : [
        ...PLAYER_CLIENTS_NO_COOKIES.map((pc) => ({
          playerClient: pc,
          forceNoCookies: true,
          formatFilter: FORMAT_NO_AUTH,
        })),
        {
          playerClient: "default",
          forceNoCookies: true,
          formatFilter: FORMAT_CONSERVATIVE,
        },
      ];

  return clients.map((c) => ({
    ...c,
    proxy,
    label: `${c.forceNoCookies ? "no-cookies" : "cookies"}:${c.playerClient}`,
  }));
}

function selectCandidates(
  pool: DownloadCandidate[],
  attemptIndex: number,
): DownloadCandidate[] {
  const count = Math.min(MAX_MODES_PER_ATTEMPT, pool.length);
  const rotation = (attemptIndex * count) % pool.length;
  return pool.slice(rotation).concat(pool.slice(0, rotation)).slice(0, count);
}

function buildYtdlpArgs(
  url: string,
  outputTemplate: string,
  candidate: DownloadCandidate,
): string[] {
  const cookiesFile = resolveCookiesFile();
  const potUrl = resolvePotProviderUrl();

  const args: string[] = [
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "--merge-output-format", "mp4",
    "-f", candidate.formatFilter,
    "-o", outputTemplate,
  ];

  for (const runtime of DEFAULT_JS_RUNTIMES.split(",")) {
    args.push("--js-runtimes", runtime.trim());
  }

  if (cookiesFile && !candidate.forceNoCookies) {
    args.push("--cookies", cookiesFile);
  }

  args.push("--force-ipv4");
  args.push("--retries", "10");
  args.push("--fragment-retries", "5");
  args.push("--extractor-retries", "5");
  args.push("--sleep-requests", "2");
  args.push("--user-agent", DEFAULT_USER_AGENT);
  args.push("--http-chunk-size", "10M");
  args.push("--concurrent-fragments", "1");
  args.push("--geo-bypass");
  args.push("--proxy", candidate.proxy);
  args.push("--socket-timeout", "300");
  args.push("--extractor-args", `youtube:player_client=${candidate.playerClient}`);

  if (potUrl) {
    args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${potUrl}`);
  }

  args.push(
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    "--add-header", "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "--add-header", "Sec-Fetch-Mode:navigate",
    "--add-header", "Sec-Fetch-Site:none",
    url,
  );

  return args;
}

function isBotBlock(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("sign in to confirm") ||
    lower.includes("not a bot") ||
    lower.includes("captcha") ||
    lower.includes("http error 403") ||
    (lower.includes("403") && lower.includes("forbidden"))
  );
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function spawnYtdlp(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn("yt-dlp", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        killed = true;
        try { child.kill("SIGKILL"); } catch {}
      }
    }, timeoutMs);
    timer.unref();

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function findDownloadedFile(destinationPath: string): Promise<string | null> {
  const candidates = [
    destinationPath.replace(/\.mp4$/i, ".temp.mp4"),
    destinationPath,
    destinationPath.replace(/\.mp4$/i, ".mkv"),
    destinationPath.replace(/\.mp4$/i, ".webm"),
    destinationPath.replace(/\.mp4$/i, ".mov"),
  ];

  for (const p of candidates) {
    try {
      const s = await stat(p);
      if (s.size > 0) return p;
    } catch {}
  }
  return null;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  filename?: string;
}

export async function downloadVideo(opts: DownloadOptions): Promise<string> {
  const proxy = resolveProxy();
  const cookiesFile = resolveCookiesFile();
  const candidatePool = buildCandidatePool(proxy, cookiesFile);

  const filename = opts.filename || "%(title).200s.%(ext)s";
  const destinationPath = resolve(opts.outputDir, filename.endsWith(".mp4") ? filename : `${filename}.mp4`);
  const outputTemplate = destinationPath.replace(/\.mp4$/i, ".%(ext)s");

  console.log(`[vidgrab] Starting download: ${opts.url}`);
  console.log(`[vidgrab] Proxy: ${proxy}`);
  console.log(`[vidgrab] POT provider: ${resolvePotProviderUrl() || "not configured"}`);
  console.log(`[vidgrab] Cookies: ${cookiesFile || "not configured"}`);
  console.log(`[vidgrab] Candidate pool: ${candidatePool.length} modes`);
  console.log();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = selectCandidates(candidatePool, attempt);
    const attemptTimeoutMs = 30 * 60 * 1000;

    for (const candidate of candidates) {
      console.log(`[vidgrab] Attempt ${attempt + 1}/${MAX_ATTEMPTS} — ${candidate.label} (proxy: ${candidate.proxy})`);

      try {
        const args = buildYtdlpArgs(opts.url, outputTemplate, candidate);
        const perCandidateTimeout = Math.max(5 * 60 * 1000, Math.min(attemptTimeoutMs / candidates.length, 30 * 60 * 1000));

        const result = await spawnYtdlp(args, perCandidateTimeout);

        if (result.exitCode !== 0) {
          throw new Error(`yt-dlp exited with code ${result.exitCode}: ${result.stderr.slice(-500)}`);
        }

        const downloadedPath = await findDownloadedFile(destinationPath);
        if (!downloadedPath) {
          throw new Error("yt-dlp completed but no output file found");
        }

        const fileInfo = await stat(downloadedPath);
        if (downloadedPath !== destinationPath) {
          await rm(destinationPath, { force: true }).catch(() => undefined);
          await rename(downloadedPath, destinationPath);
        }

        const sizeMB = (fileInfo.size / 1024 / 1024).toFixed(1);
        console.log();
        console.log(`[vidgrab] Download complete: ${destinationPath} (${sizeMB} MB)`);
        return destinationPath;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[vidgrab] Failed: ${lastError.message}`);

        if (isBotBlock(lastError.message)) {
          console.error(`[vidgrab] Bot detection triggered — rotating to next candidate`);
        }
      }
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1)!;
      console.log(`[vidgrab] Waiting ${delay / 1000}s before next attempt...`);
      await sleep(delay);
    }
  }

  throw new Error(
    `All ${MAX_ATTEMPTS} attempts failed. Last error: ${lastError?.message || "unknown"}`,
  );
}
