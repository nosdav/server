#!/usr/bin/env node

/**
 * Test script for the inbox functionality
 * This demonstrates how to POST JSON files to the inbox endpoint
 */

import { generatePrivateKey, getPublicKey, finishEvent } from 'nostr-tools'
import fetch from 'node-fetch'

// Generate a test keypair
const privateKey = generatePrivateKey()
const publicKey = getPublicKey(privateKey)

console.log('Test Keypair:')
console.log('Private Key:', privateKey)
console.log('Public Key:', publicKey)
console.log()

// Create a test event
const event = {
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: 'Test inbox post',
  pubkey: publicKey
}

// Sign the event
const signedEvent = finishEvent(event, privateKey)
console.log('Signed Event:', signedEvent)
console.log()

// Encode the event for the Authorization header
const encodedEvent = Buffer.from(JSON.stringify(signedEvent)).toString('base64')
console.log('Encoded Event:', encodedEvent)
console.log()

// Test data to post
const testData = {
  message: 'Hello from the inbox test!',
  timestamp: new Date().toISOString(),
  eventId: signedEvent.id,
  pubkey: publicKey
}

// Function to test the inbox endpoint
async function testInbox () {
  const serverUrl = 'http://localhost:3118' // Adjust if your server runs on a different port

  // Test multiuser mode endpoint
  const multiserEndpoint = `${serverUrl}/${publicKey}/inbox/`

  // Test singleuser mode endpoint  
  const singleuserEndpoint = `${serverUrl}/inbox/`

  console.log('Testing inbox endpoints...')
  console.log()

  for (const [mode, endpoint] of [['multiuser', multiserEndpoint], ['singleuser', singleuserEndpoint]]) {
    console.log(`Testing ${mode} mode: ${endpoint}`)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Nostr ${encodedEvent}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      })

      const responseText = await response.text()

      console.log(`Status: ${response.status}`)
      console.log(`Response: ${responseText}`)

      if (response.ok) {
        console.log(`✅ ${mode} mode test successful!`)
        console.log(`File should be saved as: ${signedEvent.id}.json`)
      } else {
        console.log(`❌ ${mode} mode test failed`)
      }
    } catch (error) {
      console.log(`❌ ${mode} mode test error:`, error.message)
    }

    console.log()
  }
}

// Run the test
console.log('Starting inbox functionality test...')
console.log('Make sure your NosDav server is running on localhost:3118')
console.log()

testInbox().catch(console.error) 