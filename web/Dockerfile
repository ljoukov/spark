FROM node:20 AS base

WORKDIR /usr/src/app

COPY . .

RUN npm install

ENV GCP_BUILDPACKS="make-sveltekit-adapter-auto-use-node"
RUN npm run prepare
RUN npm run build

# ---- Production ----
FROM node:20-slim AS production
WORKDIR /usr/src/app
COPY --from=base /usr/src/app/build ./build
COPY package-prod.json package.json
EXPOSE 3000
CMD ["node", "build"]