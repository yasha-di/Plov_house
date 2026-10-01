export function readLanguage() {
  try {
    const value = globalThis.localStorage?.getItem('plov-lang')
    return value === 'ru' || value === 'en' ? value : 'en'
  } catch {
    return 'en'
  }
}

export function isValidQuantity(value, format) {
  if (format === 'chef') return true
  if (!['portions', 'kazan'].includes(format) || String(value).trim() === '') return false
  const number = Number(value)
  return Number.isInteger(number) && number >= (format === 'kazan' ? 3 : 1) && number <= 100
}
