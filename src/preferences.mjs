export function readLanguage() {
  try {
    const value = globalThis.localStorage?.getItem('plov-lang')
    return value === 'ru' || value === 'en' ? value : 'ru'
  } catch {
    return 'ru'
  }
}

// Everything is ordered in portions. Kazan and chef orders start at 25
// portions; small orders (subject to availability) are 1–24.
export function isValidQuantity(value, format) {
  if (!['kazan', 'chef', 'small'].includes(format) || String(value).trim() === '') return false
  const number = Number(value)
  if (!Number.isInteger(number)) return false
  return format === 'small' ? number >= 1 && number <= 24 : number >= 25 && number <= 500
}
