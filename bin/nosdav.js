#!/usr/bin/env node

// requires
const http = require('http')
const https = require('https')
const fs = require('fs')
const url = require('url')
const path = require('path')
const { getContentType, setCorsHeaders, isValidAuthorizationHeader, isValidTargetDir, handlePut, handleGet, handleOptions } = require('../index.js')

// args
const port = process.argv[4] ? parseInt(process.argv[4]) : 3118
const rootDir = 'data'

const options = {
  key: fs.readFileSync(process.argv[2] || './privkey.pem'),
  cert: fs.readFileSync(process.argv[3] || './fullchain.pem')
}

// server
const server = https.createServer(options, (req, res) => {
  const { method, url: reqUrl, headers } = req
  const { pathname } = url.parse(reqUrl)
  // const targetDir = path.dirname(pathname)
  const targetDir = path.dirname(pathname).split(path.sep)[1]
  console.log('targetDir', targetDir)


  // Set CORS headers
  setCorsHeaders(res)


  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    handleOptions(req, res)
  } else if (method === 'PUT') {
    handlePut(req, res, pathname, headers, targetDir, rootDir)
  } else if (method === 'GET') {
    handleGet(req, res, path)
  } else {
    res.statusCode = 405
    res.end('Method not allowed')
    console.log('Method not allowed')
  }
})



// start server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
