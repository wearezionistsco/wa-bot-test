FROM node:18-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  chromium-sandbox \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  fonts-thai-tlwg \
  fonts-kacst \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set Puppeteer Chromium path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Buat direktori app
WORKDIR /app

# Copy package.json & install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start bot
CMD ["npm", "start"]
