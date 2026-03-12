# NDX Command - Trading Intelligence Platform

## Product Requirements Document (PRD)

### Overview
NDX Command is a mobile-first trading intelligence platform built for a trading community focused on NDX (Nasdaq 100) and major Nasdaq-100 stocks. It replaces the workflow of Discord alerts → Pipedream automation → TradingView console → manual notifications.

### Tech Stack
- **Frontend**: React Native (Expo SDK 54) with Expo Router
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Charts**: TradingView Lightweight Charts (via WebView/iframe)
- **Market Data**: Finnhub API (free tier) with mock data fallback
- **Auth**: JWT-based authentication

### Phase 1 — MVP Features (Implemented)

#### 1. Authentication
- JWT-based login/register
- Admin user seeded: `admin@ndxcommand.com` / `admin123`
- Token persisted with AsyncStorage
- Auth guard on protected routes

#### 2. Real-Time Market Dashboard
- **Tracked tickers**: NDX, QQQ, NVDA, MSFT, AAPL, AMZN, META, TSLA, AMD, AVGO, GOOGL
- Shows: live price, % change, volume, sentiment
- Market sentiment indicator (Bullish/Bearish/Mixed)
- Pull-to-refresh, auto-refresh every 30 seconds
- Tap stock card → navigates to detailed stock view

#### 3. Live Charting
- Full chart view using TradingView Lightweight Charts
- Symbol picker for all tracked stocks
- Timeframes: 1m, 5m, 15m, 1H, 1D
- Candlestick chart with volume histogram
- Indicator labels: VWAP, RSI, MA 20, MA 50

#### 4. Alert System
- In-app alert feed with color-coded types (bullish/bearish/neutral/info)
- Severity indicators (high/medium/low)
- Admin can create alerts from admin panel
- TradingView webhook endpoint: `POST /api/alerts/webhook`
- Seeded sample alerts for demo

#### 5. Breaking Market News Feed
- News articles with sentiment analysis (bullish/bearish/neutral)
- Category filters: All, Macro, Tech, Earnings, Market
- Source attribution, ticker tags, timestamps
- Finnhub API integration with mock data fallback

#### 6. Community Messaging
- 5 channels: General Market Chat, NDX Alerts, Trade Ideas, Macro News, Admin Announcements
- Real-time messaging with polling (5s interval)
- User avatars and timestamps
- Own messages aligned right (blue), others left

#### 7. Admin Panel
- Dashboard stats (users, alerts, messages)
- Create and broadcast alerts
- User management (view all users)
- Admin-only access (shield icon on dashboard)

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Get current user |
| GET | /api/market/quotes | Get all stock quotes |
| GET | /api/market/quote/{symbol} | Get single quote |
| GET | /api/market/candles/{symbol} | Get candle data |
| GET | /api/news | Get market news |
| GET | /api/alerts | Get all alerts |
| POST | /api/alerts | Create alert (admin) |
| POST | /api/alerts/webhook | Webhook alert |
| GET | /api/chat/channels | List channels |
| GET | /api/chat/messages/{id} | Get messages |
| POST | /api/chat/messages/{id} | Send message |
| GET | /api/admin/stats | Admin stats |
| GET | /api/admin/users | List users |
| POST | /api/admin/broadcast | Broadcast alert |

### Phase 2 — Trading Integration (Architecture Ready)
- Broker API integration: Charles Schwab, Alpaca, Interactive Brokers
- Trade execution: options spreads, calls, puts, shares
- OAuth broker authentication
- Encrypted account tokens

### Phase 3 — AI Trading Assistant (Future)
- Conversational AI (Claude integration planned)
- Natural language trade execution
- Position monitoring and exit suggestions
- Risk profile analysis

### Data Sources
- **Market Data**: Mock data by default (realistic simulation). Set `FINNHUB_API_KEY` in backend .env for real data.
- **News**: Mock curated news. Set `FINNHUB_API_KEY` for real news.

### Environment Variables
**Backend (.env)**:
- `MONGO_URL` - MongoDB connection
- `JWT_SECRET` - JWT signing secret
- `FINNHUB_API_KEY` - Optional: Finnhub free API key

### Design
- Dark mode default
- Robinhood/TradingView inspired UI
- Green (#00C805) for bullish, Red (#FF5000) for bearish
- 5-tab navigation: Markets, Charts, Alerts, News, Chat
