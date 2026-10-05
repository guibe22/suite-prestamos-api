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
# `schema.prisma` NO declara la url del datasource: la toma de prisma.config.ts.
# Sin este archivo, el `migrate deploy` del arranque no sabría a qué base conectarse.
COPY --from=builder /app/prisma.config.ts ./
EXPOSE 3020
# Vía `npm run start` (y no `node dist/server.js` directo) para que el arranque
# aplique las migraciones pendientes antes de levantar el servidor. Si una
# migración falla, el contenedor NO arranca: es preferible a servir contra un
# esquema que no corresponde.
CMD ["npm", "run", "start"]
