#!/usr/bin/env node

// Import required modules
import http from 'http'
import https from 'https'
import fs from 'fs'
import minimist from 'minimist'
import { createRequestHandler } from '../index.js'
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import os from 'os';
import clipboardy from 'clipboardy';

// Convert import.meta.url to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the path to the config file
const configFilePath = path.join(__dirname, '..', 'config.json');

// Function to load configuration from a file
function loadConfig () {
  if (fs.existsSync(configFilePath)) {
    const configData = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(configData);
  }
  return null;
}

// Function to save configuration to a file
function saveConfig (config) {
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
}

// Function to ask questions interactively
function askQuestion (index, config, callback) {
  const questions = [
    `Enter the server port [${chalk.blue(config.port)}]: `,
    `Enter the root directory [${chalk.green(config.root)}]: `,
    `Enable HTTPS (true/false) [${chalk.yellow(config.https)}]: `,
    `Enter the mode (singleuser/multiuser) [${chalk.magenta(config.mode)}]: `,
    `Enter the owners (comma-separated) [${chalk.cyan(config.owners.join(','))}]: `
  ];

  if (index < questions.length) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(chalk.bold(questions[index]), (answer) => {
      switch (index) {
        case 0:
          config.port = parseInt(answer) || config.port;
          break;
        case 1:
          config.root = answer || config.root;
          break;
        case 2:
          config.https = answer.toLowerCase() === 'false' || config.https;
          break;
        case 3:
          config.mode = answer || config.mode;
          break;
        case 4:
          config.owners = answer ? answer.split(',') : config.owners;
          break;
      }
      rl.close();
      askQuestion(index + 1, config, callback);
    });
  } else {
    saveConfig(config);
    callback(config);
  }
}

// Function to start the server
function startServer (config) {

  const sslOptions = config.https
    ? {
      key: fs.readFileSync(config.key),
      cert: fs.readFileSync(config.cert)
    }
    : null;

  const server = config.https
    ? https.createServer(sslOptions, createRequestHandler(config.root, config.mode, config.owners))
    : http.createServer(createRequestHandler(config.root, config.mode, config.owners));

  server.listen(config.port, '0.0.0.0', () => {
    console.log();
  });
}

// Function to strip ANSI codes from a string
function stripAnsiCodes (str) {
  return str.replace(
    /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><~]/g,
    ''
  );
}

// Function to display configuration values and server info in a styled box
function displayInfo (config, localAddress, networkAddress) {
  const lines = [
    '',
    chalk.bold('Current Configuration:'),
    '',
    `- Port:         ${chalk.blue(config.port)}`,
    `- Root Dir:     ${chalk.green(config.root)}`,
    `- HTTPS:        ${chalk.yellow(config.https)}`,
    `- Mode:         ${chalk.magenta(config.mode)}`,
    `- Owners:       ${chalk.cyan(config.owners.join(', '))}`,
  ];

  if (config.https) {
    lines.push(`- SSL Key:      ${chalk.red(config.key)}`);
    lines.push(`- SSL Cert:     ${chalk.red(config.cert)}`);
  }

  lines.push('');
  lines.push(chalk.bold('Serving!'));
  lines.push('');
  lines.push(`- Local:    ${chalk.blue(localAddress)}`);
  lines.push(`- Network:  ${chalk.blue(networkAddress)}`);
  lines.push('');

  // Copy local address to clipboard
  clipboardy.writeSync(localAddress);
  lines.push(chalk.green('Copied local address to clipboard!'));
  lines.push('');

  // Calculate max content width based on stripped lengths
  const maxContentWidth = Math.max(...lines.map(line => stripAnsiCodes(line).length));

  const horizontalLine = `┌─${'─'.repeat(maxContentWidth)}─┐`;

  let infoBox = ` ${horizontalLine}\n`;

  for (const line of lines) {
    const strippedLine = stripAnsiCodes(line);
    const paddingNeeded = maxContentWidth - strippedLine.length;
    infoBox += ` │ ${line}${' '.repeat(paddingNeeded)} │\n`;
  }

  const bottomLine = ` └─${'─'.repeat(maxContentWidth)}─┘`;
  infoBox += bottomLine;

  console.log(infoBox);
}

// Function to get the LAN IP address
function getLocalNetworkIP () {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback to localhost if no external IP is found
}

// Parse command-line arguments with short and long options
const argv = minimist(process.argv.slice(2), {
  alias: {
    p: 'port',
    r: 'root',
    h: 'https',
    m: 'mode',
    o: 'owners',
    k: 'key',
    c: 'cert'
  }
});

// Function to merge command-line arguments with config
function mergeConfigWithArgs (config, args) {
  if (args.port) config.port = parseInt(args.port);
  if (args.root) config.root = args.root;
  if (args.https !== undefined) config.https = args.https === true;
  if (args.mode) config.mode = args.mode;
  if (args.owners) config.owners = args.owners.split(',');
  if (args.key) config.key = args.key;
  if (args.cert) config.cert = args.cert;
}

// Main execution
let config = loadConfig() || {
  key: './privkey.pem',
  cert: './fullchain.pem',
  port: 3118,
  root: 'data',
  https: true, // Ensure HTTPS defaults to true
  mode: 'multiuser',
  owners: []
};

// Check if there are no command-line arguments
if (Object.keys(argv).length === 1 && argv._.length === 0 && !loadConfig()) {
  console.log(chalk.bold('No command-line arguments provided. Starting configuration creator...'));

  // Define localAddress and networkAddress before using them
  const localAddress = `${config.https ? 'https' : 'http'}://localhost:${config.port}`;
  const networkAddress = `${config.https ? 'https' : 'http'}://${getLocalNetworkIP()}:${config.port}`;

  askQuestion(0, config, (newConfig) => {
    displayInfo(newConfig, localAddress, networkAddress);
    startServer(newConfig);
  });
} else {
  // Merge command-line arguments with the loaded/default config
  mergeConfigWithArgs(config, argv);

  const localAddress = `${config.https ? 'https' : 'http'}://localhost:${config.port}`;
  const networkAddress = `${config.https ? 'https' : 'http'}://${getLocalNetworkIP()}:${config.port}`;

  displayInfo(config, localAddress, networkAddress);
  startServer(config);
}
