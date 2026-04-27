# vidgrab

Download videos from YouTube (and other platforms) from a VPS without getting blocked.

Uses [Cloudflare WARP](https://developers.cloudflare.com/warp-client/) for residential IPs and a [PO token provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) to bypass YouTube's bot detection. No API keys needed. No browser login required.

## Quick Start

```bash
git clone https://github.com/user/vidgrab.git
cd vidgrab

# Start the proxy infrastructure (WARP + PO token provider)
docker compose up -d warp-proxy pot-provider

# Wait ~10s for WARP to connect, then download a video
docker compose run --rm vidgrab "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Downloaded files appear in `./downloads/`.

## How It Works

YouTube blocks downloads from VPS/datacenter IPs. vidgrab works around this with three key pieces:

1. **Cloudflare WARP** — routes all traffic through Cloudflare's network, giving your VPS a residential IP instead of a flagged datacenter IP.

2. **PO Token Provider** — generates Proof of Origin tokens that prove the request came from a legitimate browser session, without requiring you to log in.

3. **Player Client Rotation** — if one YouTube client type gets blocked, vidgrab automatically rotates through others (`web_safari`, `tv_simply`, `ios`, `mweb`, etc.) with exponential backoff retry.

It also uses Deno + Node.js as JS runtimes to solve YouTube's n-parameter challenge (the JavaScript computation that decrypts video URLs).

## Usage

### Docker (recommended)

```bash
# Download to ./downloads/
docker compose run --rm vidgrab "https://youtube.com/watch?v=..."

# Download to a specific directory
docker compose run --rm vidgrab "https://youtube.com/watch?v=..." /path/to/output
```

### One-liner (no clone needed)

```bash
docker compose -f <(curl -sL https://raw.githubusercontent.com/user/vidgrab/main/docker-compose.yml) run --rm vidgrab "URL"
```

## Optional Configuration

### Cookies file (for higher quality / age-restricted content)

Export a `cookies.txt` from your browser using an extension like [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc), then:

```bash
# Mount the cookies file and set the env var
docker compose run --rm \
  -v /path/to/cookies.txt:/app/cookies.txt:ro \
  -e YT_DLP_COOKIES_FILE=/app/cookies.txt \
  vidgrab "https://youtube.com/watch?v=..."
```

### Custom proxy

```bash
docker compose run --rm -e YT_DLP_SSRF_PROXY="socks5h://my-proxy:1080" vidgrab "URL"
```

## Architecture

```
vidgrab container
  │
  ├── yt-dlp (with POT plugin + Deno JS runtime)
  │     │
  │     └── All traffic via SOCKS5 →
  │
  ├── warp-proxy (Cloudflare WARP sidecar)
  │     └── Provides residential IP egress
  │
  └── pot-provider (bgutil POT sidecar)
        └── Generates Proof of Origin tokens
```

All three services share a Docker network (`vidgrab-net`). The vidgrab container has no direct internet access for downloads — everything routes through the WARP proxy.

## Requirements

- Docker + Docker Compose
- ~1GB RAM (WARP + POT provider are lightweight)
- Works on any VPS (Ubuntu, Debian, etc.)

## License

MIT
