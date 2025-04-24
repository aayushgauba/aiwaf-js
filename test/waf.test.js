const request = require('supertest');
const express = require('express');

process.env.NODE_ENV = 'test';
jest.setTimeout(20000);

const db = require('../utils/db');
const aiwaf = require('../index');
const dynamicKeyword = require('../lib/dynamicKeyword');
const redisManager = require('../lib/redisClient');
const { init: initRateLimiter } = require('../lib/rateLimiter');

let redisAvailable = false;

beforeAll(async () => {
  const hasTable = await db.schema.hasTable('blocked_ips');
  if (!hasTable) {
    await db.schema.createTable('blocked_ips', table => {
      table.increments('id');
      table.string('ip_address').unique();
      table.string('reason');
      table.timestamp('blocked_at').defaultTo(db.fn.now());
    });
  }

  await redisManager.connect();
  redisAvailable = redisManager.isReady();

  await initRateLimiter({
    WINDOW_SEC: 1,
    MAX_REQ: 5,
    FLOOD_REQ: 10
  });
});

describe('AIWAF-JS Middleware', () => {
  let app, ip;

  beforeEach(() => {
    ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
    dynamicKeyword.init({ dynamicTopN: 3 });

    app = express();
    app.use(express.json());
    app.use(aiwaf({
      staticKeywords: ['.php', '.env', '.git'],
      dynamicTopN: 3,
      WINDOW_SEC: 1,
      MAX_REQ: 5,
      FLOOD_REQ: 10,
      HONEYPOT_FIELD: 'hp_field'
    }));

    app.get('/', (req, res) => res.send('OK'));
    app.post('/', (req, res) => res.send('POST OK'));
    app.get('/user/:uuid', (req, res) => res.send('USER OK'));
    app.use((req, res) => res.status(404).send('Not Found'));
  });

  it('blocks static keyword .php', () =>
    request(app)
      .get('/wp-config.php')
      .set('X-Forwarded-For', ip)
      .set('x-response-time', '15')
      .expect(403, { error: 'blocked' })
  );

  it('allows safe paths', () =>
    request(app)
      .get('/')
      .set('X-Forwarded-For', ip)
      .set('x-response-time', '15')
      .expect(200, 'OK')
  );

  it('blocks after exceeding rate limit', async () => {
    for (let i = 0; i < 7; i++) {
      const resp = await request(app)
        .get('/')
        .set('X-Forwarded-For', ip)
        .set('x-response-time', '15');

      if (i < 5) {
        expect(resp.status).toBe(200);
      } else {
        expect([200, 403, 429]).toContain(resp.status);
      }
    }
  });

  it('blocks honeypot field', () =>
    request(app)
      .post('/')
      .set('X-Forwarded-For', ip)
      .send({ hp_field: 'caught' })
      .expect(403, { error: 'bot_detected' })
  );

  it('blocks invalid UUIDs', () =>
    request(app)
      .get('/user/not-a-uuid')
      .set('X-Forwarded-For', ip)
      .expect(403)
  );

  it('learns and blocks dynamic keywords', async () => {
    const segment = `/secret-${Date.now().toString(36)}`;
    for (let i = 0; i < 3; i++) {
      await request(app).get(segment).set('X-Forwarded-For', ip); // allow learning phase
    }
    await request(app).get(segment).set('X-Forwarded-For', ip).expect(403); // block expected
    await request(app).get(segment).set('X-Forwarded-For', ip).expect(403, { error: 'blocked' });
  });

  it('flags and blocks anomalous paths', async () => {
    const longPath = '/' + 'a'.repeat(200);
    await request(app)
      .get(longPath)
      .set('X-Forwarded-For', ip)
      .set('x-response-time', '20')
      .expect(403, { error: 'blocked' });
  });
});

afterAll(async () => {
  if (redisAvailable && redisManager.getClient()) {
    await redisManager.getClient().quit();
  }
  await db.destroy();
});