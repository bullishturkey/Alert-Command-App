# NDX Command - Product Requirements Document

## Overview
NDX Command is a mobile-first trading intelligence platform designed for a trading community focused on NDX and major Nasdaq-100 stocks. It replaces the current workflow (Discord alerts → Pipedream automation) into a single streamlined app.

## Completed Features

### Core Platform (v1.0)
- ✅ JWT Authentication (Login/Register/Logout)
- ✅ Real-time Dashboard with live NDX quotes (yfinance, 5s refresh)
- ✅ 10 Nasdaq-100 stock tracking via Finnhub API
- ✅ Interactive candlestick charts with multiple timeframes (1m, 5m, 15m, 1H, 1D)
- ✅ TradingView → Pipedream webhook integration for trade alerts
- ✅ Community Chat with 5 themed channels
- ✅ Preflight Tab (Economic Calendar + Earnings + Breaking News)
- ✅ Admin Panel for user management and broadcast alerts
- ✅ Custom NDX logo integration across app

### UI/UX (v2.0 - openclaw.ai Inspired Redesign)
- ✅ Complete UI overhaul inspired by openclaw.ai aesthetic
- ✅ Green accent color (#00C805) throughout
- ✅ Premium dark theme with subtle borders and surfaces
- ✅ "⟩" section header prefix styling (openclaw.ai signature)
- ✅ Shared design system (/theme/index.ts) for consistency
- ✅ Glowing green borders on NDX hero card
- ✅ Pill-shaped badges and refined card designs
- ✅ Updated chart colors to match new palette

### Bug Fixes
- ✅ Preflight timezone conversion (UTC → local time display)
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
