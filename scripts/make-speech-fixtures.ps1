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
  "mochi-status" = "Mochi, what is everyone doing?"
  "hey-mochi-status" = "Hey Mochi, what is everyone doing?"
  "architect-stair-core" = "Architect, add a stair core here."
  "mochi-ask-climate" = "Mochi, ask Climate to run a winter shadow study."
  "product-bench" = "Product, design a bench for the courtyard."
  "reviewer-heights" = "Reviewer, check the floor heights."
  "measure" = "Measure."
  "undo" = "Undo."
  "sketch-area" = "Sketch area."
  "bake" = "Bake to Rhino."
  "measure-the-towers" = "Measure the distance between these towers."
  # "|" is a pause of a second and a half: a held request spoken in two parts.
  "copy-this-there" = "Copy this.|There."
}
# A tool's name is over in about a second: if the speech detector is still loading when the fake microphone starts
# playing (it can take three seconds on a busy laptop), the name is lost. These get four seconds of silence before and
# five after instead.
$short = @("measure", "undo", "sketch-area", "bake", "copy-this-there")
foreach ($name in $phrases.Keys) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = 0
  $file = Join-Path $out "$name.wav"
  $synth.SetOutputToWaveFile($file, $format)
  $prompt = New-Object System.Speech.Synthesis.PromptBuilder
  $lead = if ($short -contains $name) { 4000 } else { 1000 }
  $trail = if ($short -contains $name) { 5000 } else { 3000 }
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds($lead))
  $parts = @(if ($phrases[$name]) { $phrases[$name].Split("|") })
  for ($i = 0; $i -lt $parts.Count; $i++) {
    if ($i -gt 0) { $prompt.AppendBreak([TimeSpan]::FromMilliseconds(1500)) }
    $prompt.AppendText($parts[$i])
  }
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds($trail))
  $synth.Speak($prompt)
  $synth.Dispose()
  Write-Output "wrote $file"
}
