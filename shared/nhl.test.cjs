const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSkaters, NhlRateLimitError } = require('./nhl.ts');

test('reports rate limits after bounded retries', async () => {
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  let requests = 0;
  global.fetch = async () => {
    requests++;
    return new Response('', { status: 429, headers: { 'retry-after': '1' } });
  };
  global.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  try {
    await assert.rejects(getSkaters('2', '20992000'), NhlRateLimitError);
    assert.ok(requests >= 3 && requests <= 6);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
  }
});

test('retries a transient rate limit before reading stats', async () => {
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  const counts = new Map();
  global.fetch = async (url) => {
    const key = String(url).includes('/realtime?') ? 'realtime' : 'summary';
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count === 1) return new Response('', { status: 429 });
    return Response.json({ data: [], total: 0 });
  };
  global.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  try {
    assert.deepEqual(await getSkaters('2', '20982099'), []);
    assert.equal(counts.get('summary'), 2);
    assert.equal(counts.get('realtime'), 2);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
  }
});

test('does not silently replace unavailable realtime statistics with zeroes', async () => {
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  global.fetch = async (url) => String(url).includes('/realtime?')
    ? new Response('', { status: 429 })
    : Response.json({ data: [], total: 0 });
  global.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  try {
    await assert.rejects(getSkaters('2', '20972098'), NhlRateLimitError);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
  }
});
