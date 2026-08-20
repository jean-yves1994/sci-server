# ---------------------------------------------------------------------------
# SCI backend — portable container image.
#
# Works on Railway, Render, Fly.io, or any VPS running Docker. Building the
# image yourself rather than relying on a platform's auto-detection means the
# runtime is identical everywhere, including on your machine.
#
# Multi-stage: the build stage carries the TypeScript compiler and dev
# dependencies; the runtime stage carries neither, which keeps the image small
# and removes build tooling from the deployed surface.
# ---------------------------------------------------------------------------

# --- build ------------------------------------------------------------------
FROM node:20-alpine AS builder

# Prisma's query engine is a native binary that needs OpenSSL. Alpine omits it,
# and without these the engine fails to load with an error that does not
# mention OpenSSL at all.
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copied first, and alone: these two files change far less often than source,
# so Docker reuses the cached dependency layer across most rebuilds.
COPY package*.json ./
RUN npm ci

# The schema must be present before `prisma generate`.
COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only. The compiler and test tooling have done their
# job in the build stage.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The generated Prisma client, the compiled output, and the schema — the schema
# is needed at runtime for `prisma migrate deploy`.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Runs as a non-root user. The node image already provides one, so a
# compromised process cannot write outside what it owns.
RUN chown -R node:node /app
USER node

# Documentation only; the platform injects the real PORT and the app reads it.
EXPOSE 4000

# Migrations are deliberately NOT run here. A container image should be
# reproducible and side-effect free — running migrations on start means every
# replica races to migrate the same database. Run them as a release/pre-deploy
# step instead; see DEPLOY.md.
CMD ["node", "dist/main.js"]
