const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSkaters, getGoalies, NhlRateLimitError } = require('./nhl.ts');

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

test('logs safe rate-limit diagnostics before stopping for a long retry-after', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const events = [];
  global.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '30' } });
  console.warn = (...args) => events.push(args);
  try {
    await assert.rejects(getGoalies('2', '20962097'), NhlRateLimitError);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'NHL stats rate limit');
    const details = events[0][1];
    assert.equal(details.endpoint, '/stats/rest/en/goalie/summary');
    assert.equal(details.status, 429);
    assert.equal(details.pageStart, 0);
    assert.equal(details.attempt, 1);
    assert.equal(details.retryAfter, 30);
    assert.ok(details.durationMs >= 0);
    assert.equal(JSON.stringify(details).includes('20962097'), false);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
