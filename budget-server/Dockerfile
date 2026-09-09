ARG BUILD_ARCH
FROM ghcr.io/home-assistant/${BUILD_ARCH}-base:latest

# Node standard library only -- no package.json, no install step beyond the
# runtime itself.
RUN apk add --no-cache nodejs

WORKDIR /app
COPY server.mjs ./server.mjs
COPY www ./www
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
