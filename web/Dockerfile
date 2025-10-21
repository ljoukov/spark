######################################################################
# Monorepo-aware build for the web workspace
# - Build context is the repo root (set in Cloud Build)
# - Installs with npm workspaces so local packages under packages/* resolve
######################################################################

FROM node:20 AS deps
WORKDIR /workspace

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY web/.npmrc web/.npmrc
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/llm/package.json packages/llm/package.json

# Install workspace dependencies (no root deps needed)
RUN npm ci --workspaces --include-workspace-root=false --no-audit --no-fund


FROM node:20 AS build
WORKDIR /workspace

# Bring in sources for workspaces and the web app
COPY packages ./packages
COPY web ./web

# Ensure adapter-auto picks Node in CI images (matches existing behavior)
ENV GCP_BUILDPACKS="make-sveltekit-adapter-auto-use-node"
# Preserve symlinked workspace modules for Vite/SvelteKit
ENV NODE_OPTIONS="--preserve-symlinks"

# Prepare and build only the web workspace
RUN npm -w web run prepare
RUN npm -w web run build


# ---- Production ----
FROM node:20-slim AS production
WORKDIR /usr/src/app

# Copy the built server bundle
COPY --from=build /workspace/web/build ./build

EXPOSE 3000
CMD ["node", "build"]
