#!/usr/bin/env node

const http = require('http')
const https = require('https')
const fs = require('fs')
const url = require('url')
const path = require('path')

const { verifySignature } = require('nostr-tools')

const port = process.argv[4] ? parseInt(process.argv[4]) : 3118
const rootDir = 'data'

const options = {
  key: fs.readFileSync(process.argv[2]),
  cert: fs.readFileSync(process.argv[3])
}

const isValidNostr = nostr => {
  return /^[0-9a-f]{64}$/.test(nostr)
}

const isValidAuthorizationHeader = authorization => {
  console.log('authorization', authorization)
  const base64String = authorization.replace('Nostr ', '')

  // Decode the base64-encoded string and parse the JSON object
  const decodedString = Buffer.from(base64String, 'base64').toString('utf-8')
  const event = JSON.parse(decodedString)

  // Print the object
  console.log(event)

  const isVerified = verifySignature(event)
  if (isVerified) {
    return event.pubkey
  }
}

const isValidTargetDir = (targetDir, nostr) => {
  const targetSegments = targetDir.split('/').filter(segment => segment !== '')
  return targetSegments.length === 1 && targetSegments[0] === nostr
}

const getContentType = ext => {
  switch (ext) {
    case '.txt':
      return 'text/plain'
    case '.html':
      return 'text/html'
    case '.json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

const server = https.createServer(options, (req, res) => {
  const { method, url: reqUrl, headers } = req
  const { pathname } = url.parse(reqUrl)
  // const targetDir = path.dirname(pathname)
  const targetDir = path.dirname(pathname).split(path.sep)[1]
  console.log('targetDir', targetDir)


  // Set CORS headers
  setCorsHeaders(res)

  // Set CORS options
  const corsOptions = {
    origin: 'https://example.com',
    methods: ['GET', 'PUT'],
    allowedHeaders: ['Content-Type']
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsOptions)
    res.end()
    return
  }

  if (method === 'PUT') {
    const nostr = headers.authorization.replace('Nostr ', '')
    console.log(nostr)

    // Check for the "nostr" header and validate its format
    // if (!nostr || !isValidNostr(nostr)) {

    var pubkey = isValidAuthorizationHeader(headers.authorization)
    if (!nostr || !pubkey) {
      res.statusCode = 401
      res.end(
        'Unauthorized: "nostr" header must be a 32 character lowercase hex string'
      )
      console.log(
        'Unauthorized: "nostr" header must be a 32 character lowercase hex string'
      )

      return
    }

    // check pubkey
    if (targetDir !== pubkey) {
      res.statusCode = 403
      res.end('Forbidden: wrong pubkey')
      console.error(
        'Forbidden: wrong pubkey',
        targetDir,
        pubkey
      )
      return
    }


    // Check if the target directory is valid
    if (!isValidTargetDir(targetDir, pubkey)) {
      res.statusCode = 403
      res.end('Forbidden: Target directory structure is invalid')
      console.log(
        'Forbidden: Target directory structure is invalid',
        targetDir,
        nostr
      )
      return
    }

    const targetPath = path.join('.', rootDir, pathname)

    // Ensure target directory exists
    fs.mkdir(path.dirname(targetPath), { recursive: true }, err => {
      if (err) {
        console.error(err)
        res.statusCode = 500
        res.end('Error creating directory')
        console.log('Error creating directory')
        return
      }

      // Save the file
      const writeStream = fs.createWriteStream(targetPath)
      req.pipe(writeStream)
      writeStream.on('finish', () => {
        res.statusCode = 201
        res.end('File created')
        console.log('File created')
      })
      writeStream.on('error', err => {
        console.error(err)
        res.statusCode = 500
        res.end('Error writing file')
        console.log('Error writing file')
      })
    })
  } else if (method === 'GET') {
    const targetPath = path.join('.', rootDir, pathname)

    // Read the file
    fs.readFile(targetPath, (err, data) => {
      if (err) {
        console.error(err)
        res.statusCode = 404
        res.end('File not found')
        console.log('File not found')
      } else {
        const contentType = getContentType(path.extname(targetPath))
        res.setHeader('Content-Type', contentType)
        res.statusCode = 200
        res.end(data)
      }
    })
  } else {
    res.statusCode = 405
    res.end('Method not allowed')
    console.log('Method not allowed')
  }
})

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
