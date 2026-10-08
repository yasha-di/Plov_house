import test from 'node:test'
import assert from 'node:assert/strict'
import { readLanguage, isValidQuantity } from '../src/preferences.mjs'
import { getMotionPreference, subscribeMotionPreference } from '../src/motionPreference.mjs'

test('language tolerates missing, blocked and invalid storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    for (const [value, expected] of [[null, 'ru'], ['', 'ru'], ['fr', 'ru'], ['ru', 'ru'], ['en', 'en']]) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => value } })
      assert.equal(readLanguage(), expected)
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked') } })
    assert.equal(readLanguage(), 'ru')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('Blocked') } } })
    assert.equal(readLanguage(), 'ru')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})

test('quantity is counted in portions: big kazan and chef from 25, small 1–24', () => {
  for (const value of ['', ' ', 0, -1, 1.5, '25.5', 'no', Infinity, NaN, 24, 501]) {
    assert.equal(isValidQuantity(value, 'kazan'), false, String(value))
  }
  for (const value of [25, '40', 500]) assert.equal(isValidQuantity(value, 'kazan'), true)
  assert.equal(isValidQuantity(24, 'chef'), false)
  assert.equal(isValidQuantity(25, 'chef'), true)
  assert.equal(isValidQuantity(1, 'small'), true)
  assert.equal(isValidQuantity(24, 'small'), true)
  assert.equal(isValidQuantity(25, 'small'), false)
  assert.equal(isValidQuantity(30, 'unknown'), false)
})

test('motion preference notifies on changes and unsubscribes', () => {
  const previous = globalThis.window
  const listeners = new Set()
  const media = {
    matches: false,
    addEventListener: (type, fn) => { assert.equal(type, 'change'); listeners.add(fn) },
    removeEventListener: (type, fn) => { assert.equal(type, 'change'); listeners.delete(fn) },
  }
  globalThis.window = { matchMedia: () => media }
  try {
    let updates = 0
    const unsubscribe = subscribeMotionPreference(() => updates++)
    assert.equal(getMotionPreference(), false)
    media.matches = true
    for (const listener of listeners) listener()
    assert.equal(getMotionPreference(), true)
    assert.equal(updates, 1)
    unsubscribe()
    assert.equal(listeners.size, 0)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})
