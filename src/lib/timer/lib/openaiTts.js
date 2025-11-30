const cache = new Map()
const activeAudios = new Set()

const model = 'gpt-4o-mini-tts'
const defaultVoice = 'alloy'
const outputFormat = 'mp3'
const outputMimeType = outputFormat === 'mp3' ? 'audio/mpeg' : `audio/${outputFormat}`

const maskKeyForLog = (key) => {
  if (typeof key !== 'string' || key.length < 8) return '[redacted]'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

const encodeToDataUrl = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode.apply(null, slice)
  }
  const base64 = btoa(binary)
  return `data:${outputMimeType};base64,${base64}`
}

export const speakWithOpenAI = async ({
  text,
  apiKey,
  voice = defaultVoice,
  prefetchOnly = false
}) => {
  if (!text || !apiKey) {
    throw new Error('Missing text or OpenAI API key for TTS.')
  }

  const cacheKey = `${voice}::${text}`
  const cacheHit = cache.has(cacheKey)
  console.info('[tts] speakWithOpenAI request', {
    voice,
    textLength: text.length,
    cacheHit
  })

  if (!cacheHit) {
    console.debug('[tts] fetching speech audio', {
      voice,
      outputFormat,
      apiKey: maskKeyForLog(apiKey)
    })

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        format: outputFormat
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[tts] OpenAI TTS HTTP error', {
        status: response.status,
        body: errorText
      })
      throw new Error(`OpenAI TTS failed: ${response.status} ${errorText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    console.info('[tts] received speech audio', {
      voice,
      bytes: arrayBuffer.byteLength
    })

    const dataUrl = encodeToDataUrl(arrayBuffer)
    cache.set(cacheKey, dataUrl)
  } else {
    console.debug('[tts] using cached speech audio', {
      voice
    })
  }

  if (prefetchOnly) {
    console.debug('[tts] prefetch cached', { voice })
    return true
  }

  const dataUrl = cache.get(cacheKey)
  const audio = new Audio(dataUrl)
  console.debug('[tts] starting audio playback', {
    voice,
    textLength: text.length
  })
  activeAudios.add(audio)

  return new Promise((resolve, reject) => {
    audio.addEventListener('ended', () => {
      activeAudios.delete(audio)
      console.debug('[tts] audio playback ended', { voice })
      resolve(true)
    })
    audio.addEventListener('error', (event) => {
      activeAudios.delete(audio)
      console.error('[tts] audio playback error', {
        voice,
        event
      })
      reject(new Error('Failed to play OpenAI TTS audio'))
    })
    audio.play().catch((error) => {
      activeAudios.delete(audio)
      console.error('[tts] audio.play() rejected', {
        voice,
        message: error?.message ?? String(error)
      })
      reject(error)
    })
  })
}

export const cancelOpenAiSpeech = () => {
  activeAudios.forEach((audio) => {
    try {
      audio.pause()
      audio.currentTime = 0
    } catch (error) {
      // ignore
    }
  })
  activeAudios.clear()
}
