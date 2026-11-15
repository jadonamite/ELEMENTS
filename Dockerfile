# Game server image: shared rules + the Colyseus server. The browser client is hosted separately.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace @elements/shared --workspace @elements/server --include-workspace-root --no-audit --no-fund
COPY shared shared
COPY server server
RUN npm run build --workspace @elements/shared && npm run build --workspace @elements/server
ENV NODE_ENV=production HOST=0.0.0.0 ELEMENTS_DB_PATH=/data/elements-server.sqlite
EXPOSE 2567
CMD ["node", "server/dist/index.js"]
