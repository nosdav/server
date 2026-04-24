#!/usr/bin/env node

/**
 * NosDAV Server — Nostr-native Solid storage
 * Thin wrapper around JavaScript Solid Server with Nostr defaults.
 *
 * Usage:
 *   nosdav                          # start with defaults
 *   nosdav --port 8080 --root ./data
 *   nosdav --multiuser --subdomains --idp
 *
 * All JSS flags are passed through.
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jss = path.join(__dirname, '..', 'node_modules', '.bin', 'jss')

// NosDAV defaults — Nostr-focused
const defaults = {
  port: '3000',
  root: './data',
  nostr: true,
  conneg: true,
  notifications: true,
  git: true,
  public: true,
  'mashlib-module': 'https://nosdav.com/browser/mashlib.js'
}

// Parse user args
const userArgs = process.argv.slice(2)
const userFlags = new Set(userArgs.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')[0]))

// Build JSS args: defaults + user overrides
const args = ['start']

// Add defaults unless user overrode them
for (const [key, val] of Object.entries(defaults)) {
  if (userFlags.has(key)) continue
  if (val === true) {
    args.push('--' + key)
  } else {
    args.push('--' + key, val)
  }
}

// Pass through all user args
args.push(...userArgs)

// Run JSS
const child = spawn(jss, args, { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code))
