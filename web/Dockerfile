######################################################################
# Monorepo-aware build for the web workspace
# - Build context is the repo root (set in Cloud Build)
# - Installs with npm workspaces so local packages under packages/* resolve
######################################################################

FROM node:22 AS deps
WORKDIR /workspace

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY web/.npmrc web/.npmrc
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/llm/package.json packages/llm/package.json

# Install workspace dependencies (no root deps needed)
RUN npm ci --workspaces --include-workspace-root=false --no-audit --no-fund


FROM node:22 AS build
WORKDIR /workspace

# Bring in sources for workspaces and the web app
COPY packages ./packages
COPY web ./web

# Bring in root manifests and hoisted node_modules from deps stage
COPY --from=deps /workspace/package.json ./package.json
COPY --from=deps /workspace/package-lock.json ./package-lock.json
COPY --from=deps /workspace/node_modules ./node_modules
# Note: workspace packages typically hoist to root; per-package node_modules may not exist.

# Ensure adapter-auto picks Node in CI images (matches existing behavior)
ENV GCP_BUILDPACKS="make-sveltekit-adapter-auto-use-node"
# Preserve symlinked workspace modules for Vite/SvelteKit and expand heap for Rollup/Vite
ENV NODE_OPTIONS="--preserve-symlinks --max-old-space-size=4096"

# Prepare and build only the web workspace
RUN npm -w web run prepare
RUN npm -w web run build


# ---- Production ----
FROM node:22-slim AS production
WORKDIR /usr/src/app

# Runtime dependencies (externalized SSR deps) from deps stage
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./package.json

# Copy the built server bundle
COPY --from=build /workspace/web/build ./build

# Bring runtime env for server-side libs (read via loadLocalEnv())
COPY --from=build /workspace/web/.env.local ./.env.local

CMD ["node", "build"]
