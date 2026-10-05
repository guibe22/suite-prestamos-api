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
# sincronice el esquema antes de levantar el servidor.
#
# Se usa `db push` y no `migrate deploy` porque esta base se creó con db push y
# nunca registró historial de migraciones (`migrate deploy` falla ahí con P3005).
#
# En Prisma 7 `db push` solo acepta --accept-data-loss y --force-reset; no
# existe --skip-generate (eso era Prisma 5/6) y pasarlo hace fallar el arranque.
#
# DELIBERADAMENTE sin `--accept-data-loss`: si el diff exigiera eliminar alguna
# columna o tabla, db push se niega y el contenedor no arranca, en vez de
# destruir datos en silencio. Si alguna vez falla por eso, hay que mirar QUÉ
# quiere borrar antes de desbloquearlo a mano.
CMD ["npm", "run", "start"]
