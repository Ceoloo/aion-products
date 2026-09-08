# Revenue Copilot — container image (HTTP entrypoint shape #2)
#
# From aion-products repo root:
#   npm run setup:core && npm ci
#   docker build -t aion-revenue-copilot:local .
#
# Requires vendored @aion/core at build time (.vendor/aion-core with dist/).

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json ./
COPY .vendor .vendor
RUN npm ci --omit=dev
COPY src ./src
COPY fixtures ./fixtures
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "src/server.ts"]
