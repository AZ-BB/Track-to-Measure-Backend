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
SECRET=your_jwt_secret_key_here

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALLBACK_URL=http://localhost:3001/api/user/auth/google/callback
```

4. Run database migration to support Google authentication:
```
npm run migrate:google-auth
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

### Authentication Endpoints

#### Sign Up (Create User)
```
POST /api/user/signup

Request body:
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword"
}

Response:
{
  "status": true,
  "message": "User created successfully",
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

#### Login
```
POST /api/user/login

Request body:
{
  "email": "john@example.com",
  "password": "securepassword"
}

Response:
{
  "status": true,
  "message": "User logged in successfully",
  "data": {
    "token": "jwt_token_here",
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

#### Google Sign-In
```
GET /api/user/auth/google

Redirects to Google OAuth consent screen
```

#### Google Sign-In Callback
```
GET /api/user/auth/google/callback

Response:
{
  "status": true,
  "message": "User authenticated with Google successfully",
  "data": {
    "token": "jwt_token_here",
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### Setting Up Google OAuth

1. Go to the [Google Developer Console](https://console.developers.google.com/)
2. Create a new project or select an existing one
3. Navigate to "Credentials" and click "Create Credentials" > "OAuth client ID"
4. Select "Web application" as the application type
5. Add authorized redirect URIs, including:
   - `http://localhost:3001/api/user/auth/google/callback` (for development)
   - Your production callback URL
6. Copy the Client ID and Client Secret and add them to your `.env` file

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