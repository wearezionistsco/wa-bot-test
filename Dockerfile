# Gunakan Node.js resmi
FROM node:18-slim

# Install chromium & fonts
RUN apt-get update && apt-get install -y \
  chromium \
  chromium-sandbox \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  fonts-thai-tlwg \
  fonts-kacst \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set env agar whatsapp-web.js bisa temukan chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Buat direktori kerja
WORKDIR /app

# Copy package.json & install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy semua file project
COPY . .

# Expose port untuk Express server (QR code)
EXPOSE 3000

# Jalankan bot
CMD ["node", "index.js"]
