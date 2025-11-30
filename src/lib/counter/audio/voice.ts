const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window

export const initVoice = () => {
  if (!hasSpeech) return
  // prime voices list
  window.speechSynthesis.getVoices()
}

export const speakCount = (count: number) => {
  if (!hasSpeech) return
  const utter = new SpeechSynthesisUtterance(String(count))
  utter.rate = 1
  utter.pitch = 1
  utter.volume = 1
  const voices = window.speechSynthesis.getVoices()
  const englishVoice = voices.find((v) => v.lang.startsWith('en'))
  if (englishVoice) utter.voice = englishVoice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utter)
}
