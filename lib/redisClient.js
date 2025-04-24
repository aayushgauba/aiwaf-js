// lib/redisClient.js
const { createClient } = require('redis');
const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

client.on('error', err => console.error('Redis Client Error:', err));

async function connectRedis() {
  if (!client.isOpen) await client.connect();
  return client;
}

module.exports = { connectRedis, client };
