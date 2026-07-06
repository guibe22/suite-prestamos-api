# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
# El lockfile se genera con npm 11 en desarrollo; npm 10 (el que trae la imagen) lo rechaza en `npm ci`
RUN npm install -g npm@11
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3020
CMD ["node", "dist/server.js"]
