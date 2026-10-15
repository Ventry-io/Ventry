FROM node:24-alpine AS base


FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
ARG BETTER_AUTH_URL=https://ventry.m-loeffler.de
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ARG NEXT_PUBLIC_GIT_COMMIT=
ARG NEXT_PUBLIC_GIT_TAG=
ARG NEXT_PUBLIC_BUILD_DATE=
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_GIT_COMMIT=$NEXT_PUBLIC_GIT_COMMIT
ENV NEXT_PUBLIC_GIT_TAG=$NEXT_PUBLIC_GIT_TAG
ENV NEXT_PUBLIC_BUILD_DATE=$NEXT_PUBLIC_BUILD_DATE
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL="postgresql://dummy:dummy@localhost/dummy"
ENV BETTER_AUTH_SECRET="build-placeholder"
RUN npx prisma generate && npm run build:docker

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_GIT_COMMIT=
ARG NEXT_PUBLIC_GIT_TAG=
ARG NEXT_PUBLIC_BUILD_DATE=
ENV NEXT_PUBLIC_GIT_COMMIT=$NEXT_PUBLIC_GIT_COMMIT
ENV NEXT_PUBLIC_GIT_TAG=$NEXT_PUBLIC_GIT_TAG
ENV NEXT_PUBLIC_BUILD_DATE=$NEXT_PUBLIC_BUILD_DATE

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', { signal: AbortSignal.timeout(12000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
