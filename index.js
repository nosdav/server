import { verifySignature } from 'nostr-tools'
import http from 'http'
import https from 'https'
import fs from 'fs'
import url from 'url'
import path from 'path'
import { spawn } from 'child_process'

/**
 * Manages invites for pubkeys to access the server.
 * Invites are stored in a JSON file in the root directory.
 */
const INVITES_FILE = 'invites.json'

/**
 * Initializes the invites file if it doesn't exist.
 * 
 * @returns {void}
 */
function initInvitesFile () {
  if (!fs.existsSync(INVITES_FILE)) {
    fs.writeFileSync(INVITES_FILE, JSON.stringify({ invites: [] }, null, 2))
    console.log(`Created ${INVITES_FILE}`)
  }
}

/**
 * Gets the list of invited pubkeys.
 * 
 * @returns {Array<string>} Array of invited pubkeys
 */
function getInvites () {
  try {
    initInvitesFile()
    const data = fs.readFileSync(INVITES_FILE, 'utf8')
    return JSON.parse(data).invites || []
  } catch (error) {
    console.error('Error reading invites file:', error)
    return []
  }
}

/**
 * Checks if a pubkey has been invited.
 * 
 * @param {string} pubkey - The pubkey to check
 * @returns {boolean} True if the pubkey is invited, false otherwise
 */
function isInvited (pubkey) {
  const invites = getInvites()
  return invites.includes(pubkey)
}

/**
 * Adds a pubkey to the invites list.
 * 
 * @param {string} pubkey - The pubkey to invite
 * @returns {boolean} True if the pubkey was added, false if it was already invited
 */
function addInvite (pubkey) {
  try {
    const invites = getInvites()
    if (invites.includes(pubkey)) {
      return false
    }

    invites.push(pubkey)
    fs.writeFileSync(INVITES_FILE, JSON.stringify({ invites }, null, 2))
    return true
  } catch (error) {
    console.error('Error adding invite:', error)
    return false
  }
}

/**
 * Removes a pubkey from the invites list.
 * 
 * @param {string} pubkey - The pubkey to remove
 * @returns {boolean} True if the pubkey was removed, false if it wasn't in the list
 */
function removeInvite (pubkey) {
  try {
    const invites = getInvites()
    const index = invites.indexOf(pubkey)

    if (index === -1) {
      return false
    }

    invites.splice(index, 1)
    fs.writeFileSync(INVITES_FILE, JSON.stringify({ invites }, null, 2))
    return true
  } catch (error) {
    console.error('Error removing invite:', error)
    return false
  }
}

/**
 * Handles git HTTP requests using git http-backend
 * 
 * @param {object} req - The HTTP request object
 * @param {object} res - The HTTP response object
 * @param {string} rootDir - The root directory where git repositories are stored
 * @param {string} urlPath - The decoded URL path
 * @returns {boolean} True if the request was handled, false otherwise
 */
