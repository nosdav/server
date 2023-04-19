

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
openssl req -outform PEM -keyform PEM -new -x509 -sha256 -newkey rsa:2048 -nodes -keyout ./privkey.pem -days 365 -out ./fullchain.pem
```

## Usage
Start the server:

```bash
node server.js --key private-key.pem --cert fullchain.pem --port your_port
```

Options

    -k or --key: The path to the private key file. Default: './privkey.pem'
    -c or --cert: The path to the certificate file. Default: './fullchain.pem'
    -p or --port: The port on which the server should listen. Default: 3118
    -r or --root: The root directory for file storage. Default: 'data'
    -s or --https: A flag to enable HTTPS. Default: true (HTTPS)
    -m or --mode: singleuser or multiuser. Default: multiuser
    -o or --owners: pubkeys (csv) of owners in singleuser mode

The server will listen for incoming requests at https://localhost:3118 if port is not set

In multiuser mode the pubkey will be used to create per user directories beneath the root directory.

## JavaScript Library

```JavaScript
import http from 'http';
import { createRequestHandler } from 'nostr-server-library';

const port = 3000;
const rootDir = './data'; // The root directory where all files will be stored
const mode = 'singleuser'; // The server mode: 'singleuser' or 'multiuser'
const owner = 'your_public_key_here'; // Replace with your public key in 'singleuser' mode

const requestHandler = createRequestHandler(rootDir, mode, owner);

const server = http.createServer(requestHandler);

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
```

## API Endpoints

### PUT /:nostrid/:filename
Upload a file for the given Nostr.

Header: Authorization: Nostr base64(NostrEvent)
```json
{
  "kind": 27235,
  "created_at": "Math.floor(http://Date.now() / 1000)",
  "tags": [["u", "path"]],
  "content": ""
}
```
Signed with the pubkey of the user.

Content-Type can vary according to the file being uploaded.

### GET /:nostrid/:filename
Download a file by its name for a specific Nostr.

Where nostrid is the pubkey of the user, but only in multiuser mode


## Docker

### Building the Docker Image

First, you need to build the Docker image for the server. Navigate to the root directory of the project, where the Dockerfile is located, and run the following command:

```
docker build -t nosdav .
```

### Running the Server with Docker

Now that you have built the Docker image, you can run a container using that image. You can map the port and mount a volume to persist the data directory.

### Mapping the Port

Use the -p flag to map the host port to the container port. In this case, we'll map the host port 3118 to the container port 3118:

```bash
docker run -d -p 3118:3118 nosdav
```

### Mounting a Volume for Data Storage

To persist the data directory across container restarts or removals, you can use the --mount flag to create a volume and mount it to the container:

```bash
docker run -d -p 3118:3118 --mount type=bind,source=my-data,destination=/usr/src/app/data nosdav
```

Replace my-data with your preferred volume name.

Now your server is up and running with Docker. You can access it on your host machine at http://localhost:3118.

## Contributing

Feel free to create a pull request if you would like to contribute or suggest improvements to the project. Please follow the existing style and add comments for any changes you make.

## License

- MIT
