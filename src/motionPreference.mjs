const query = '(prefers-reduced-motion: reduce)'

export const getMotionPreference = () => window.matchMedia(query).matches
export const getServerMotionPreference = () => true

export function subscribeMotionPreference(callback) {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
