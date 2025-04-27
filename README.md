# TrackToMeasure Backend

This is the backend API for the TrackToMeasure application, a marketing tag detection tool.

## Features

- URL scanning for marketing tags (GTM, GA4, Meta Pixel, etc.)
- PDF report generation
- CMS detection

## Tech Stack

- Node.js
- Express
- TypeScript
- Puppeteer (for headless browser tag detection)
- PDFKit (for PDF report generation)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository
```
git clone [repository-url]
cd track-to-measure-backend
```

2. Install dependencies
```
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
RATE_LIMIT=100
RATE_LIMIT_WINDOW_MS=900000
```

### Development

Run the development server:
```
npm run dev
```

The API will be available at: `http://localhost:3001`

### Building for Production

Build the TypeScript project:
```
npm run build
```

Start the production server:
```
npm start
```

## API Documentation

### Scan Endpoints

#### Scan a URL
```
POST /api/scan

Request body:
{
  "url": "https://example.com",
  "includeCmsDetection": true
}

Response:
{
  "status": "success",
  "data": {
    "url": "https://example.com",
    "domain": "example.com",
    "scanTime": "2023-04-27T12:00:00.000Z",
    "tags": [
      {
        "name": "Google Tag Manager",
        "isPresent": true,
        "id": "GTM-XXXX"
      },
      ...
    ],
    "cms": "WordPress",
    "recommendations": [
      "Add Meta Pixel to track conversions from Facebook and Instagram ads",
      ...
    ]
  }
}
```

### Report Endpoints

#### Generate PDF Report
```
POST /api/report/generate

Request body:
{
  "url": "https://example.com",
  "options": {
    "includeRecommendations": true,
    "includeCmsInfo": true,
    "includeHeader": true,
    "colorScheme": "default"
  }
}

Response: PDF file download
```

## License

This project is licensed under the ISC License. 