FROM oven/bun:1 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/src ./src
COPY --from=build /app/messages ./messages

RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "src/server/node.ts"]
