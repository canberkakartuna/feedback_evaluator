# One image for the site and the API: Vite builds the client, Express serves
# it alongside /api (see server/index.js). Configuration comes from the
# container's environment only — .dockerignore keeps every .env file out.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci runs the `prepare` script, which needs this file (it no-ops without git).
COPY scripts/install-hooks.mjs ./scripts/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY scripts/install-hooks.mjs ./scripts/
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
USER node
# Render and most hosts set PORT; 4000 is the app's own default.
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/index.js"]
