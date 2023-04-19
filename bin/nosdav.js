#!/usr/bin/env node

// Import required modules
import http from 'http'
import https from 'https'
import fs from 'fs'
import minimist from 'minimist'
import { createRequestHandler } from '../index.js'

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
  default: {
    key: './privkey.pem',
    cert: './fullchain.pem',
    port: 3118,
    root: 'data',
    https: true,
    mode: 'multiuser',
    owner: null
  },
  alias: {
    k: 'key',
    c: 'cert',
    p: 'port',
    r: 'root',
    s: 'https',
    m: 'mode',
    o: 'owners'
  }
})

argv.owners = argv.owners ? argv.owners.split(',') : []
console.log(argv)

// SSL options
const sslOptions = argv.https
  ? {
      key: fs.readFileSync(argv.key),
      cert: fs.readFileSync(argv.cert)
    }
  : null

// Create a server (HTTP or HTTPS) with the provided request handler
const server = argv.https
  ? https.createServer(sslOptions, createRequestHandler(argv.root, argv.mode, argv.owners))
  : http.createServer(createRequestHandler(argv.root, argv.mode, argv.owners))

// Start the server and listen on the specified port
server.listen(argv.port, () => {
  console.log(
    `Server running at ${argv.https ? 'https' : 'http'}://localhost:${argv.port
    }`
  )
})
