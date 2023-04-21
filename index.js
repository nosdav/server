import { verifySignature } from 'nostr-tools'
import http from 'http'
import https from 'https'
import fs from 'fs'
import url from 'url'
import path from 'path'

/**
 * Creates a request handler function with the given rootDir, mode, and owners.
 *
 * @param {string} rootDir - The root directory for all files.
 * @param {string} mode - The server mode ('singleuser' or 'multiuser').
 * @param {Array<string>} owners - The public keys of the owners (used in 'singleuser' mode).
 * @returns {function} A request handler function that handles incoming HTTP requests based on the specified rootDir, mode, and owners.
 */
function createRequestHandler(rootDir, mode, owners) {
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
      handlePut(req, res, headers, targetDir, rootDir, pathname, mode, owners)
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
const getContentType = (ext) => {
  switch (ext) {
    case '.txt':
      return 'text/plain'
    case '.html':
    case '.htm':
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
 * @param {string} mode - The server mode ('singleuser' or 'multiuser').
 * @returns {boolean} True if the target directory is valid, false otherwise.
 */
const isValidTargetDir = (targetDir, nostr, mode) => {
  if (mode === 'singleuser') {
    // In single user mode, use a fixed subdirectory to store all files
    return true
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
 * @param {Object} headers - The request headers.
 * @param {string} targetDir - The target directory for saving the file.
 * @param {string} rootDir - The root directory for all files.
 * @param {string} pathname - The target file's path.
 * @param {string} mode - The server mode ('singleuser' or 'multiuser').
 * @param {Array<string>} owners - The public keys of the owners (used in 'singleuser' mode).
 */
function handlePut(
  req,
  res,
  headers,
  targetDir,
  rootDir,
  pathname,
  mode,
  owners
) {
  const nostr = headers.authorization.replace('Nostr ', '')
  console.log(nostr)

  // Check for the "nostr" header and validate its format
  // if (!nostr || !isValidNostr(nostr)) {

  const pubkey = isValidAuthorizationHeader(headers.authorization)
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
    if (!owners.includes(pubkey)) {
      res.statusCode = 403
      res.end('Forbidden: wrong owner')
      console.error('Forbidden: wrong owner', owners, pubkey)
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

  const targetPath = path.isAbsolute(rootDir)
    ? path.join(rootDir, pathname)
    : path.join('.', rootDir, pathname)

  // Check if the target path is within the root directory
  const resolvedRootDir = path.resolve(rootDir)

  if (mode === 'singleuser') {
    if (!targetPath.startsWith(resolvedRootDir)) {
      res.statusCode = 403
      res.end('Forbidden: Target path is outside the root directory')
      console.log('Forbidden: Target path is outside the root directory', targetPath, rootDir)
      return
    }
  } else if (mode === 'multiuser') {
    const resolvedPubKeyDir = path.resolve(rootDir, pubkey)
    if (!targetPath.startsWith(resolvedPubKeyDir)) {
      res.statusCode = 403
      res.end('Forbidden: Target path is outside the user directory')
      console.log('Forbidden: Target path is outside the user directory', targetPath, resolvedPubKeyDir)
      return
    }
  }

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
      console.log('File created', targetPath)
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
