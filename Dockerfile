# Step 1: Build frontend client assets
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json ./frontend/
RUN npm install && npm install --prefix frontend
COPY . .
RUN npm run build

# Step 2: Set up production server
FROM node:26-alpine
WORKDIR /app

# Install Python 3 (required for running the scraper script in background/manually)
RUN apk add --no-cache python3

# Install production server dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy built frontend assets
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy backend files and scraping scripts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/SPORTS.m3u ./SPORTS.m3u

# Set environment
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000
CMD ["node", "server.js"]
