######################################################################
# Monorepo-aware build for the web workspace
# - Build context is the repo root (set in Cloud Build)
# - Installs with Bun workspaces so local packages under packages/* resolve
######################################################################

FROM oven/bun:1.3.8 AS deps
WORKDIR /workspace

# Copy manifests first for better layer caching
COPY package.json bun.lock bunfig.toml ./
COPY proto/package.json proto/package.json
COPY web/package.json web/package.json
COPY eval/package.json eval/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/proto/package.json packages/proto/package.json

# Install workspace dependencies (root has no deps)
RUN bun install --frozen-lockfile


FROM oven/bun:1.3.8 AS build
WORKDIR /workspace

# Bring in sources for workspaces and the web app
COPY packages ./packages
COPY proto ./proto
COPY web ./web
COPY eval ./eval

# Bring in root manifests and hoisted node_modules from deps stage
COPY --from=deps /workspace/package.json ./package.json
COPY --from=deps /workspace/bun.lock ./bun.lock
COPY --from=deps /workspace/bunfig.toml ./bunfig.toml
COPY --from=deps /workspace/node_modules ./node_modules

# Ensure adapter-auto picks Node in CI images (matches existing behavior)
ENV GCP_BUILDPACKS="make-sveltekit-adapter-auto-use-node"

# Prepare and build only the web workspace
RUN bun --cwd=web run prepare
RUN bun --cwd=web run build


# ---- Production ----
FROM oven/bun:1.3.8 AS production
WORKDIR /usr/src/app

# Runtime dependencies (externalized SSR deps) from deps stage
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./package.json

# Copy the built server bundle
COPY --from=build /workspace/web/build ./build

# Bring runtime env for server-side libs (read via loadLocalEnv())
COPY --from=build /workspace/web/.env.local ./.env.local

# Include workspace sources so workspace symlinks resolve at runtime
COPY --from=build /workspace/packages ./packages

CMD ["bun", "./build/index.js"]
