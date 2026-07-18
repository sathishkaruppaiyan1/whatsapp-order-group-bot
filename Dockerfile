# WooCommerce Order Automation Bot — Railway production image
FROM node:20-bullseye-slim

# System dependencies:
#  - chromium + libs: required by whatsapp-web.js (puppeteer)
#  - build tools + cairo/pango: required by node-canvas
#  - fonts: required so canvas can render badge text
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    build-essential python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Use the system chromium instead of downloading one at npm install time.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first for better build caching.
COPY package*.json ./
RUN npm ci --include=dev

# Build TypeScript.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime directories (also created at boot, but nice to have in the image).
RUN mkdir -p logs downloads generated

EXPOSE 3000
CMD ["node", "dist/server.js"]
