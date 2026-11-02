# MIT-licensed tinytldr container image (Playwright Chromium + FFmpeg + OFL fonts)
# Note on FFmpeg licensing: FFmpeg is installed as an OS-level system binary via apt
# and invoked as a separate child process (`child_process.spawn("ffmpeg", ...)`).
# No GPL/LGPL libraries are linked into or distributed inside the MIT npm packages.
FROM mcr.microsoft.com/playwright:v1.52.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.6.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY mcp ./mcp
COPY website ./website
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile \
  && pnpm build

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "packages/cli/dist/index.js", "serve", "--host", "0.0.0.0", "--port", "8787"]
