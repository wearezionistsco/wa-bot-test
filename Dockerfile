# Gunakan Node.js versi 18 slim
FROM node:18-slim

# Install dependency untuk chromium & font
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Tentukan path chromium untuk puppeteer/whatsapp-web.js
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set workdir
WORKDIR /app

# Copy package.json dulu untuk cache
COPY package.json package-lock.json ./

# Install deps
RUN npm install --omit=dev

# Copy semua file project
COPY . .

# Expose port Railway (default 3000)
EXPOSE 3000

# Start bot
CMD ["node", "index.js"]
