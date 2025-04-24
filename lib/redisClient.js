// lib/redisManager.js
const { createClient } = require('redis');

let client = null;
let isReady = false;

async function connect() {
  if (!process.env.REDIS_URL) {
    console.warn('⚠️ No REDIS_URL set. Redis disabled.');
    return;
  }

  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', err => console.warn('⚠️ Redis error:', err));
    await client.connect();
    isReady = true;
    console.log('Redis connected.');
  } catch (err) {
    console.warn('Redis connection failed. Falling back.');
    client = null;
    isReady = false;
  }
}

function getClient() {
  return isReady && client?.isOpen ? client : null;
}

module.exports = { connect, getClient, isReady: () => isReady };