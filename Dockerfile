# DAWLab Hub: the self-hostable sharing server (not the desktop app).
#   docker build -t dawlab-hub .
#   docker run -p 8080:8080 -v dawlab-hub:/data -e HUB_CREATE_KEY=change-me dawlab-hub
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data

COPY server/package.json server/package-lock.json* server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The hub runs its TypeScript directly (Node >= 22.18 strips types) and shares
# the sync protocol and HTTP range parsing with the desktop app.
COPY shared/ shared/
COPY electron/media/range.ts electron/media/range.ts
COPY server/src/ server/src/

# Mounted disks (Docker volumes, Render Disks) often arrive owned by root, so
# start as root, hand the data dir to the unprivileged `node` user, then drop to it.
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
# The hub has no public endpoint to probe, so the health check only checks that the port accepts connections.
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "require('net').connect(process.env.PORT,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["sh", "-c", "mkdir -p \"$DATA_DIR\" && chown node:node \"$DATA_DIR\" && exec su node -s /bin/sh -c \"exec node server/src/index.ts\""]
