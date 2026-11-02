FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci --workspace mlightnote-web
COPY web/ web/
RUN npm run build --workspace mlightnote-web

# nginx:alpine already ships a non-root "nginx" user at uid/gid 101, which
# matches the tmpfs ownership Compose mounts for the read-only rootfs
# (APP_DESIGN.md §16.5, §20.2).
FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
