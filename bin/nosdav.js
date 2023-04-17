#!/usr/bin/env node

// requires
const http = require('http')
const https = require('https')
const fs = require('fs')
const url = require('url')
const path = require('path')

const { getContentType, setCorsHeaders, isValidAuthorizationHeader, isValidTargetDir, handlePut, handleGet, handleOptions, handleRequest } = require('../index.js')

// args
const port = process.argv[4] ? parseInt(process.argv[4]) : 3118
const rootDir = 'data'

const options = {
  key: fs.readFileSync(process.argv[2] || './privkey.pem'),
  cert: fs.readFileSync(process.argv[3] || './fullchain.pem')
}


// server
const server = https.createServer(options, handleRequest)


// start server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
