const { verifySignature } = require('nostr-tools')

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

const isValidTargetDir = (targetDir, nostr) => {
  const targetSegments = targetDir.split('/').filter(segment => segment !== '')
  return targetSegments.length === 1 && targetSegments[0] === nostr
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

/**
 * Validates the authorization header and returns the public key if valid.
 *
 * @param {string} authorization - The authorization header value.
 * @returns {(string|undefined)} The public key if the header is valid, undefined otherwise.
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

function handlePut(req, res, path, headers, targetDir, rootDir) {
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

}

function handleGet(req, res, path) {
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
}


module.exports = {
  getContentType: getContentType,
  setCorsHeaders: setCorsHeaders,
  isValidAuthorizationHeader: isValidAuthorizationHeader,
  isValidTargetDir: isValidTargetDir,
  handleOptions: handleOptions,
  handlePut: handlePut,
  handleGet: handleGet
}
