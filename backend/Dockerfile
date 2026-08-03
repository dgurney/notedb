FROM oven/bun:1.3.14 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN bun build --bytecode --minify --sourcemap \
    --target=bun \
    --compile \
    ./src/index.ts --outfile=./dist/server

FROM oven/bun:1.3.14 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/notes.db

COPY --from=builder --chown=bun:bun /app/dist/server ./server

RUN mkdir -p /data && chown -R bun:bun /app /data

EXPOSE 3000

USER bun
CMD ["./server"]
