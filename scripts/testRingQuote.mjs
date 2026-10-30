import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRingQuote } from '../src/utils/requestRingQuote.ts';

const options = () => ({ endpoint: '/api/quote', body: '{"size":"7"}', currency: 'USD', signal: new AbortController().signal, retryDelayMs: 0, timeoutMs: 1000 });
const response = value => Response.json(value);

test('a transient quote failure retries and returns the calculated price', async () => {
  let calls = 0;
  const quote = await requestRingQuote({ ...options(), fetcher: async (path, init) => {
    assert.equal(path, '/api/quote?size=7'); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
    assert.equal(init.body, undefined); assert.equal(init.cache, 'no-store');
    return ++calls === 1 ? new Response('', { status: 503 }) : response({ total: 2800, currency: 'USD', enabled: true });
  } });
  assert.equal(calls, 2); assert.deepEqual(quote, { total: 2800, currency: 'USD', enabled: true });
});

test('draft quote requests keep their preview parameter and demo POST remains supported', async () => {
  await requestRingQuote({ ...options(), endpoint: '/api/quote?preview=draft', fetcher: async (path, init) => {
    assert.equal(path, '/api/quote?preview=draft&size=7'); assert.equal(init.method, 'GET');
    return response({ total: 2800, currency: 'USD' });
  } });
  await requestRingQuote({ ...options(), endpoint: '/api/pricing-demo', method: 'POST', fetcher: async (path, init) => {
    assert.equal(path, '/api/pricing-demo'); assert.equal(init.method, 'POST'); assert.equal(init.body, '{"size":"7"}');
    return response({ total: 2800, currency: 'USD' });
  } });
});

test('a confirmed unpriced selection is distinct from a failed request', async () => {
  let calls = 0;
  const quote = await requestRingQuote({ ...options(), fetcher: async () => { calls++; return response({ total: null, currency: 'USD', enabled: true }); } });
  assert.equal(calls, 1); assert.equal(quote.total, null);
  let failures = 0;
  await assert.rejects(requestRingQuote({ ...options(), fetcher: async () => { failures++; throw new TypeError('Network unavailable'); } }));
  assert.equal(failures, 2, 'exhausted failures must reject rather than return an unpriced quote');
});

test('authentication or invalid-selection errors do not retry', async () => {
  let calls = 0;
  await assert.rejects(requestRingQuote({ ...options(), fetcher: async () => { calls++; return new Response('', { status: 401 }); } }));
  assert.equal(calls, 1);
});

test('changing the design aborts an obsolete quote without starting a retry', async () => {
  const controller = new AbortController(); let calls = 0;
  const request = requestRingQuote({ ...options(), signal: controller.signal, fetcher: async (_path, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  } });
  controller.abort(); await assert.rejects(request, { name: 'AbortError' }); assert.equal(calls, 1);
});

test('a timed-out request can recover on the second attempt', async () => {
  let calls = 0;
  const quote = await requestRingQuote({ ...options(), timeoutMs: 10, fetcher: async (_path, { signal }) => {
    if (++calls === 2) return response({ total: 3125, currency: 'USD' });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true }));
  } });
  assert.equal(quote.total, 3125); assert.equal(calls, 2);
});

test('invalid quote amounts never become a displayed price or a request-only quote', async () => {
  for (const total of [-1, '2800', undefined]) {
    await assert.rejects(requestRingQuote({ ...options(), fetcher: async () => response({ total, currency: 'USD' }) }));
  }
});
