const fs = require('fs');
const path = require('path');

// Create directory if it doesn't exist
const scriptsDir = path.dirname(__filename);
const rootDir = path.join(scriptsDir, '..');

// Check if .env file already exists
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  console.log('.env file already exists. Skipping creation.');
  process.exit(0);
}

// Default env content
const envContent = `PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
RATE_LIMIT=100
RATE_LIMIT_WINDOW_MS=900000
`;

// Write .env file
fs.writeFileSync(envPath, envContent);
console.log('.env file created successfully.'); 