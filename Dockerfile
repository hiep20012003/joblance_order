# =========================================
# Stage 1: Builder
# =========================================
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./

RUN --mount=type=secret,id=NPM_TOKEN \
    NPM_TOKEN=$(cat /run/secrets/NPM_TOKEN) npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =========================================
# Stage 2: Runtime
# =========================================
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/build ./src
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./

RUN npm install -g pm2

EXPOSE 4006

ENTRYPOINT ["pm2-runtime", "start", "./src/app.js"]
