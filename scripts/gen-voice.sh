#!/usr/bin/env bash
# Generate the voice-count sample pack with macOS `say` + `afconvert`.
#
# Produces one short 16-bit mono WAV per counting syllable under
# public/voice/en/. Re-run to regenerate (e.g. with a different --voice) or
# adapt for another language folder. Requires macOS (say, afconvert).
#
# Usage:  scripts/gen-voice.sh [VOICE]
#   VOICE  optional macOS voice name (default: system default), e.g. "Samantha"

set -euo pipefail

VOICE_ARG=()
[ "${1:-}" != "" ] && VOICE_ARG=(-v "$1")

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/voice/en"
mkdir -p "$OUT_DIR"

# word -> text spoken (phonetic where the letter name differs from the sound)
declare -a WORDS=(
  "one:one" "two:two" "three:three" "four:four"
  "five:five" "six:six" "seven:seven" "eight:eight"
  "e:ee" "and:and" "a:uh" "trip:trip" "let:let"
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for entry in "${WORDS[@]}"; do
  name="${entry%%:*}"
  text="${entry#*:}"
  say ${VOICE_ARG[@]+"${VOICE_ARG[@]}"} -o "$tmp/$name.aiff" "$text"
  # 16-bit little-endian mono WAV, 22.05 kHz is plenty for speech.
  afconvert "$tmp/$name.aiff" "$OUT_DIR/$name.wav" -d LEI16@22050 -c 1 -f WAVE
  echo "  $name.wav"
done

echo "Voice pack written to $OUT_DIR"
