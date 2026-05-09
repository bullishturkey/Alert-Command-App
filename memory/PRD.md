# Alerts Command - Product Requirements Document

## Overview
Alerts Command is a mobile-first trading intelligence platform designed for a trading community focused on NDX and major Nasdaq-100 stocks. It replaces the current workflow (Discord alerts → Pipedream automation) into a single streamlined app with a native Discord bot, AI market sentiment, and color-coded trade alerts.

## Completed Features

### Core Platform (v1.0)
- ✅ JWT Authentication (Login/Register/Logout)
- ✅ Real-time Dashboard with live NDX quotes (yfinance, 5s refresh)
- ✅ 10 Nasdaq-100 stock tracking via Finnhub API
- ✅ Community-driven trade alerts via Discord bot integration
- ✅ Preflight Tab (Economic Calendar + Earnings + Breaking News)
- ✅ Admin Panel for user management, broadcast alerts, Discord status
- ✅ Custom NDX logo integration across app

### UI/UX (v2.0 - Webull-Inspired Redesign)
- ✅ Complete UI overhaul with Webull-style Mint Green / Rose Red palette
- ✅ Premium dark theme with subtle borders and surfaces
- ✅ Shared design system (/theme/index.ts) for consistency
- ✅ Intraday price bars replacing removed chart navigation
- ✅ GuestGate component for unauthenticated access blocking

### Discord Bot Integration (v2.1)
- ✅ `discord.py` bot running as background asyncio task in FastAPI
- ✅ Emoji-based color detection (bullish/bearish/signal)
- ✅ WINNER/LOSER/BUY/SELL/LONG/SHORT keyword fallback detection
- ✅ Webhook endpoint uses same `_detect_discord_type()` for consistent color tagging
- ✅ Admin reclassify-alerts endpoint for retroactive color fixes
- ✅ `DISCORD_BOT_ENABLED` env toggle for multi-replica deployments

### AI Intelligence (v2.2)
- ✅ Claude AI (emergentintegrations) live market sentiment
- ✅ Weekend weekly recap mode (Saturdays/Sundays)
- ✅ After-hours daily recap mode (weekdays after 4 PM ET)
- ✅ Admin force-refresh routes correctly by market state (weekend/after_hours/live)
- ✅ Pre-warm caches AI results in correct cache based on market state
- ✅ Deferred 90s pre-warm to prevent OOM on 512MB K8s pods

### Performance & Deployment (v2.3)
- ✅ Stale-while-revalidate caching pattern (yfinance, Finnhub, Claude)
- ✅ /health + /api/health endpoints for K8s readiness probes
- ✅ MongoDB Atlas support for production deployments
- ✅ EAS build configured (buildNumber: "3")

### App Store Compliance (v2.4)
- ✅ /support page (static) for App Store Connect reviewers
- ✅ Login screen cleaned up (no subtitle, no server selector)

### Login & Session UX (v3.2 - May 2026)
- ✅ **Stay Logged In** — "Stay logged in for 90 days" checkbox on login screen (checked by default). When checked, backend issues a 90-day JWT; unchecked = 7-day JWT.
- ✅ **AppState foreground refresh** — `useAppForeground` hook silently refreshes Markets, Alerts, and Preflight data when app is brought back to foreground (no full reload needed).
- ✅ **Daily auto-reclassify** — `_daily_ndx_scheduler` asyncio task runs NDX close price reclassification at 1:00 PM Pacific Time daily (pytz DST-aware).

## Bug Fixes
- ✅ Preflight timezone conversion (UTC → local time display)
- ✅ MA indicators hardcoded to 7MA (green) + 21MA (red)
- ✅ Economic calendar UTC conversion fixed
- ✅ Alert type always 'signal' bug fixed in webhook endpoint
- ✅ Admin refresh-sentiment routing by market state fixed
- ✅ Pre-warm not storing AI results bug fixed
- ✅ On-device persistent cache layer (`utils/deviceCache.ts`) — stale-while-revalidate with AsyncStorage
- ✅ App version 3.2.2 / iOS buildNumber 4
- ✅ Historical alert reclassification by NDX daily close (`/api/admin/reclassify-by-ndx-close`) — 361/374 alerts updated

## Technical Architecture
- **Frontend**: React Native (Expo) + Expo Router
- **Backend**: FastAPI (Python) 2,700+ line server.py
- **Database**: MongoDB Atlas (production) / local MongoDB (dev)
- **AI**: Claude via emergentintegrations library
- **Market Data**: Finnhub API + yfinance

## Backlog / Upcoming
- P2: Add "Last Updated" timestamp on Weekly/Daily Recap cards
- P2: Replace yfinance with Finnhub/Polygon.io for strict commercial licensing
- P2: Broker API Integrations (Charles Schwab, Alpaca, Interactive Brokers)
- P3: Conversational AI Trading Assistant
- P3: Refactor server.py into modular routers (/routers/auth.py, /routers/market.py, /routers/admin.py)
- ✅ Loading screen black background (no white flash)
- ✅ Volume display removed (Finnhub free tier limitation)

## In Progress

### Video Hosting / Teaching Videos
- Design database schema and endpoints for video content
- Frontend UI for subscribers to watch educational content

### AI Agent (News Sentiment & NDX Trends)
- Claude integration via Emergent LLM key
- Analyze Finnhub news for AI-powered sentiment summaries
- NDX suggested trends analysis in Preflight area

## Future Tasks (Backlog)
- Push Notifications (Firebase Cloud Messaging)
- Broker API Integrations (Schwab, Alpaca, IBKR)
- Conversational AI Trading Assistant
- Admin Chat Announcements / Broadcasting

## Technical Stack
- **Frontend**: React Native (Expo) + Expo Router
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Market Data**: Finnhub API + yfinance (NDX)
- **Charts**: TradingView Lightweight Charts
