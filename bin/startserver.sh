#!/usr/bin/env bash

CERT_DIR="./" # Change this to the directory where you store your certificates
PRIVKEY_PATH="${CERT_DIR}/privkey.pem"
FULLCHAIN_PATH="${CERT_DIR}/fullchain.pem"

if [ ! -d "$CERT_DIR" ]; then
  mkdir "$CERT_DIR"
fi

if [ ! -f "$PRIVKEY_PATH" ] || [ ! -f "$FULLCHAIN_PATH" ]; then
  echo "Generating self-signed certificates..."
  openssl req -outform PEM -keyform PEM -new -x509 -sha256 -newkey rsa:2048 -nodes -subj "/C=US/ST=California/L=San Francisco/O=My Company/CN=localhost" -keyout ./privkey.pem -days 365 -out ./fullchain.pem
fi

echo "Starting server..."
./bin/nosdav.js
