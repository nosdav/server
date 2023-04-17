#!/usr/bin/env node

// Required modules
const http = require('http')
const https = require('https')
const fs = require('fs')
const minimist = require('minimist')

// Custom library
const {
  handleRequest
} = require('../index.js')

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  default: {
    key: './privkey.pem',
    cert: './fullchain.pem',
    port: 3118,
    root: 'data',
    https: true
  },
  alias: {
    k: 'key',
    c: 'cert',
    p: 'port',
    r: 'root',
    s: 'https'
  }
})

// SSL options
const sslOptions = argv.https
  ? {
    key: fs.readFileSync(argv.key),
    cert: fs.readFileSync(argv.cert)
  }
  : null

// Create a server (HTTP or HTTPS) with the provided request handler
const server = argv.https
  ? https.createServer(sslOptions, handleRequest)
  : http.createServer(handleRequest)

// Start the server and listen on the specified port
server.listen(argv.port, () => {
  console.log(
    `Server running at ${argv.https ? 'https' : 'http'}://localhost:${argv.port
    }`
  )
})
