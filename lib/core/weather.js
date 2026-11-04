/**
 * Open-Meteo weather for share motive (no API key).
 * Default city: Wuhan.
 */

export const CITY_COORDS = {
  武汉: { lat: 30.5928, lon: 114.3055 },
  上海: { lat: 31.2304, lon: 121.4737 },
  北京: { lat: 39.9042, lon: 116.4074 },
  广州: { lat: 23.1291, lon: 113.2644 },
  深圳: { lat: 22.5431, lon: 114.0579 },
  成都: { lat: 30.5728, lon: 104.0668 },
  杭州: { lat: 30.2741, lon: 120.1551 },
}

/**
 * @param {string} city
 * @param {{ lat?: number, lon?: number }} [override]
 */
export function resolveCoords(city, override = {}) {
  if (Number.isFinite(override.lat) && Number.isFinite(override.lon)) {
    return { lat: Number(override.lat), lon: Number(override.lon), city: city || '自定义' }
  }
  const name = String(city || '武汉').trim() || '武汉'
  const hit = CITY_COORDS[name] || CITY_COORDS['武汉']
  return { ...hit, city: CITY_COORDS[name] ? name : '武汉' }
}

/**
 * @param {object} current  open-meteo current block
 * @returns {{ signal: boolean, hook: string, summary: string }}
 */
export function weatherSignal(current) {
  const code = Number(current?.weather_code)
  const temp = Number(current?.temperature_2m)
  const feel = Number(current?.apparent_temperature)
  const rain =
    Number(current?.precipitation) ||
    Number(current?.rain) ||
    Number(current?.showers) ||
    0

  const parts = []
  let signal = false

  if (rain > 0.2 || (Number.isFinite(code) && code >= 51 && code < 100)) {
    signal = true
    parts.push('在下雨')
  } else if (Number.isFinite(code) && code >= 95) {
    signal = true
    parts.push('有雷雨')
  }

  if (Number.isFinite(temp)) {
    if (temp <= 5) {
      signal = true
      parts.push(`才${Math.round(temp)}度`)
    } else if (temp >= 35) {
      signal = true
      parts.push(`热到${Math.round(temp)}度`)
    } else if (Number.isFinite(feel) && feel <= temp - 4 && temp <= 15) {
      signal = true
      parts.push('体感更冷')
    }
  }

  const summary = parts.length
    ? parts.join('，')
    : Number.isFinite(temp)
      ? `大约${Math.round(temp)}度`
      : '天气平常'
  const hook = signal ? summary : ''
  return { signal, hook, summary }
}

/**
 * @param {{ lat: number, lon: number, city?: string }} coords
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function fetchWeather(coords, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'no fetch' }
  }
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(coords.lat))
  url.searchParams.set('longitude', String(coords.lon))
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,rain,weather_code')
  url.searchParams.set('timezone', 'Asia/Shanghai')

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer =
    ac &&
    setTimeout(() => ac.abort(), Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000)
  try {
    const res = await fetchImpl(url.toString(), { signal: ac?.signal })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    const data = await res.json()
    const current = data?.current || {}
    const sig = weatherSignal(current)
    return {
      ok: true,
      city: coords.city || '',
      temp: Number(current.temperature_2m),
      ...sig,
      raw: current,
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
