import { verifySignature } from 'nostr-tools'
import http from 'http'
import https from 'https'
import fs from 'fs'
import url from 'url'
import path from 'path'

function createRequestHandler(rootDir, mode, owner) {
  return function handleRequest(req, res) {
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
      handlePut(req, res, headers, targetDir, rootDir, pathname, mode, owner)
    } else if (method === 'GET') {
      handleGet(req, res, rootDir, pathname)
    } else {
      res.statusCode = 405
      res.end('Method not allowed')
      console.log('Method not allowed')
    }
  }
}

/**
 * Returns the content type based on the given file extension.
 *
 * @param {string} ext - The file extension.
 * @returns {string} The corresponding content type.
 */
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

/**
 * Checks if the target directory is valid based on the given nostr value.
 *
 * @param {string} targetDir - The target directory.
 * @param {string} nostr - The nostr value.
 * @returns {boolean} True if the target directory is valid, false otherwise.
 */
const isValidTargetDir = (targetDir, nostr, mode) => {
  if (mode === 'singleuser') {
    // In single user mode, use a fixed subdirectory to store all files
    return targetDir === 'singleuser'
  } else {
    // In multiuser mode, each user has their own subdirectory
    const targetSegments = targetDir
      .split('/')
      .filter(segment => segment !== '')
    return targetSegments.length === 1 && targetSegments[0] === nostr
  }
}

/**
 * Sets CORS headers for the given response object.
 *
 * @param {http.ServerResponse} res - The response object.
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

/**
 * Validates the authorization header and returns the public key if valid.
 *
 * @param {string} authorization - The authorization header value.
 * @returns {(string|null)} The public key if the header is valid, null otherwise.
 */
function isValidAuthorizationHeader(authorization) {
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

/**
 * Handles preflight OPTIONS requests and sets CORS options.
 *
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 */
function handleOptions(req, res) {
  // Set CORS options
  const corsOptions = {
    origin: 'https://example.com',
    methods: ['GET', 'PUT'],
    allowedHeaders: ['Content-Type']
  }

  res.writeHead(204, corsOptions)
  res.end()
}

/**
 * Handles PUT requests to save a file to the server.
 *
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 * @param {string} pathname - The target file's path.
 * @param {Object} headers - The request headers.
 * @param {string} targetDir - The target directory for saving the file.
 * @param {string} rootDir - The root directory for all files.
 */
function handlePut(req, res, headers, targetDir, rootDir, pathname, mode) {
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
  if (mode === 'singleuser') {
    if (pubkey !== owner) {
      res.statusCode = 403
      res.end('Forbidden: wrong owner')
      console.error('Forbidden: wrong owner', targetDir, owner)
      return
    }
  } else {
    if (targetDir !== pubkey) {
      res.statusCode = 403
      res.end('Forbidden: wrong pubkey')
      console.error('Forbidden: wrong pubkey', targetDir, pubkey)
      return
    }
  }

  // Check if the target directory is valid
  if (!isValidTargetDir(targetDir, pubkey, mode)) {
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
}

/**
 * Handles GET requests to read and return the contents of a file.
 *
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 * @param {string} pathname - The requested file's path.
 * @param {string} rootDir - The root directory for all files.
 */
function handleGet(req, res, rootDir, pathname) {
  const targetPath = rootDir.startsWith('/')
    ? path.join(rootDir, pathname)
    : path.join('.', rootDir, pathname)

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
}

export {
  getContentType,
  setCorsHeaders,
  isValidAuthorizationHeader,
  isValidTargetDir,
  handleOptions,
  handlePut,
  handleGet,
  createRequestHandler
}
