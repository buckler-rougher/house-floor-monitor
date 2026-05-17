# House Floor Monitor

A comprehensive real-time monitoring dashboard for tracking U.S. House floor proceedings, live votes, and legislative activities with a tactical command-center interface.

## Features

### Live Vote Tracking
- **Real-time Vote Display**: Displays current vote counts (Yeas, Nays, Present) with percentages
- **Live Vote Tallies**: Integration with House Clerk's voting system
- **Threshold Analysis**: Calculates votes needed, remaining votes, and maximum possible outcomes
- **Vote History**: Auto-refreshes every 30 seconds for up-to-date information

### House Floor Monitoring
- **Session Status**: Real-time display of floor session status (voting, debate, recess, prayer, pledge, oath, etc.)
- **Mode Toggle**: Switch between different floor activity modes (Vote, Recess, Debate, Prayer, Pledge, Silence, Oath, Speaker Pro Tempore)
- **Floor Proceedings Feed**: Live legislative activity updates from House Clerk
- **Quorum Tracking**: Monitors member attendance and quorum requirements

### Chamber Visualization
- **Chamber Vote Map**: Circular seating visualization showing member votes by party
- **Party Breakdown**: Displays current party composition (Republicans, Democrats, Independents)
- **Balance of Power**: Shows majority control status and vacancy tracking
- **Absentee Tracking**: Identifies missing members from roll calls

### Legislative Information
- **Bill Calendar**: House voting calendar showing scheduled voting days
- **Bills This Week**: Current bills scheduled for debate and votes
- **Debate Information**: Committee assignments and bill details
- **Morning Prayer**: Daily chaplain information and prayer details
- **Speaker Pro Tempore**: Current speaker information and party affiliation

### Multi-Source Integration
- **Live Stream**: Embedded YouTube stream from US House Clerk
- **Live Floor Feed**: Direct video feed from House floor
- **Weather Integration**: Local and DC weather with Capitol camera feed
- **Time Zones**: Displays local time, Eastern (DC), and UTC
- **Airport Delays**: FAA national airspace system status

### System Features
- **Cloudflare Worker Integration**: Server-side RSS feed processing to eliminate CORS issues
- **Multiple Data Sources**: Aggregates data from House Clerk, Congress.gov, FAA, and News feeds
- **Dark Tactical Interface**: Military command center-inspired design
- **System Logs**: Tracks all data fetches and system events
- **Responsive Design**: Works on desktop and mobile browsers

## Technical Stack

- **Frontend**: HTML5, CSS3 (27.1%), JavaScript (59.3%)
- **CSS Features**: CSS Grid, CSS Custom Properties, Flexbox layouts
- **Video**: HLS.js for live stream playback
- **Calendar**: FullCalendar library for voting calendar display
- **Backend**: Cloudflare Workers for server-side processing
- **CDN**: Cloudflare for edge network deployment

## Quick Start

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/buckler-rougher/house-floor-monitor.git
   cd house-floor-monitor
   ```

2. Open in browser:
   ```bash
   # Simple file opening
   open index.html
   
   # Or using a local server
   npm run dev
   ```

3. The site loads with live data by default and will display current House floor activity

## Configuration

### Cloudflare Worker Setup

The application uses a Cloudflare Worker to handle RSS feed processing server-side, eliminating CORS issues.

#### Deployment Steps

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
   - Edit `app.js` and update worker URLs in `RSS_CONFIG` and `NEWS_CONFIG`

4. **Deploy Worker**:
   ```bash
   npm run deploy-worker
   ```

5. **Update Client URLs**:
   In `app.js`, update these configuration sections:
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

### Customization

#### Modify Refresh Intervals
Edit configuration objects in `app.js`:
```javascript
API_CONFIG.refreshInterval = 30000; // milliseconds
```

#### Adjust Theme Colors
Modify CSS variables in `styles.css`:
```css
--bg-primary: Main background color
--bg-secondary: Secondary background
--text-primary: Main text color
--text-secondary: Secondary text
--accent-green: Success indicators
--accent-amber: Warnings
--accent-red: Errors
--party-dem: Democratic party color
--party-rep: Republican party color
```

## Data Sources

### House Proceedings
- [House Clerk - Roll Call Votes](https://clerk.house.gov/evs)
- [Dome Watch - Live Vote Tallies](https://domewatch.us)
- [House Clerk - Member Data](https://clerk.house.gov/xml/lists/MemberData.xml)
- [House Docs - Bills This Week](https://docs.house.gov/BillsThisWeek-RSS.xml)
- [House Voting Days Calendar](https://www.house.gov/voting-days)
- [House Live Floor Feed](https://live.house.gov)
- [Legislative Activity](https://clerk.house.gov/FloorSummary)
- [Congress.gov API](https://api.congress.gov)

### Weather & Location
- [National Weather Service](https://weather.gov)
- [Capitol Camera Feed](https://www.senate.gov/general/capcam.htm)
- [FAA National Airspace System Status](https://nasstatus.faa.gov)

### News
- [Roll Call - Congress RSS](https://rollcall.com/section/congress/rss)
- [Politico Congress RSS](https://www.politico.com/rss/congress.xml)
- [Jake Sherman (@JakeSherman) via Nitter](https://x.com/jakesherman)

## Browser Compatibility

Works in all modern browsers that support:
- ES6+ JavaScript
- CSS Grid and Flexbox
- CSS Custom Properties
- HTML5 Video elements
- Fetch API

Tested on:
- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## File Structure

```
house-floor-monitor/
├── index.html           # Main HTML structure
├── app.js              # Core JavaScript application logic
├── styles.css          # Comprehensive styling and layouts
├── worker.js           # Cloudflare Worker for server-side processing
├── wrangler.toml       # Cloudflare Worker configuration
├── package.json        # Dependencies and scripts
├── cors-proxy.js       # CORS proxy utility
├── proxy.html          # Proxy endpoint handler
└── README.md           # This file
```

## Development

### Local Development Server

```bash
npm run dev
```

This starts a local server on port 8080 for development and testing.

### Deploy Worker

```bash
npm run deploy-worker
```

Deploys the Cloudflare Worker for production RSS feed processing.

## License

MIT License - Feel free to modify and use as needed.

## Contributing

This project tracks live House floor activity. Contributions, suggestions, and improvements are welcome. Feel free to open issues or submit pull requests.

## Disclaimer

This is an independent project and is not affiliated with the U.S. House of Representatives. All data is sourced from public APIs and feeds. For official information, please visit [house.gov](https://www.house.gov/).
