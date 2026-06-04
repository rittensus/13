# Stage 1: Build environment
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency configuration files
COPY package*.json tsconfig*.json vite.config.ts index.html ./

# Install all dependencies (including compiler devDependencies)
RUN npm ci

# Copy source files
COPY src/ ./src/
COPY server/ ./server/

# Compile client assets and backend server JS
RUN npm run build

# Stage 2: Production execution environment
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests
COPY package*.json ./

# Install runtime production dependencies only (omits TypeScript, Vite, etc.)
RUN npm ci --omit=dev

# Copy compiled frontend client and backend server from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Expose server port
EXPOSE 3000

# Start production server
CMD ["node", "dist-server/server/index.js"]
