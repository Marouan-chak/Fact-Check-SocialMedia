#!/bin/bash

# Generate PNG icons from SVG
# Requires: ImageMagick (convert) or Inkscape

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$SCRIPT_DIR/../icons"
SVG_FILE="$ICONS_DIR/icon.svg"

# Check if SVG exists
if [ ! -f "$SVG_FILE" ]; then
    echo "Error: $SVG_FILE not found"
    exit 1
fi

# Sizes needed for browser extensions
SIZES=(16 32 48 128)

# Try to use convert (ImageMagick) first, then inkscape
if command -v convert &> /dev/null; then
    echo "Using ImageMagick..."
    for size in "${SIZES[@]}"; do
        convert -background none -resize "${size}x${size}" "$SVG_FILE" "$ICONS_DIR/icon-${size}.png"
        echo "Created icon-${size}.png"
    done
elif command -v inkscape &> /dev/null; then
    echo "Using Inkscape..."
    for size in "${SIZES[@]}"; do
        inkscape --export-type=png --export-filename="$ICONS_DIR/icon-${size}.png" -w "$size" -h "$size" "$SVG_FILE"
        echo "Created icon-${size}.png"
    done
else
    echo "Error: Neither ImageMagick (convert) nor Inkscape found."
    echo "Please install one of them to generate PNG icons."
    echo ""
    echo "On Ubuntu/Debian: sudo apt install imagemagick"
    echo "On macOS: brew install imagemagick"
    echo ""
    echo "Alternatively, you can manually convert the SVG to PNG using an online tool."
    exit 1
fi

echo ""
echo "Icons generated successfully!"
