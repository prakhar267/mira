#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/prakhar/Desktop/Companaro/artifacts/product-demo"
CAPTURES="$ROOT/captures"
RENDER="$ROOT/render"
OUTPUT="$ROOT/mira-product-demo.mp4"
FONT="/System/Library/Fonts/Avenir.ttc"
FONT_BOLD="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FPS=30

mkdir -p "$RENDER"

render_card() {
  swift "$ROOT/render-card.swift" "$CAPTURES/$1" "$RENDER/$2" "$3" "$4" "$5" "$6"
}

render_intro() {
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$RENDER/00-intro.png" \
    -f lavfi -i "anoisesrc=color=pink:amplitude=0.012:duration=5" \
    -filter_complex "[0:v]zoompan=z='min(zoom+0.00022,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1920x1080:fps=${FPS},fade=t=in:st=0:d=0.7,fade=t=out:st=4.3:d=0.7[v];[1:a]lowpass=f=950,afade=t=in:st=0:d=1.2,afade=t=out:st=4:d=1,volume=0.22[a]" \
    -map "[v]" -map "[a]" -t 5 -r "$FPS" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 128k "$RENDER/00-intro.mp4"
}

render_scene() {
  local index="$1"
  local image="$2"
  local duration="$3"
  local tag="$4"
  local headline="$5"
  local detail="$6"
  local frames=$((duration * FPS))
  local fade_out
  fade_out=$(awk "BEGIN { print $duration - 0.55 }")

  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$RENDER/${index}.png" \
    -f lavfi -i "anoisesrc=color=pink:amplitude=0.009:duration=${duration}" \
    -filter_complex "[0:v]zoompan=z='min(zoom+0.00016,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${FPS},fade=t=in:st=0:d=0.5,fade=t=out:st=${fade_out}:d=0.55[v];[1:a]lowpass=f=900,afade=t=in:st=0:d=0.6,afade=t=out:st=${fade_out}:d=0.55,volume=0.18[a]" \
    -map "[v]" -map "[a]" -t "$duration" -r "$FPS" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 128k "$RENDER/${index}.mp4"
}

render_outro() {
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$RENDER/09-outro.png" \
    -f lavfi -i "anoisesrc=color=pink:amplitude=0.012:duration=5" \
    -filter_complex "[0:v]zoompan=z='min(zoom+0.0002,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1920x1080:fps=${FPS},fade=t=in:st=0:d=0.65,fade=t=out:st=4.35:d=0.65[v];[1:a]lowpass=f=950,afade=t=in:st=0:d=0.8,afade=t=out:st=4:d=1,volume=0.22[a]" \
    -map "[v]" -map "[a]" -t 5 -r "$FPS" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 128k "$RENDER/09-outro.mp4"
}

render_card "01-home.png" "00-intro.png" "intro" "English  •  हिन्दी  •  Hinglish" "MIRA" "An AI companion that remembers"
render_card "01-home.png" "01-home.png" "scene" "FEELS PRESENT" "More than a chat window" "A companion space designed to feel warm and alive."
render_card "02-chat.png" "02-chat.png" "scene" "NATURAL CONVERSATION" "English and Hinglish, naturally" "A calmer chat experience with context that carries forward."
render_card "03-voice.png" "03-voice.png" "scene" "HANDS-FREE VOICE" "Talk without tapping again" "Automatic listening, language detection, and expressive tone."
render_card "04-video.png" "04-video.png" "scene" "LIVE AVATAR CALLS" "Face-to-face companionship" "An expressive avatar with calls designed for continuous conversation."
render_card "06-memory.png" "05-memory.png" "scene" "CONTINUITY YOU CONTROL" "Memory that stays inspectable" "See, correct, pin, pause, or remove anything Mira remembers."
render_card "05-moments.png" "06-moments.png" "scene" "YOUR SHARED LIFE" "Keep the moments that matter" "Photos, calls, small wins, and memories in one beautiful place."
render_card "07-wardrobe.png" "07-wardrobe.png" "scene" "MAKE HER YOURS" "Style, personality, voice, and places" "Customize the experience without losing your shared history."
render_card "08-profile.png" "08-profile.png" "scene" "DESIGNED AROUND YOU" "Support and boundaries on your terms" "Tune response style, relationship warmth, privacy, and follow-ups."
render_card "01-home.png" "09-outro.png" "outro" "luma-companion.prakhargupta267.workers.dev/demo" "Meet Mira" "Present. Personal. Yours to control."

render_intro
render_scene "01-home" "01-home.png" 7 "FEELS PRESENT" "More than a chat window" "A companion space designed to feel warm and alive."
render_scene "02-chat" "02-chat.png" 8 "NATURAL CONVERSATION" "English and Hinglish, naturally" "A calmer chat experience with context that carries forward."
render_scene "03-voice" "03-voice.png" 7 "HANDS-FREE VOICE" "Talk without tapping again" "Automatic listening, language detection, and expressive tone."
render_scene "04-video" "04-video.png" 7 "LIVE AVATAR CALLS" "Face-to-face companionship" "An expressive avatar with calls designed for continuous conversation."
render_scene "05-memory" "06-memory.png" 8 "CONTINUITY YOU CONTROL" "Memory that stays inspectable" "See, correct, pin, pause, or remove anything Mira remembers."
render_scene "06-moments" "05-moments.png" 7 "YOUR SHARED LIFE" "Keep the moments that matter" "Photos, calls, small wins, and memories in one beautiful place."
render_scene "07-wardrobe" "07-wardrobe.png" 7 "MAKE HER YOURS" "Style, personality, voice, and places" "Customize the experience without losing your shared history."
render_scene "08-profile" "08-profile.png" 7 "DESIGNED AROUND YOU" "Support and boundaries on your terms" "Tune response style, relationship warmth, privacy, and follow-ups."
render_outro

ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$ROOT/concat.txt" -c copy -movflags +faststart "$OUTPUT"
printf '%s\n' "$OUTPUT"
