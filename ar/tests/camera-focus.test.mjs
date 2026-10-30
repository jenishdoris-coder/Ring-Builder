import test from 'node:test';
import assert from 'node:assert/strict';
import { enableContinuousAutofocus } from '../src/camera-focus.ts';

test('camera startup enables continuous autofocus when the track supports it', async () => {
  let requested;
  const track = { getCapabilities: () => ({ focusMode: ['manual', 'continuous'] }),
    applyConstraints: async constraints => { requested = constraints; } };
  assert.equal(await enableContinuousAutofocus(track), true);
  assert.deepEqual(requested, { advanced: [{ focusMode: 'continuous' }] });
});

test('unsupported autofocus controls leave camera constraints alone', async () => {
  for (const capabilities of [{}, { focusMode: ['manual'] }]) {
    assert.equal(await enableContinuousAutofocus({ getCapabilities: () => capabilities,
      applyConstraints: async () => { assert.fail('must not force unsupported focus'); } }), false);
  }
  assert.equal(await enableContinuousAutofocus(undefined), false);
  assert.equal(await enableContinuousAutofocus({}), false);
});

test('focus driver errors do not reject camera startup', async () => {
  assert.equal(await enableContinuousAutofocus({ getCapabilities: () => ({ focusMode: ['continuous'] }),
    applyConstraints: async () => { throw new DOMException('Camera rejected focus', 'OverconstrainedError'); } }), false);
  assert.equal(await enableContinuousAutofocus({ getCapabilities: () => { throw new Error('unavailable capabilities'); },
    applyConstraints: async () => {} }), false);
});
