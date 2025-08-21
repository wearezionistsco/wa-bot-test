#!/bin/bash
chmod +x deploy.sh
echo "🚀 Deploying to Railway..."
git add .
git commit -m "Deploy bot"
git push railway main