function handleGitRequest (req, res, rootDir, urlPath) {
  // We only intercept URLs that *begin* with "/something.git"
  const match = urlPath.match(/^\/([^/]+\.git)(\/.*)?$/);
  if (!match) return false; // not a Git path → fall through

  const repoRelative = match[1]; // "my-repo.git"
  const repoAbs = path.join(rootDir, repoRelative);

  // Does the requested repo actually exist on disk?
  if (!fs.existsSync(repoAbs) || !fs.statSync(repoAbs).isDirectory()) {
    res.statusCode = 404;
    res.end('Repository not found');
    return true;
  }

  /* Each Git request (info/refs, git-upload-pack, git-receive-pack, etc.) is
     delegated to `git http-backend`, exactly the same CGI
     program Apache/Nginx use. */
  const env = {
    ...process.env,
    GIT_PROJECT_ROOT: rootDir,
    GIT_HTTP_EXPORT_ALL: '', // allow read-only
    GIT_HTTP_RECEIVE_PACK: 'true', // enable push support
    PATH_INFO: urlPath,
    REQUEST_METHOD: req.method,
    CONTENT_TYPE: req.headers['content-type'] || '',
    QUERY_STRING: req.url.split('?')[1] || '',
    REMOTE_USER: '', // anonymous
    CONTENT_LENGTH: req.headers['content-length'] || '0',
  };

  const child = spawn('git', ['http-backend'], { env });

  let buffer = Buffer.alloc(0);
  let headersSent = false;

  child.stdout.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);

    if (!headersSent) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headerSection = buffer.subarray(0, headerEnd).toString();
        const bodySection = buffer.subarray(headerEnd + 4);

        // Parse CGI headers
        const lines = headerSection.split('\r\n');
        for (const line of lines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            res.setHeader(key, value);
          }
        }

        headersSent = true;
        res.write(bodySection);
        buffer = Buffer.alloc(0);
      }
    } else {
      res.write(buffer);
      buffer = Buffer.alloc(0);
    }
  });

  child.stdout.on('end', () => {
    res.end();
  });

  req.pipe(child.stdin);
  child.stderr.pipe(process.stderr);

  child.on('error', err => {
    console.error('Failed to spawn git-http-backend:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  return true; // Request was handled
}

/**
 * Creates a request handler function with the given rootDir, mode, and owners.
 *
 * @param {string} rootDir - The root directory for all files.
 * @param {string} mode - The server mode ('singleuser' or 'multiuser').
 * @param {Array<string>} owners - The public keys of the owners (used in 'singleuser' mode).
 * @param {boolean} invitesEnabled - Whether the invite system is enabled.
 * @param {boolean} inboxEnabled - Whether the inbox system is enabled.
 * @param {boolean} gitEnabled - Whether git clone support is enabled.
 * @returns {function} A request handler function that handles incoming HTTP requests based on the specified rootDir, mode, and owners.
 */
function createRequestHandler (rootDir, mode, owners, invitesEnabled = true, inboxEnabled = true, gitEnabled = false) {
  return function handleRequest (req, res) {
    const { method, url: reqUrl, headers } = req
    const { pathname } = url.parse(reqUrl)
    const adjustedPathname = pathname.endsWith('/') ? `${pathname}index.html` : pathname

    // Handle git requests first if git is enabled
    if (gitEnabled && handleGitRequest(req, res, rootDir, decodeURIComponent(pathname))) {
      return; // Git request was handled, return early
    }

    // const targetDir = path.dirname(pathname)
    const targetDir = path.dirname(pathname).split(path.sep)[1]
    console.log('targetDir', targetDir)

    // Set CORS headers
    setCorsHeaders(res)

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      handleOptions(req, res)
    } else if (method === 'PUT') {
      handlePut(req, res, headers, targetDir, rootDir, pathname, mode, owners, invitesEnabled)
    } else if (method === 'GET') {
      handleGet(req, res, rootDir, adjustedPathname)
    } else if (method === 'POST' && pathname === '/api/invites') {
      // Only handle invite management if invites are enabled
      if (invitesEnabled) {
        handleInviteManagement(req, res, headers, owners)
      } else {
        res.statusCode = 404
        res.end('Not Found: Invite system is disabled')
      }
    } else if (method === 'POST' && pathname.includes('/inbox/')) {
      // Only handle inbox requests if inbox is enabled
      if (inboxEnabled) {
        handleInbox(req, res, headers, targetDir, rootDir, mode, owners, invitesEnabled)
      } else {
        res.statusCode = 404
        res.end('Not Found: Inbox system is disabled')
      }
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
    // Text
    case '.txt':
      return 'text/plain'
    case '.html':
    case '.htm':
      return 'text/html'
    case '.json':
      return 'application/json'
    case '.css':
      return 'text/css'
    case '.js':
      return 'application/javascript'

    // Images
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    case '.webp':
      return 'image/webp'

    // Audio
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    case '.m4a':
      return 'audio/mp4'
    case '.flac':
      return 'audio/flac'
    case '.m3u':
      return 'audio/x-mpegurl'
    case '.m3u8':
      return 'application/vnd.apple.mpegurl'
    case '.pls':
      return 'audio/x-scpls'
    case '.xspf':
      return 'application/xspf+xml'
    case '.asx':
      return 'video/x-ms-asf'
    case '.wpl':
      return 'application/vnd.ms-wpl'

    // Video
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.ogv':
      return 'video/ogg'
    case '.mov':
      return 'video/quicktime'
    case '.avi':
      return 'video/x-msvideo'

    // Other
    case '.ttl':
      return 'text/turtle'
    case '.jsonld':
      return 'application/ld+json'
    case '.md':
      return 'text/markdown'
    // this is for the my-mind mindmapping app
    case '.mymind':
      return 'application/json'


    // Default
    default:
      return 'text/html'
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
function setCorsHeaders (res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  // Set the X-Powered-By header
  res.setHeader('X-Powered-By', 'nosdav/alpha')
}

/**
 * Validates the authorization header and returns the public key if valid.
 *
 * @param {string} authorization - The authorization header value.
 * @returns {(string|null)} The public key if the header is valid, null otherwise.
 */
function isValidAuthorizationHeader (authorization) {
  console.log('authorization', authorization)
  const base64String = authorization.replace('Nostr ', '')

  // Decode the base64-encoded string and parse the JSON object
  const decodedString = Buffer.from(base64String, 'base64').toString('utf-8')
  const event = JSON.parse(decodedString)

  // Print the object
  console.log(event)

  const isVerified = verifySignature(event)
  if (isVerified) {
    return { pubkey: event.pubkey, eventId: event.id }
  }
}

/**
 * Handles preflight OPTIONS requests and sets CORS options.
 *
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 */
function handleOptions (req, res) {
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
 * @param {boolean} invitesEnabled - Whether the invite system is enabled.
 */
function handlePut (
  req,
  res,
  headers,
  targetDir,
  rootDir,
  pathname,
  mode,
  owners,
  invitesEnabled = true
) {
  const nostr = headers?.authorization?.replace('Nostr ', '')
  console.log('nostr auth header', nostr)

  const authResult = isValidAuthorizationHeader(headers.authorization)

  if (!nostr || !authResult) {
    res.statusCode = 401
    res.end(
      'Unauthorized: "nostr" header must a signed nostr event base64 encoded'
    )
    console.log(
      'Unauthorized: "nostr" header must a signed nostr event base64 encoded'
    )

    return
  }

  const pubkey = authResult.pubkey

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

    // Check if the pubkey is invited for multiuser mode
    // Only check when creating a top-level directory and invites are enabled
    const pubkeyDirPath = path.join(rootDir, pubkey)
    const isCreatingPubkeyDir = !fs.existsSync(pubkeyDirPath)

    if (invitesEnabled && isCreatingPubkeyDir && !isInvited(pubkey) && !owners.includes(pubkey)) {
      res.statusCode = 403
      res.end('Forbidden: You need an invite to create a directory')
      console.error('Forbidden: Uninvited pubkey', pubkey)
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
    if (!path.resolve(targetPath).startsWith(resolvedRootDir)) {
      res.statusCode = 403
      res.end('Forbidden: Target path is outside the root directory')
      console.log('Forbidden: Target path is outside the root directory', targetPath, rootDir, mode)
      return
    }
  } else if (mode === 'multiuser') {
    const resolvedPubKeyDir = path.resolve(rootDir, pubkey)
    if (!path.resolve(targetPath).startsWith(resolvedPubKeyDir)) {
      res.statusCode = 403
      res.end('Forbidden: Target path is outside the user directory')
      console.log('Forbidden: Target path is outside the user directory', targetPath, resolvedPubKeyDir, mode)
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
function handleGet (req, res, rootDir, pathname) {
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

/**
 * Handles invite management API requests.
 * 
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 * @param {Object} headers - The request headers.
 * @param {Array<string>} owners - The public keys of the owners.
 */
function handleInviteManagement (req, res, headers, owners) {
  const authResult = isValidAuthorizationHeader(headers.authorization)

  if (!authResult) {
    res.statusCode = 401
    res.end('Unauthorized: Valid authorization header required')
    console.log('Unauthorized: Valid authorization header required')
    return
  }

  const pubkey = authResult.pubkey

  // Only owners can manage invites
  if (!owners.includes(pubkey)) {
    res.statusCode = 403
    res.end('Forbidden: Only owners can manage invites')
    console.error('Forbidden: Non-owner tried to manage invites', pubkey)
    return
  }

  // Parse the request body
  let body = ''
  req.on('data', chunk => {
    body += chunk.toString()
  })

  req.on('end', () => {
    try {
      const data = JSON.parse(body)
      const { action, targetPubkey } = data

      if (!targetPubkey) {
        res.statusCode = 400
        res.end('Bad Request: targetPubkey is required')
        return
      }

      let result = false
      let message = ''

      switch (action) {
        case 'add':
          result = addInvite(targetPubkey)
          message = result ? 'Invite added' : 'Pubkey already invited'
          break
        case 'remove':
          result = removeInvite(targetPubkey)
          message = result ? 'Invite removed' : 'Pubkey not found in invites'
          break
        case 'list':
          const invites = getInvites()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ invites }))
          return
        default:
          res.statusCode = 400
          res.end('Bad Request: Invalid action')
          return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: result, message }))
    } catch (error) {
      console.error('Error processing invite management request:', error)
      res.statusCode = 400
      res.end('Bad Request: Invalid JSON')
    }
  })
}

/**
 * Handles POST requests to save JSON files to the inbox directory.
 *
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 * @param {Object} headers - The request headers.
 * @param {string} targetDir - The target directory (should be a pubkey).
 * @param {string} rootDir - The root directory for all files.
 * @param {string} mode - The server mode ('singleuser' or 'multiuser').
 * @param {Array<string>} owners - The public keys of the owners.
 * @param {boolean} invitesEnabled - Whether the invite system is enabled.
 */
function handleInbox (req, res, headers, targetDir, rootDir, mode, owners, invitesEnabled = true) {
  const authResult = isValidAuthorizationHeader(headers.authorization)

  if (!authResult) {
    res.statusCode = 401
    res.end('Unauthorized: Valid authorization header required')
    console.log('Unauthorized: Valid authorization header required')
    return
  }

  const { pubkey, eventId } = authResult

  // In multiuser mode, check if the target directory matches the authenticated pubkey
  if (mode === 'multiuser' && targetDir !== pubkey) {
    res.statusCode = 403
    res.end('Forbidden: Can only post to your own inbox')
    console.error('Forbidden: Wrong pubkey for inbox', targetDir, pubkey)
    return
  }

  // In singleuser mode, check if the pubkey is an owner
  if (mode === 'singleuser' && !owners.includes(pubkey)) {
    res.statusCode = 403
    res.end('Forbidden: Only owners can post to inbox')
    console.error('Forbidden: Non-owner tried to post to inbox', pubkey)
    return
  }

  // Check invites for multiuser mode
  if (mode === 'multiuser' && invitesEnabled && !isInvited(pubkey) && !owners.includes(pubkey)) {
    res.statusCode = 403
    res.end('Forbidden: You need an invite to post to inbox')
    console.error('Forbidden: Uninvited pubkey tried to post to inbox', pubkey)
    return
  }

  // Create the inbox directory path
  const inboxDir = mode === 'singleuser'
    ? path.join(rootDir, 'inbox')
    : path.join(rootDir, targetDir, 'inbox')

  const targetPath = path.join(inboxDir, `${eventId}.json`)

  // Ensure inbox directory exists
  fs.mkdir(inboxDir, { recursive: true }, err => {
    if (err) {
      console.error(err)
      res.statusCode = 500
      res.end('Error creating inbox directory')
      console.log('Error creating inbox directory')
      return
    }

    // Parse and validate JSON body
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        // Validate that it's valid JSON
        JSON.parse(body)

        // Save the JSON file
        fs.writeFile(targetPath, body, (err) => {
          if (err) {
            console.error(err)
            res.statusCode = 500
            res.end('Error writing file')
            console.log('Error writing file')
          } else {
            res.statusCode = 201
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              success: true,
              message: 'File created in inbox',
              filename: `${eventId}.json`
            }))
            console.log('Inbox file created', targetPath)
          }
        })
      } catch (error) {
        res.statusCode = 400
        res.end('Bad Request: Invalid JSON')
        console.error('Invalid JSON in inbox request:', error)
      }
    })
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
  handleInbox,
  createRequestHandler
}
