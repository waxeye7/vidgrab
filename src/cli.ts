#!/usr/bin/env node

import { resolve } from "node:path";
import { downloadVideo } from "./downloader.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`vidgrab — download videos from YouTube (and other platforms) without getting blocked.

Usage:
  vidgrab <url> [output-dir]

Options:
  --help, -h     Show this help

Environment:
  YT_DLP_SSRF_PROXY       SOCKS5 proxy URL (default: socks5h://warp-proxy:1080)
  YT_DLP_POT_PROVIDER_URL  PO token provider URL (default: http://pot-provider:4416)
  YT_DLP_COOKIES_FILE      Path to Netscape cookies.txt (optional)

Examples:
  vidgrab "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  vidgrab "https://www.youtube.com/watch?v=dQw4w9WgXcQ" /downloads
`);
  process.exit(0);
}

const url = args[0]!;
const outputDir = args[1] ? resolve(args[1]) : resolve(process.cwd(), "downloads");

downloadVideo({ url, outputDir })
  .then((path) => {
    console.log(`\nDone: ${path}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  });
