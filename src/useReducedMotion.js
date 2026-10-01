import { useSyncExternalStore } from 'react'
import { subscribeMotionPreference, getMotionPreference, getServerMotionPreference } from './motionPreference.mjs'

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotionPreference, getMotionPreference, getServerMotionPreference)
}
