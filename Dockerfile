# ============================================================
# Cox's Dream Moment — the site and its self-hosted admin panel.
#
# The app is plain Express serving static pages; the only thing it needs
# from the host is a writable DATA_DIR, because everything an admin edits
# (content/*.json) and everything they upload (images/) is written there
# rather than into the checkout.
#
# THAT DIRECTORY MUST BE A PERSISTENT VOLUME. Without one, every deploy
# starts from the seed files in this repository and the owner's edits,
# prices and uploaded photographs are gone. In Coolify: Persistent Storage
# → mount a volume at /data, and set DATA_DIR=/data.
#
# On first boot with an empty volume the server copies its seed content and
# images across, so a fresh install comes up with a working site rather
# than an empty one.
# ============================================================

FROM node:22-alpine

# Tini reaps zombies and passes signals through, so a redeploy stops the
# server cleanly instead of waiting for Docker to kill it.
RUN apk add --no-cache tini

WORKDIR /app

# Install first, with the lockfile, so a content or markup change does not
# re-resolve the dependency tree on every deploy.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# The volume mounts here. Declared so the image still runs (on a throwaway
# directory) if someone starts it without one — it will not lose data that
# way, it simply has none to keep.
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000

# Run as the unprivileged user the node image already ships with, and give
# it ownership of the data directory so uploads can be written.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# The app's own /health route, so a container that is up but not serving is
# reported as unhealthy rather than left in place.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
