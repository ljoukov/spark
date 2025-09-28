#!/usr/bin/env bash
set -euo pipefail

# Resize all screenshots in this directory to the App Store required 1242x2688 pixels.
# Outputs resized PNGs into an ./appstore subdirectory alongside the originals.

TARGET_WIDTH=1242
TARGET_HEIGHT=2688

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUTPUT_DIR="${SCRIPT_DIR}/appstore"

mkdir -p "${OUTPUT_DIR}"

shopt -s nullglob
IMAGES=("${SCRIPT_DIR}"/*.{png,PNG,jpg,JPG,jpeg,JPEG})
shopt -u nullglob

if [ ${#IMAGES[@]} -eq 0 ]; then
  echo "no images found in ${SCRIPT_DIR}" >&2
  exit 0
fi

for SOURCE in "${IMAGES[@]}"; do
  BASENAME=$(basename "${SOURCE}")
  STEM="${BASENAME%.*}"
  DESTINATION="${OUTPUT_DIR}/${STEM}-1242x2688.png"

  sips \
    --resampleHeightWidth "${TARGET_HEIGHT}" "${TARGET_WIDTH}" \
    --setProperty format png \
    "${SOURCE}" --out "${DESTINATION}" >/dev/null

  echo "wrote ${DESTINATION}"
done
