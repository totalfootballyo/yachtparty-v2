# Multi-stage build for Message Orchestrator service
# Build context should be project root

# Stage 1: Build
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace package files
COPY package.json package-lock.json ./
COPY packages/agents/account-manager/package.json ./packages/agents/account-manager/
COPY packages/agents/bouncer/package.json ./packages/agents/bouncer/
COPY packages/agents/concierge/package.json ./packages/agents/concierge/
COPY packages/database/package.json ./packages/database/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/services/realtime-processor/package.json ./packages/services/realtime-processor/
COPY packages/services/sms-sender/package.json ./packages/services/sms-sender/
COPY packages/services/twilio-webhook/package.json ./packages/services/twilio-webhook/
COPY packages/services/message-orchestrator/package.json ./packages/services/message-orchestrator/
COPY packages/shared/package.json ./packages/shared/
COPY packages/testing/package.json ./packages/testing/

# Install all workspace dependencies
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/orchestrator ./packages/orchestrator
COPY packages/services/message-orchestrator ./packages/services/message-orchestrator

# Build shared package first
WORKDIR /app/packages/shared
RUN npm run build

# Build orchestrator package
WORKDIR /app/packages/orchestrator
RUN npm run build

# Build message-orchestrator service
WORKDIR /app/packages/services/message-orchestrator
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Set Node environment to production
ENV NODE_ENV=production

# Copy workspace configuration and dependencies from builder
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/orchestrator/package.json ./packages/orchestrator/
COPY --from=builder /app/packages/orchestrator/dist ./packages/orchestrator/dist
COPY --from=builder /app/packages/services/message-orchestrator/package.json ./packages/services/message-orchestrator/
COPY --from=builder /app/packages/services/message-orchestrator/dist ./packages/services/message-orchestrator/dist
COPY --from=builder /app/packages/services/message-orchestrator/node_modules ./packages/services/message-orchestrator/node_modules

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port 8080
EXPOSE 8080

# Set environment variables
ENV PORT=8080

# Set working directory to service
WORKDIR /app/packages/services/message-orchestrator

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the service
CMD ["node", "dist/index.js"]
