# vidgrab

Download YouTube videos from a VPS without getting blocked.

```
git clone https://github.com/waxeye7/vidgrab.git
cd vidgrab
docker compose up -d warp-proxy pot-provider
sleep 10
docker compose run --rm vidgrab "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

That's it. Video lands in `./downloads/`.

## Why does this exist?

YouTube blocks downloads from VPS/datacenter IPs. If you've ever tried `yt-dlp` on a server and gotten 403 errors or "sign in to confirm" — that's why.

vidgrab fixes it by routing your downloads through **Cloudflare WARP** (residential IPs) and generating **PO tokens** (Proof of Origin), so YouTube thinks the request comes from a normal browser. No API keys, no login, no cookies needed.

## How to use

Download a video:

```bash
docker compose run --rm vidgrab "https://www.youtube.com/watch?v=..."
```

Download to a specific folder:

```bash
docker compose run --rm vidgrab "https://www.youtube.com/watch?v=..." /path/to/output
```

## How it works

Three Docker containers:

| Container | What it does |
|-----------|-------------|
| **vidgrab** | Runs yt-dlp with anti-bot flags, JS challenge solvers, and player client rotation |
| **warp-proxy** | Cloudflare WARP — gives your VPS a residential IP |
| **pot-provider** | Generates PO tokens to bypass YouTube bot detection |

All traffic goes through the WARP proxy. vidgrab can't reach the internet directly.

If one download method gets blocked, vidgrab automatically tries another (it cycles through 6 different player clients with retries).

## Optional: cookies (for age-restricted or higher quality)

```bash
docker compose run --rm \
  -v /path/to/cookies.txt:/app/cookies.txt:ro \
  -e YT_DLP_COOKIES_FILE=/app/cookies.txt \
  vidgrab "https://www.youtube.com/watch?v=..."
```

Export `cookies.txt` from your browser using [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc).

## Optional: custom proxy

```bash
docker compose run --rm -e YT_DLP_SSRF_PROXY="socks5h://my-proxy:1080" vidgrab "URL"
```

## Requirements

- Docker + Docker Compose
- ~1GB RAM
- Linux VPS (Ubuntu, Debian, etc.) or Docker Desktop

## License

MIT
