FROM node:22-bookworm-slim

ARG YT_DLP_VERSION=2026.3.17
ARG YT_DLP_SHA256=32992db94303a8a5d211a183f2174834fe7f8c29d83ed2e7a324eae97a8f26d8
ARG BGUTIL_POT_PROVIDER_VERSION=1.3.1
ARG BGUTIL_POT_PROVIDER_SHA256=b8ceec7f76143da172aaf5ebeec0c2d218e5680c063b931586bca48567069b38
ARG DENO_VERSION=2.1.4
ARG DENO_SHA256_AMD64=54a81939cccb2af114c4d0a68a554cf4a04b1f08728e70f663f83781de19d785
ARG DENO_SHA256_ARM64=93ad8efe6f60da8566652dfd39cf2a23cb0e35d8c6d6faac7392a917d2b50039

RUN apt-get update && \
  apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-venv unzip && \
  python3 -m venv /opt/yt-dlp-venv && \
  /opt/yt-dlp-venv/bin/pip install --upgrade pip && \
  printf '%s\n' "yt-dlp==${YT_DLP_VERSION} --hash=sha256:${YT_DLP_SHA256}" > /tmp/yt-dlp-requirements.txt && \
  /opt/yt-dlp-venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/yt-dlp-requirements.txt && \
  rm /tmp/yt-dlp-requirements.txt && \
  ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp && \
  rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/yt-dlp-venv/lib/python3.11/site-packages/yt_dlp_plugins/extractor && \
  curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_PROVIDER_VERSION}/bgutil-ytdlp-pot-provider.zip" -o /tmp/pot-plugin.zip && \
  echo "${BGUTIL_POT_PROVIDER_SHA256}  /tmp/pot-plugin.zip" | sha256sum -c - && \
  unzip -o -j /tmp/pot-plugin.zip "*/extractor/*.py" -d /opt/yt-dlp-venv/lib/python3.11/site-packages/yt_dlp_plugins/extractor/ && \
  rm /tmp/pot-plugin.zip

RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in \
      amd64) DENO_ARCH="x86_64-unknown-linux-gnu"; DENO_SHA256="${DENO_SHA256_AMD64}" ;; \
      arm64) DENO_ARCH="aarch64-unknown-linux-gnu"; DENO_SHA256="${DENO_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture for Deno: $ARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${DENO_ARCH}.zip" \
    && echo "${DENO_SHA256}  /tmp/deno.zip" | sha256sum -c - \
    && unzip -o /tmp/deno.zip -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && deno --version

ENV PATH=/opt/yt-dlp-venv/bin:$PATH

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN mkdir -p /downloads

ENTRYPOINT ["node", "dist/cli.js"]
