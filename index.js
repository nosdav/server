const { verifySignature } = require('nostr-tools')

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


module.exports = {
  getContentType: getContentType,
  setCorsHeaders: setCorsHeaders,
  isValidAuthorizationHeader: isValidAuthorizationHeader,
  isValidTargetDir: isValidTargetDir
}
