# Crypto Chart Analyzer

AI-powered cryptocurrency technical analysis tool that uses OpenRouter's vision AI to analyze chart patterns and provide trading recommendations.

## Features

- Drag & drop chart image upload
- AI-powered technical analysis using Claude 3.5 Sonnet
- Position recommendations (LONG/SHORT) with certainty percentage
- Detailed analysis reports including patterns, indicators, and risk factors
- Clean, minimal UI inspired by Vercel
- No database - completely stateless
- Ready for GitHub deployment

## Prerequisites

- Node.js 18+ installed
- OpenRouter API key ([Get one here](https://openrouter.ai/keys))

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Add your OpenRouter API key to `.env`:
```
OPENROUTER_API_KEY=your_actual_api_key_here
```

## Running the Application

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Usage

1. Select your desired timeframe from the dropdown
2. Drag and drop a crypto chart image (or click to browse)
3. Click "Analyze Chart" to get AI-powered analysis
4. Review the recommendation (LONG/SHORT), certainty percentage, and detailed report

## Supported Image Formats

- PNG
- JPG/JPEG
- WEBP

Maximum file size: 10MB

## API Endpoints

- `GET /` - Main application interface
- `POST /api/analyze` - Analyze chart image
- `GET /api/health` - Health check and API status

## Deployment

### GitHub Pages

This app requires a Node.js backend and cannot be deployed to GitHub Pages directly. Consider these alternatives:

### Vercel

1. Push to GitHub
2. Import repository in Vercel
3. Add `OPENROUTER_API_KEY` environment variable
4. Deploy

### Railway / Render

1. Push to GitHub
2. Connect repository
3. Add environment variables
4. Deploy

## Security Notes

- The `.env` file is excluded from git via `.gitignore`
- Never commit your API keys
- No data is stored - all analysis is done in memory
- Images are processed in memory and not saved to disk

## Tech Stack

- Node.js + Express
- Vanilla JavaScript (no frameworks)
- OpenRouter API (Claude 3.5 Sonnet with vision)
- Multer for file uploads

## License

MIT

## Disclaimer

This tool is for educational and informational purposes only. Not financial advice. Always do your own research before making trading decisions.
