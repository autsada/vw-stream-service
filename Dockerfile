# Build stage
FROM node:latest AS build
RUN apt-get update && apt-get install -y dumb-init
RUN apt-get -y update && apt-get -y upgrade && apt-get install -y --no-install-recommends ffmpeg

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Final stage
FROM node:16.17-bullseye-slim

ENV NODE_ENV=production
COPY --from=build /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /usr/src/app
RUN chown -R node:node /usr/src/app/
USER node
COPY --chown=node:node --from=build /usr/src/app/package*.json ./
COPY --chown=node:node --from=build /usr/src/app/dist ./
RUN npm ci --omit=dev
EXPOSE 8080
CMD ["dumb-init", "node", "src/app.js"]