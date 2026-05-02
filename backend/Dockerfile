FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /data && chown -R bun:bun /app /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/notes.db

EXPOSE 3000

USER bun
CMD ["bun", "run", "src/index.ts"]
