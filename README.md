

<div align="center">  
  <h1>nosdav-server</h1>
</div>

<div align="center">  
<i>nosdav-server</i>
</div>

---

<div align="center">
<h4>Documentation</h4>
</div>

---

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/nosdav/server/blob/gh-pages/LICENSE)
[![npm](https://img.shields.io/npm/v/nosdav-server)](https://npmjs.com/package/nosdav-server)
[![npm](https://img.shields.io/npm/dw/nosdav-server.svg)](https://npmjs.com/package/nosdav-server)
[![Github Stars](https://img.shields.io/github/stars/nosdav/server.svg)](https://github.com/nosdav/server/)

## Introduction

NosDAV Server is a simple and secure file server implemented using Node.js, allowing clients to store and retrieve files over HTTPS. The server validates Nostr events in the authorization header and ensures that only authorized users can store and access files.


## Features

&nbsp;&nbsp;✓&nbsp; HTTPS server  
&nbsp;&nbsp;✓&nbsp; PUT and GET requests for uploading and downloading files  
&nbsp;&nbsp;✓&nbsp; Nostr event validation using nostr-tools  
&nbsp;&nbsp;✓&nbsp; CORS handling  
&nbsp;&nbsp;✓&nbsp; Basic file validation  
&nbsp;&nbsp;✓&nbsp; Proper response headers

## Requirements

- Node.js v12 or higher
- HTTPS certificate and private key

## Installation

Clone the repository and install:

```bash
git clone https://github.com/nosdav/server.git && cd server
npm install
```

## Setup

To use this server, you need a valid private key (privkey.pem) and a certificate (fullchain.pem) for HTTPS. Place these files in the project directory or update the file paths in the options object when creating the server.  An example way to generate these is below.

```bash
openssl req -outform PEM -keyform PEM -new -x509 -sha256 -newkey rsa:2048 -nodes -keyout ../privkey.pem -days 365 -out ../fullchain.pem
```

## Usage
Start the server:

```bash
node server.js private-key.pem fullchain.pem
```
The server will listen for incoming requests at https://localhost:3008.

## API Endpoints

### PUT /:nostrid/:filename
Upload a file for the given Nostr.

Header: Authorization: Nostr base64(NostrEvent)
```json
{
  "kind": 27235,
  "created_at": "Math.floor(http://Date.now() / 1000)",
  "tags": [["url", "path"]],
  "content": ""
}
```
Signed with the pubkey of the user.

Content-Type can vary according to the file being uploaded.

### GET /:nostrid/:filename
Download a file by its name for a specific Nostr.

## Contributing

Feel free to create a pull request if you would like to contribute or suggest improvements to the project. Please follow the existing style and add comments for any changes you make.

## License

- MIT
