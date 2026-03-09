######################################################################
# Monorepo-aware build for the web workspace
# - Build context is the repo root (set in Cloud Build)
# - Uses Bun isolated workspaces, so install in the build stage where
#   the full workspace tree is present
######################################################################

FROM oven/bun:1.3.8 AS build
WORKDIR /workspace

# Copy manifests first for better layer caching.
COPY package.json bun.lock bunfig.toml ./
COPY proto/package.json proto/package.json
COPY web/package.json web/package.json
COPY eval/package.json eval/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/proto/package.json packages/proto/package.json

# Copy the full workspace tree before install so Bun can materialize the
# isolated workspace layout instead of relying on copied node_modules.
COPY packages ./packages
COPY proto ./proto
COPY web ./web
COPY eval ./eval

RUN bun install --frozen-lockfile

ARG BUILD_TARGET=""
ARG BUILD_GIT_COMMIT_SHA=""
ARG BUILD_GIT_BRANCH=""
ARG BUILD_PROVIDER_BUILD_ID=""
ARG BUILD_PROVIDER_REVISION=""

# Ensure adapter-auto picks Node in CI images (matches existing behavior).
ENV GCP_BUILDPACKS="make-sveltekit-adapter-auto-use-node"
ENV BUILD_TARGET="${BUILD_TARGET}"
ENV BUILD_GIT_COMMIT_SHA="${BUILD_GIT_COMMIT_SHA}"
ENV BUILD_GIT_BRANCH="${BUILD_GIT_BRANCH}"
ENV BUILD_PROVIDER_BUILD_ID="${BUILD_PROVIDER_BUILD_ID}"
ENV BUILD_PROVIDER_REVISION="${BUILD_PROVIDER_REVISION}"

RUN bun --cwd=web run prepare
RUN bun --cwd=web run build


FROM oven/bun:1.3.8 AS production
WORKDIR /usr/src/app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/web/node_modules ./web/node_modules
COPY --from=build /workspace/packages/schemas/node_modules ./packages/schemas/node_modules
COPY --from=build /workspace/packages/proto/node_modules ./packages/proto/node_modules
COPY --from=build /workspace/packages/llm/node_modules ./packages/llm/node_modules
COPY --from=build /workspace/package.json ./package.json

COPY --from=build /workspace/web/build ./build
COPY --from=build /workspace/web/.env.local ./.env.local
COPY --from=build /workspace/packages ./packages

CMD ["bun", "./build/index.js"]
