# VerifyAI Browser Extension

AI-powered fact-checking browser extension for social media videos. Works with YouTube, Instagram, TikTok, X (Twitter), and Facebook.

## Features

- **Inline Badge**: Fact-check button injected directly on video pages
- **Side Panel**: Detailed results with claims, sources, and risk assessment
- **Popup**: Quick access to current video status and settings
- **Multi-Platform**: YouTube, Instagram, TikTok, X, and Facebook support
- **30+ Languages**: Arabic, English, French, and many more
- **Local Caching**: Results cached for faster access to previously analyzed videos
- **Self-Hosted Support**: Connect to your own backend instance

## Installation

### Chrome

1. Build the extension:
   ```bash
   cd extension
   npm run build:chrome
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Enable "Developer mode" (top right toggle)

4. Click "Load unpacked" and select the `dist/chrome` folder

### Firefox

1. Build the extension:
   ```bash
   cd extension
   npm run build:firefox
   ```

2. Open Firefox and go to `about:debugging#/runtime/this-firefox`

3. Click "Load Temporary Add-on"

4. Select `dist/firefox/manifest.json`

## Development

### Prerequisites

- Node.js 18+
- A running instance of the Fact-Check-SocialMedia backend

### Setup

```bash
cd extension
npm install  # (no dependencies needed for vanilla JS)
```

### Build Commands

```bash
# Development build with watch mode
npm run dev

# Production builds
npm run build          # Both Chrome and Firefox
npm run build:chrome   # Chrome only
npm run build:firefox  # Firefox only

# Package for distribution
npm run package:chrome   # Creates dist/verifyai-chrome.zip
npm run package:firefox  # Creates dist/verifyai-firefox.zip
```

### Project Structure

```
extension/
├── manifest.json              # Chrome MV3 manifest
├── manifest.firefox.json      # Firefox manifest
├── src/
│   ├── background/
│   │   ├── service-worker.js  # Background service worker
│   │   └── api-client.js      # Backend API communication
│   ├── content/
│   │   ├── content-script.js  # Content script entry point
│   │   ├── platforms/         # Platform-specific adapters
│   │   │   ├── youtube.js
│   │   │   ├── instagram.js
│   │   │   ├── tiktok.js
│   │   │   ├── twitter.js
│   │   │   └── facebook.js
│   │   └── ui/
│   │       ├── badge.js       # Inline badge component
│   │       └── badge.css
│   ├── sidepanel/             # Side panel UI
│   ├── popup/                 # Popup UI
│   ├── options/               # Options page
│   └── shared/
│       ├── constants.js       # Shared constants
│       ├── storage.js         # Chrome storage utilities
│       └── messaging.js       # Message passing utilities
├── icons/                     # Extension icons
└── _locales/                  # i18n translations
```

## Configuration

### Backend URL

By default, the extension connects to `http://localhost:8000`. To change this:

1. Click the extension icon
2. Go to Settings
3. Enter your backend URL
4. Click "Test" to verify connection
5. Save settings

### Self-Hosted Backend

Make sure your backend has CORS enabled for browser extensions. The required CORS configuration is automatically added when you run the Fact-Check-SocialMedia backend.

## Usage

1. Navigate to a supported video page (YouTube, Instagram, TikTok, X, or Facebook)

2. Look for the VerifyAI badge near the video player

3. Click "Verify" to start fact-checking

4. View progress in the badge or open the side panel for detailed updates

5. Once complete, see the score, verdict, and detailed claims analysis

## API Endpoints Used

The extension communicates with these backend endpoints:

- `POST /api/analyze` - Start fact-checking a video
- `GET /api/jobs/{id}` - Poll for job status
- `GET /api/health` - Test backend connectivity
- `GET /api/config` - Get supported languages

## Browser Compatibility

| Feature | Chrome | Firefox |
|---------|--------|---------|
| Inline Badge | ✅ | ✅ |
| Side Panel | ✅ (native) | ✅ (sidebar) |
| Popup | ✅ | ✅ |
| Options Page | ✅ | ✅ |
| Local Storage | ✅ | ✅ |

## Troubleshooting

### Extension not working on video pages

- Make sure the backend is running
- Check the backend URL in settings
- Refresh the page after installing/updating the extension

### "Connection failed" error

- Verify the backend URL is correct
- Ensure the backend is running and accessible
- Check for CORS issues in the browser console

### Badge not appearing

- Some platforms may require page refresh after extension install
- Check if the video URL is in a supported format
- Look for errors in the browser extension console

## License

See the main project LICENSE file.
