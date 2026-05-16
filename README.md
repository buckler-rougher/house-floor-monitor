# Dome Watch Monitor

A real-time vote tracking and projection dashboard with a Pentagon Pizza Tracker / monitoring theme.

## Features

- **Live Vote Tally**: Displays current vote counts for each resolution/candidate
- **Projections**: Shows projected outcomes with confidence levels
- **Number to Win**: Calculates how many votes each party needs to reach majority
- **Real-time Updates**: Auto-refreshes every 30 seconds
- **Server-Side RSS Processing**: Uses Cloudflare Worker to handle RSS feeds without CORS issues

## Cloudflare Worker Setup

This application uses a Cloudflare Worker to handle RSS feed processing server-side, eliminating CORS issues and proxy dependencies.

### Files Created

1. **`worker.js`** - Cloudflare Worker that fetches and processes RSS feeds
2. **`wrangler.toml`** - Cloudflare Worker configuration
3. **`package.json`** - Dependencies and deployment scripts

### Deployment Steps

1. **Install Wrangler CLI**:
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Update Configuration**:
   - Edit `wrangler.toml` and replace `your-subdomain` with your Cloudflare subdomain
   - Edit `app.js` and update worker URLs in `RSS_CONFIG.workerUrl` and `NEWS_CONFIG.workerUrl`

4. **Deploy Worker**:
   ```bash
   npm run deploy-worker
   ```

5. **Update Client URLs**:
   In `app.js`, update these lines with your deployed worker URL:
   ```javascript
   const RSS_CONFIG = {
       workerUrl: 'https://your-worker-subdomain.workers.dev/api/proceedings',
       refreshInterval: 120000
   };
   
   const NEWS_CONFIG = {
       workerUrl: 'https://your-worker-subdomain.workers.dev/api/news',
       refreshInterval: 300000
   };
   ```

### API Endpoints

- **`/api/proceedings`** - House floor proceedings with relative timestamps
- **`/api/news`** - Latest news from multiple RSS feeds  
- **`/api/health`** - Worker health status

### Benefits

1. **No CORS Issues**: Worker makes direct HTTP requests
2. **Better Performance**: Server-side caching reduces redundant requests
3. **Cleaner Client Code**: Simple JSON responses instead of complex XML parsing
4. **Reliability**: Robust error handling and retry logic
5. **Scalability**: Cloudflare's global edge network
- **System Log**: Tracks all data fetches and system events
- **Monitoring Theme**: Dark, tactical interface inspired by military command centers

## Setup

1. Open `index.html` in a web browser
2. The site will load with mock data by default

## Connecting to the Dome Watch API

To connect to the real Dome Watch API:

1. Obtain API credentials from https://domewatch.us/api/docs
2. Edit `app.js` and modify the `API_CONFIG` section:

```javascript
const API_CONFIG = {
    baseUrl: 'https://data.domewatch.us',
    fallbackMode: false, // Set to false to use real API
    refreshInterval: 30000
};
```

3. Add your API key in the `fetchData()` function:

```javascript
const response = await fetch(`${API_CONFIG.baseUrl}/votes`, {
    headers: {
        'Authorization': 'Bearer YOUR_API_KEY_HERE',
        'Content-Type': 'application/json'
    }
});
```

4. Customize the `processApiData()` function to match the actual API response format

## Customization

### Modify Mock Data
Edit the `MOCK_DATA` object in `app.js` to change the displayed vote counts and projections.

### Adjust Refresh Interval
Change `refreshInterval` in `API_CONFIG` (in milliseconds).

### Theme Colors
Modify CSS variables in `styles.css`:
- `--bg-primary`: Main background
- `--text-primary`: Main text color
- `--accent-green`: Success indicators
- `--accent-amber`: Warnings
- `--accent-red`: Errors

## API Response Format

The app expects data in this format (customize `processApiData()` to match your API):

```json
{
    "votes": [
        {
            "id": 1,
            "name": "Resolution A",
            "party": "democrat",
            "votes": 142,
            "total": 218,
            "percentage": 65.1
        }
    ],
    "projections": {
        "totalSeats": 218,
        "democratProjected": 145,
        "republicanProjected": 73,
        "independentProjected": 0,
        "confidence": 87
    },
    "numberToWin": {
        "majority": 109,
        "democratNeeded": 33,
        "republicanNeeded": 67
    }
}
```

## Browser Compatibility

Works in all modern browsers that support:
- ES6 JavaScript
- CSS Grid
- CSS Custom Properties (variables)

## License

MIT License - Feel free to modify and use as needed.
