# Synthesises the speech fixtures for the fake microphone (test-assets/speech) with the Windows speech voice, offline.
# Each file is 16 kHz, 16-bit mono PCM: one second of silence, the phrase, then three seconds of silence, so voice
# activity detection sees a clear start and a clear end. Usage: powershell -File scripts/make-speech-fixtures.ps1
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot "..\test-assets\speech"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$phrases = @{
  "make-this-wall-300-thick" = "Make this wall three hundred thick."
  "add-three-floors" = "Add three floors."
  "silence" = ""
}
foreach ($name in $phrases.Keys) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = 0
  $file = Join-Path $out "$name.wav"
  $synth.SetOutputToWaveFile($file, $format)
  $prompt = New-Object System.Speech.Synthesis.PromptBuilder
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds(1000))
  if ($phrases[$name]) { $prompt.AppendText($phrases[$name]) }
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds(3000))
  $synth.Speak($prompt)
  $synth.Dispose()
  Write-Output "wrote $file"
}
