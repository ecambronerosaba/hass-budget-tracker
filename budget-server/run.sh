#!/usr/bin/with-contenv bashio
# shellcheck shell=bash

bashio::log.info "Starting budget-server..."

export PORT="8099"
export DATA_DIR="/data"
export STATIC_DIR="/app/www"

bashio::log.info "Persisting to ${DATA_DIR}, serving app from ${STATIC_DIR}, listening on ${PORT}."

exec node /app/server.mjs
