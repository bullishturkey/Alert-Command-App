"""Alerts Command - Trading Intelligence Platform Backend"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Body, Query
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import jwt as pyjwt
import bcrypt
import httpx
import random
import math
import json
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# === CONFIG ===
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'ndx_command')
FINNHUB_KEY = os.environ.get('FINNHUB_API_KEY', '')
FMP_KEY = os.environ.get('FMP_API_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'alerts-command-jwt-secret-2026-secure')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# === APP SETUP ===
app = FastAPI(title="Alerts Command API")
api_router = APIRouter(prefix="/api")


# === KUBERNETES HEALTH PROBES ===
# Both `/health` and `/api/health` are kept lightweight and never touch DB or Discord state.
# They MUST return instantly so nginx/k8s readiness probes don't kill the container.
@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/health")
async def api_health_check():
    return {"status": "ok"}
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[db_name]
_executor = ThreadPoolExecutor(max_workers=1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# === PYDANTIC MODELS ===
class UserRegister(BaseModel):
    email: str
    username: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class AlertCreate(BaseModel):
    title: str
    message: str
    type: str = "info"
    ticker: str = ""
    severity: str = "medium"

class MessageCreate(BaseModel):
    content: str

# === TRACKED SYMBOLS ===
TRACKED_SYMBOLS = {
    'NDX': {'name': 'Nasdaq 100 Index', 'base_price': 21500, 'sector': 'Index'},
    'QQQ': {'name': 'Invesco QQQ Trust', 'base_price': 520, 'sector': 'ETF'},
    'NVDA': {'name': 'NVIDIA Corp', 'base_price': 145, 'sector': 'Semiconductors'},
    'MSFT': {'name': 'Microsoft Corp', 'base_price': 435, 'sector': 'Software'},
    'AAPL': {'name': 'Apple Inc', 'base_price': 198, 'sector': 'Consumer Electronics'},
    'AMZN': {'name': 'Amazon.com Inc', 'base_price': 195, 'sector': 'E-Commerce'},
    'META': {'name': 'Meta Platforms', 'base_price': 525, 'sector': 'Social Media'},
    'TSLA': {'name': 'Tesla Inc', 'base_price': 265, 'sector': 'Electric Vehicles'},
    'AMD': {'name': 'Advanced Micro Devices', 'base_price': 175, 'sector': 'Semiconductors'},
    'AVGO': {'name': 'Broadcom Inc', 'base_price': 175, 'sector': 'Semiconductors'},
    'GOOGL': {'name': 'Alphabet Inc', 'base_price': 178, 'sector': 'Internet Services'},
}

# === MEGA-CAP EARNINGS WATCHLIST ===
# Companies with ~$600B+ market cap (as of Feb 2026). Updated periodically.
# Used for /api/preflight earnings calendar filtering — want every mega-cap print on radar.
# Includes a buffer for borderline $500-600B names since caps fluctuate day-to-day.
MEGA_CAP_EARNINGS_SYMBOLS = {
    # $1T+ club
    'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO',
    'BRK.A', 'BRK.B', 'BRK-A', 'BRK-B',  # Berkshire Hathaway (class A & B, multiple symbol formats)
    # $600B-$1T
    'TSM',    # Taiwan Semiconductor
    'LLY',    # Eli Lilly
    'JPM',    # JPMorgan Chase
    'WMT',    # Walmart
    'V',      # Visa
    'ORCL',   # Oracle
    # Borderline $500-600B (included for safety — mega-caps bounce around this threshold)
    'XOM',    # Exxon Mobil
    'MA',     # Mastercard
    'UNH',    # UnitedHealth
    'COST',   # Costco
    'HD',     # Home Depot
    'NFLX',   # Netflix (AI/streaming giant, borderline)
    'PG',     # Procter & Gamble
    'JNJ',    # Johnson & Johnson
    'BAC',    # Bank of America
    # Tech mega-caps the user will want on earnings radar
    'AMD',    # Advanced Micro Devices
    'CRM',    # Salesforce
    'ADBE',   # Adobe
    'QCOM',   # Qualcomm
    'INTC',   # Intel
    'CSCO',   # Cisco
    'IBM',    # IBM
}

# === IN-MEMORY CACHE ===
_quote_cache: Dict[str, Any] = {}
_quote_cache_time: float = 0
CACHE_TTL = 30
_ndx_cache: Dict[str, Any] = {}
_ndx_cache_time: float = 0
NDX_CACHE_TTL = 5

# === AUTH HELPERS ===
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, is_admin: bool) -> str:
    payload = {
        'sub': user_id,
        'is_admin': is_admin,
        'exp': datetime.now(timezone.utc) + timedelta(days=7)
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm='HS256')

async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Not authenticated')
    token = authorization.split(' ')[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user = await db.users.find_one({'id': payload['sub']}, {'_id': 0, 'password_hash': 0})
        if not user:
            raise HTTPException(status_code=401, detail='User not found')
        if user.get('is_revoked'):
            raise HTTPException(status_code=403, detail='Account access has been revoked')
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')

async def get_optional_user(authorization: str = Header(None)):
    """Returns user if authenticated, None if guest"""
    if not authorization or not authorization.startswith('Bearer '):
        return None
    token = authorization.split(' ')[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        user = await db.users.find_one({'id': payload['sub']}, {'_id': 0, 'password_hash': 0})
        if user and user.get('is_revoked'):
            return None
        return user
    except Exception:
        return None

async def get_admin_user(user=Depends(get_current_user)):
    if not user.get('is_admin'):
        raise HTTPException(status_code=403, detail='Admin access required')
    return user

# === YFINANCE NDX FETCHER ===
def _fetch_ndx_yfinance() -> Optional[dict]:
    """Fetch live NDX quote using yfinance (runs in thread pool)"""
    try:
        import yfinance as yf
        ticker = yf.Ticker('^NDX')
        info = ticker.fast_info
        price = info.last_price
        prev_close = info.previous_close
        change = round(price - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return {
            'symbol': 'NDX',
            'name': 'Nasdaq 100 Index',
            'sector': 'Index',
            'price': round(price, 2),
            'change': change,
            'changePercent': change_pct,
            'volume': int(getattr(info, 'last_volume', 0) or 0),
            'previousClose': round(prev_close, 2),
            'high': round(info.day_high, 2),
            'low': round(info.day_low, 2),
            'open': round(info.open, 2),
            'sentiment': 'bullish' if change > 0 else ('bearish' if change < 0 else 'neutral'),
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.warning(f"yfinance NDX error: {e}")
        return None

async def fetch_ndx_quote() -> Optional[dict]:
    """Async wrapper for yfinance NDX fetch"""
    global _ndx_cache, _ndx_cache_time
    import time
    now = time.time()
    if now - _ndx_cache_time < NDX_CACHE_TTL and _ndx_cache:
        return _ndx_cache
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _fetch_ndx_yfinance)
    if result:
        _ndx_cache = result
        _ndx_cache_time = now
    return result

def _fetch_ndx_candles_yf(resolution: str, count: int) -> Optional[dict]:
    """Fetch NDX candle data via yfinance"""
    try:
        import yfinance as yf
        ticker = yf.Ticker('^NDX')
        interval_map = {'1': '1m', '5': '5m', '15': '15m', '60': '1h', 'D': '1d'}
        period_map = {'1': '1d', '5': '5d', '15': '5d', '60': '1mo', 'D': '6mo'}
        interval = interval_map.get(resolution, '1d')
        period = period_map.get(resolution, '6mo')
        hist = ticker.history(period=period, interval=interval)
        if hist.empty:
            return None
        hist = hist.tail(count)
        return {
            't': [int(ts.timestamp()) for ts in hist.index],
            'o': [round(v, 2) for v in hist['Open'].tolist()],
            'h': [round(v, 2) for v in hist['High'].tolist()],
            'l': [round(v, 2) for v in hist['Low'].tolist()],
            'c': [round(v, 2) for v in hist['Close'].tolist()],
            'v': [int(v) for v in hist['Volume'].tolist()],
            's': 'ok'
        }
    except Exception as e:
        logger.warning(f"yfinance NDX candles error: {e}")
        return None

async def fetch_ndx_candles(resolution: str = 'D', count: int = 100) -> Optional[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _fetch_ndx_candles_yf, resolution, count)

# === MOCK DATA GENERATORS ===
def generate_mock_quote(symbol: str) -> dict:
    info = TRACKED_SYMBOLS.get(symbol, {'name': symbol, 'base_price': 100, 'sector': 'Unknown'})
    base = info['base_price']
    change_pct = random.uniform(-3.5, 3.5)
    price = round(base * (1 + change_pct / 100), 2)
    change = round(price - base, 2)
    volume = random.randint(10_000_000, 80_000_000)
    sentiment = 'bullish' if change_pct > 1 else ('bearish' if change_pct < -1 else 'neutral')
    return {
        'symbol': symbol,
        'name': info['name'],
        'sector': info['sector'],
        'price': price,
        'change': change,
        'changePercent': round(change_pct, 2),
        'volume': volume,
        'previousClose': base,
        'high': round(price * 1.012, 2),
        'low': round(price * 0.988, 2),
        'open': round(base + random.uniform(-2, 2), 2),
        'sentiment': sentiment,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }

def generate_mock_candles(symbol: str, resolution: str = 'D', count: int = 100) -> dict:
    info = TRACKED_SYMBOLS.get(symbol, {'name': symbol, 'base_price': 100, 'sector': ''})
    base = info['base_price']
    intervals = {'1': 1, '5': 5, '15': 15, '60': 60, 'D': 1440}
    interval_min = intervals.get(resolution, 1440)
    now = datetime.now(timezone.utc)
    t, o, h, lo, c, v = [], [], [], [], [], []
    price = base * 0.95
    for i in range(count):
        ts = now - timedelta(minutes=interval_min * (count - i))
        t.append(int(ts.timestamp()))
        op = round(price, 2)
        cl = round(op + random.gauss(0, base * 0.006), 2)
        hi = round(max(op, cl) + abs(random.gauss(0, base * 0.003)), 2)
        low = round(min(op, cl) - abs(random.gauss(0, base * 0.003)), 2)
        vol = random.randint(500_000, 30_000_000)
        o.append(op)
        h.append(hi)
        lo.append(low)
        c.append(cl)
        v.append(vol)
        price = cl
    return {'t': t, 'o': o, 'h': h, 'l': lo, 'c': c, 'v': v, 's': 'ok'}

def generate_mock_sparkline(symbol: str) -> list:
    info = TRACKED_SYMBOLS.get(symbol, {'base_price': 100})
    base = info['base_price']
    price = base * 0.98
    points = []
    for _ in range(20):
        price += random.gauss(0, base * 0.003)
        points.append(round(price, 2))
    return points

MOCK_NEWS = [
    {'headline': 'NVIDIA Surges on Record AI Chip Demand Forecast', 'source': 'Reuters', 'summary': 'NVIDIA shares jumped 5% after the company raised its AI chip demand forecast, signaling continued strength in data center GPU sales.', 'sentiment': 'bullish', 'tickers': ['NVDA'], 'category': 'tech'},
    {'headline': 'Fed Signals Potential Rate Cut in Coming Months', 'source': 'Bloomberg', 'summary': 'Federal Reserve officials indicated openness to cutting interest rates, boosting tech sector sentiment across Nasdaq.', 'sentiment': 'bullish', 'tickers': ['NDX', 'QQQ'], 'category': 'macro'},
    {'headline': 'Apple Unveils Next-Gen AI Features at Developer Conference', 'source': 'CNBC', 'summary': 'Apple announced sweeping AI integration across its product line, driving renewed investor optimism.', 'sentiment': 'bullish', 'tickers': ['AAPL'], 'category': 'tech'},
    {'headline': 'CPI Data Shows Inflation Cooling to 2.4%', 'source': 'WSJ', 'summary': 'Consumer Price Index came in below expectations at 2.4%, reinforcing rate cut expectations.', 'sentiment': 'bullish', 'tickers': ['NDX', 'QQQ'], 'category': 'macro'},
    {'headline': 'Tesla Faces Margin Pressure Amid Price War', 'source': 'Financial Times', 'summary': 'Tesla margins compressed for the third straight quarter as aggressive price cuts impact profitability.', 'sentiment': 'bearish', 'tickers': ['TSLA'], 'category': 'earnings'},
    {'headline': 'Microsoft Azure Revenue Beats Expectations by 12%', 'source': 'Bloomberg', 'summary': 'Microsoft reported cloud revenue significantly above analyst estimates, powered by AI workload adoption.', 'sentiment': 'bullish', 'tickers': ['MSFT'], 'category': 'earnings'},
    {'headline': 'Oil Prices Spike on Middle East Supply Concerns', 'source': 'Reuters', 'summary': 'Crude oil surged 4% on renewed geopolitical tensions, raising concerns about broader market impact.', 'sentiment': 'bearish', 'tickers': ['NDX'], 'category': 'macro'},
    {'headline': 'AMD Gains Market Share in Server CPU Segment', 'source': 'TechCrunch', 'summary': 'AMD continues to chip away at Intel server market share with its latest EPYC processors.', 'sentiment': 'bullish', 'tickers': ['AMD'], 'category': 'tech'},
    {'headline': 'Meta Revenue Surges 25% on Ad Platform Improvements', 'source': 'CNBC', 'summary': 'Meta Platforms reported strong quarterly earnings driven by AI-enhanced advertising targeting.', 'sentiment': 'bullish', 'tickers': ['META'], 'category': 'earnings'},
    {'headline': 'Amazon Web Services Launches New AI Infrastructure', 'source': 'AWS Blog', 'summary': 'AWS announced new custom AI chips and infrastructure services, intensifying cloud competition.', 'sentiment': 'bullish', 'tickers': ['AMZN'], 'category': 'tech'},
    {'headline': 'Broadcom Raises Dividend After Strong Q4 Results', 'source': 'MarketWatch', 'summary': 'Broadcom increased quarterly dividend by 15% following better-than-expected earnings.', 'sentiment': 'bullish', 'tickers': ['AVGO'], 'category': 'earnings'},
    {'headline': 'Google Cloud AI Revenue Doubles Year-Over-Year', 'source': 'Bloomberg', 'summary': 'Alphabet reported that Google Cloud AI-related revenue doubled, driving overall cloud profitability.', 'sentiment': 'bullish', 'tickers': ['GOOGL'], 'category': 'earnings'},
    {'headline': 'PPI Data Comes in Hot, Rattling Bond Markets', 'source': 'WSJ', 'summary': 'Producer Price Index exceeded expectations, raising concerns about persistent wholesale inflation.', 'sentiment': 'bearish', 'tickers': ['NDX', 'QQQ'], 'category': 'macro'},
    {'headline': 'Nasdaq 100 Hits All-Time High on Tech Rally', 'source': 'Reuters', 'summary': 'The Nasdaq 100 index reached a new record as mega-cap tech stocks led a broad market rally.', 'sentiment': 'bullish', 'tickers': ['NDX', 'QQQ'], 'category': 'market'},
    {'headline': 'Treasury Yields Rise on Strong Jobs Report', 'source': 'Financial Times', 'summary': 'U.S. Treasury yields climbed after non-farm payrolls significantly exceeded consensus forecasts.', 'sentiment': 'bearish', 'tickers': ['NDX'], 'category': 'macro'},
]

# === FINNHUB API HELPERS ===
# Tiny in-memory quote cache — Finnhub free tier is 60 calls/min. 3s TTL means
# even with 20 symbols polled every 5s, we hit Finnhub <4 times per symbol per minute.
_QUOTE_CACHE: Dict[str, Dict[str, Any]] = {}
_QUOTE_CACHE_TTL = 3.0  # seconds

async def fetch_finnhub_quote(symbol: str) -> Optional[dict]:
    if not FINNHUB_KEY:
        return None
    # Cache hit?
    cached = _QUOTE_CACHE.get(symbol)
    now_ts = time.time()
    if cached and (now_ts - cached['ts']) < _QUOTE_CACHE_TTL:
        return cached['data']
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get('https://finnhub.io/api/v1/quote', params={'symbol': symbol, 'token': FINNHUB_KEY})
            if resp.status_code == 200:
                data = resp.json()
                if data.get('c', 0) > 0:
                    info = TRACKED_SYMBOLS.get(symbol, {'name': symbol, 'sector': ''})
                    out = {
                        'symbol': symbol,
                        'name': info.get('name', symbol),
                        'sector': info.get('sector', ''),
                        'price': data['c'],
                        'change': round(data['c'] - data['pc'], 2),
                        'changePercent': round(((data['c'] - data['pc']) / data['pc']) * 100, 2) if data['pc'] else 0,
                        'volume': data.get('v', 0),
                        'previousClose': data['pc'],
                        'high': data['h'],
                        'low': data['l'],
                        'open': data['o'],
                        'sentiment': 'bullish' if data['c'] > data['pc'] else 'bearish',
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    }
                    _QUOTE_CACHE[symbol] = {'ts': now_ts, 'data': out}
                    return out
    except Exception as e:
        logger.warning(f"Finnhub quote error for {symbol}: {e}")
        # Serve last cached value on transient error
        if cached:
            return cached['data']
    return None

async def fetch_finnhub_candles(symbol: str, resolution: str = 'D', count: int = 100) -> Optional[dict]:
    if not FINNHUB_KEY:
        return None
    try:
        now = int(datetime.now(timezone.utc).timestamp())
        intervals = {'1': 60, '5': 300, '15': 900, '60': 3600, 'D': 86400}
        from_ts = now - (intervals.get(resolution, 86400) * count)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/stock/candle', params={
                'symbol': symbol, 'resolution': resolution, 'from': from_ts, 'to': now, 'token': FINNHUB_KEY
            })
            if resp.status_code == 200:
                data = resp.json()
                if data.get('s') == 'ok':
                    return data
    except Exception as e:
        logger.warning(f"Finnhub candles error for {symbol}: {e}")
    return None

async def fetch_finnhub_news(category: str = 'general') -> Optional[list]:
    if not FINNHUB_KEY:
        return None
    # In-memory cache (5 min TTL) keyed by category
    global _FINNHUB_NEWS_CACHE
    now_ts = time.time()
    cached = _FINNHUB_NEWS_CACHE.get(category)
    if cached and (now_ts - cached['ts'] < _FINNHUB_NEWS_TTL):
        return cached['data']
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/news', params={'category': category, 'token': FINNHUB_KEY})
            if resp.status_code == 200:
                data = resp.json()
                _FINNHUB_NEWS_CACHE[category] = {'ts': now_ts, 'data': data}
                return data
    except Exception as e:
        logger.warning(f"Finnhub news error: {e}")
    # Fallback: serve stale if available
    if cached:
        return cached['data']
    return None

# In-memory cache for Finnhub general news (5 min TTL)
_FINNHUB_NEWS_CACHE: Dict[str, Dict[str, Any]] = {}
_FINNHUB_NEWS_TTL = 300

def simple_sentiment(text: str) -> str:
    text_lower = text.lower()
    bullish = ['surge', 'jump', 'rise', 'gain', 'beat', 'record', 'high', 'boost', 'rally', 'soar', 'growth', 'strong', 'bull', 'upgrade', 'positive', 'optimis']
    bearish = ['drop', 'fall', 'decline', 'loss', 'miss', 'low', 'crash', 'plunge', 'weak', 'bear', 'downgrade', 'negative', 'fear', 'risk', 'concern', 'pressure']
    b_score = sum(1 for w in bullish if w in text_lower)
    br_score = sum(1 for w in bearish if w in text_lower)
    if b_score > br_score:
        return 'bullish'
    elif br_score > b_score:
        return 'bearish'
    return 'neutral'

# =====================
# AUTH ENDPOINTS
# =====================
@api_router.post("/auth/register")
async def register(data: UserRegister):
    existing = await db.users.find_one({'email': data.email})
    if existing:
        raise HTTPException(status_code=400, detail='Email already registered')
    user_id = str(uuid.uuid4())
    user_doc = {
        'id': user_id,
        'email': data.email,
        'username': data.username,
        'password_hash': hash_password(data.password),
        'is_admin': False,
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, False)
    return {
        'token': token,
        'user': {'id': user_id, 'email': data.email, 'username': data.username, 'is_admin': False, 'created_at': user_doc['created_at']}
    }

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({'email': data.email}, {'_id': 0})
    if not user or not verify_password(data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid credentials')
    token = create_token(user['id'], user.get('is_admin', False))
    return {
        'token': token,
        'user': {'id': user['id'], 'email': user['email'], 'username': user['username'], 'is_admin': user.get('is_admin', False), 'created_at': user.get('created_at', '')}
    }

@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return {'user': user}

# =====================
# MARKET DATA ENDPOINTS
# =====================
@api_router.get("/market/ndx")
async def get_ndx_live(user=Depends(get_optional_user)):
    """Fast NDX-only endpoint with 5s cache - available to guests"""
    quote = await fetch_ndx_quote()
    if not quote:
        quote = generate_mock_quote('NDX')
    return quote

@api_router.get("/market/quotes")
async def get_all_quotes(user=Depends(get_optional_user)):
    global _quote_cache, _quote_cache_time
    import time
    now = time.time()
    if now - _quote_cache_time < CACHE_TTL and _quote_cache:
        return {'quotes': list(_quote_cache.values()), 'cached': True}
    quotes = []
    for symbol in TRACKED_SYMBOLS:
        if symbol == 'NDX':
            quote = await fetch_ndx_quote()
            if not quote:
                quote = generate_mock_quote(symbol)
        else:
            quote = await fetch_finnhub_quote(symbol)
            if not quote:
                quote = generate_mock_quote(symbol)
        quote['sparkline'] = generate_mock_sparkline(symbol)
        quotes.append(quote)
        _quote_cache[symbol] = quote
    _quote_cache_time = now
    return {'quotes': quotes, 'cached': False}

@api_router.get("/market/quote/{symbol}")
async def get_quote(symbol: str, user=Depends(get_optional_user)):
    symbol = symbol.upper()
    if symbol == 'NDX':
        quote = await fetch_ndx_quote()
    else:
        quote = await fetch_finnhub_quote(symbol)
    if not quote:
        quote = generate_mock_quote(symbol)
    quote['sparkline'] = generate_mock_sparkline(symbol)
    return quote

@api_router.get("/market/candles/{symbol}")
async def get_candles(symbol: str, resolution: str = "D", count: int = 100, user=Depends(get_optional_user)):
    symbol = symbol.upper()
    if symbol == 'NDX':
        candles = await fetch_ndx_candles(resolution, count)
        if candles:
            return candles
    else:
        candles = await fetch_finnhub_candles(symbol, resolution, count)
        if candles:
            return candles
    return generate_mock_candles(symbol, resolution, count)

# =====================
# NEWS ENDPOINTS
# =====================
@api_router.get("/news")
async def get_news(user=Depends(get_optional_user)):
    finnhub_news = await fetch_finnhub_news()
    if finnhub_news and len(finnhub_news) > 0:
        articles = []
        for item in finnhub_news[:20]:
            articles.append({
                'id': str(item.get('id', uuid.uuid4())),
                'headline': item.get('headline', ''),
                'source': item.get('source', 'Unknown'),
                'summary': item.get('summary', ''),
                'url': item.get('url', ''),
                'image': item.get('image', ''),
                'sentiment': simple_sentiment(item.get('headline', '') + ' ' + item.get('summary', '')),
                'tickers': [],
                'category': item.get('category', 'general'),
                'timestamp': datetime.fromtimestamp(item.get('datetime', 0), tz=timezone.utc).isoformat() if item.get('datetime') else datetime.now(timezone.utc).isoformat()
            })
        return {'articles': articles, 'source': 'finnhub'}
    # Fallback to mock
    articles = []
    now = datetime.now(timezone.utc)
    for i, news in enumerate(MOCK_NEWS):
        ts = now - timedelta(hours=random.randint(0, 24), minutes=random.randint(0, 59))
        articles.append({
            'id': str(uuid.uuid4()),
            'headline': news['headline'],
            'source': news['source'],
            'summary': news['summary'],
            'url': '',
            'image': '',
            'sentiment': news['sentiment'],
            'tickers': news['tickers'],
            'category': news['category'],
            'timestamp': ts.isoformat()
        })
    articles.sort(key=lambda x: x['timestamp'], reverse=True)
    return {'articles': articles, 'source': 'mock'}

# =====================
# PREFLIGHT ENDPOINT
# =====================
async def fetch_finnhub_earnings(from_date: str, to_date: str) -> list:
    if not FINNHUB_KEY:
        return []
    # Cache key is the date range; 30 min TTL
    global _FINNHUB_EARN_CACHE
    cache_key = f"{from_date}_{to_date}"
    now_ts = time.time()
    cached = _FINNHUB_EARN_CACHE.get(cache_key)
    if cached and (now_ts - cached['ts'] < _FINNHUB_EARN_TTL):
        return cached['data']
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/calendar/earnings', params={
                'from': from_date, 'to': to_date, 'token': FINNHUB_KEY
            })
            if resp.status_code == 200:
                data = resp.json()
                # Filter to mega-cap ($600B+) companies — the earnings that actually move the market
                filtered = [e for e in data.get('earningsCalendar', []) if e.get('symbol') in MEGA_CAP_EARNINGS_SYMBOLS]
                _FINNHUB_EARN_CACHE[cache_key] = {'ts': now_ts, 'data': filtered}
                return filtered
    except Exception as e:
        logger.warning(f"Finnhub earnings error: {e}")
    # Serve stale on failure
    if cached:
        return cached['data']
    return []

# In-memory cache for Finnhub earnings (30 min TTL)
_FINNHUB_EARN_CACHE: Dict[str, Dict[str, Any]] = {}
_FINNHUB_EARN_TTL = 1800

# In-memory cache for yfinance recent earnings (1 hour TTL)
_RECENT_EARN_CACHE: Dict[str, Any] = {'ts': 0, 'data': []}
_RECENT_EARN_TTL = 3600


def _fetch_recent_earnings_yf(days_back: int = 14) -> list:
    """Fetch RECENTLY REPORTED earnings for mega-cap symbols using yfinance.
    Finnhub's free-tier `/calendar/earnings` only returns future events — yfinance fills the gap.
    Runs in thread pool (yfinance is sync)."""
    import yfinance as _yf
    import pandas as _pd
    from datetime import datetime as _dt, timezone as _tz

    cutoff = _dt.now(_tz.utc) - timedelta(days=days_back)
    today = _dt.now(_tz.utc)
    results = []

    for sym in MEGA_CAP_EARNINGS_SYMBOLS:
        try:
            t = _yf.Ticker(sym)
            ed = t.earnings_dates
            if ed is None or ed.empty:
                continue
            # Index is tz-aware DatetimeIndex
            for ts, row in ed.iterrows():
                try:
                    ts_utc = ts.tz_convert('UTC') if hasattr(ts, 'tz_convert') and ts.tz is not None else ts
                    ts_naive = ts_utc.to_pydatetime().replace(tzinfo=_tz.utc) if ts_utc.tzinfo is None else ts_utc.to_pydatetime()
                except Exception:
                    continue
                # Keep only events from [cutoff, today] that have actuals
                if not (cutoff <= ts_naive <= today):
                    continue
                reported_eps = row.get('Reported EPS')
                if _pd.isna(reported_eps):
                    continue  # skip rows with no actuals yet
                est = row.get('EPS Estimate')
                results.append({
                    'symbol': sym,
                    'date': ts_naive.strftime('%Y-%m-%d'),
                    'hour': '',
                    'epsEstimate': float(est) if not _pd.isna(est) else None,
                    'revenueEstimate': None,  # yfinance doesn't surface rev in this frame
                    'epsActual': float(reported_eps),
                    'revenueActual': None,
                })
        except Exception as e:
            logger.debug(f"Recent earnings yf failed for {sym}: {e}")
            continue
    return results


async def _fetch_recent_earnings(days_back: int = 14) -> list:
    """Async wrapper — INSTANT response with stale-while-revalidate.
    NEVER blocks the request: if cache is empty, returns [] and triggers background fill.
    The Preflight endpoint never waits on yfinance scraping (22s+) on cold start."""
    now_ts = time.time()
    age = now_ts - _RECENT_EARN_CACHE['ts']
    cached = _RECENT_EARN_CACHE.get('data')
    has_cache = bool(cached)

    # Fresh cache — return instantly
    if age < _RECENT_EARN_TTL and has_cache:
        return cached

    loop = asyncio.get_event_loop()

    async def _refresh():
        try:
            data = await loop.run_in_executor(_executor, _fetch_recent_earnings_yf, days_back)
            _RECENT_EARN_CACHE['ts'] = time.time()
            _RECENT_EARN_CACHE['data'] = data
            logger.info(f"Recent earnings refreshed: {len(data)} rows cached for 1h")
        except Exception as e:
            logger.warning(f"Recent earnings background refresh failed: {e}")

    # Always refresh in the background — never block
    asyncio.create_task(_refresh())

    # Return whatever we have (cached, possibly stale, OR empty list on cold start)
    return cached or []


# In-memory cache for economic calendar (TTL: 30 min)
# Key: "YYYY-MM-DD_YYYY-MM-DD"  → { 'ts': epoch_seconds, 'data': [events] }
_ECON_CAL_CACHE: Dict[str, Dict[str, Any]] = {}
_ECON_CAL_TTL_SEC = 1800  # 30 minutes

async def fetch_finnhub_economic_calendar(from_date: str, to_date: str) -> list:
    """Fetch real economic calendar from Finnhub.
    Returns events with actual/forecast/previous values. Filters to US, medium+ impact.
    Cached in-memory for 30 minutes per date range to conserve API quota.
    """
    if not FINNHUB_KEY:
        return []
    # Check cache
    cache_key = f"{from_date}_{to_date}"
    now_ts = time.time()
    cached = _ECON_CAL_CACHE.get(cache_key)
    if cached and (now_ts - cached['ts'] < _ECON_CAL_TTL_SEC):
        age_min = int((now_ts - cached['ts']) / 60)
        logger.info(f"Econ calendar: CACHE HIT ({len(cached['data'])} events, age {age_min}m)")
        return cached['data']
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(
                'https://finnhub.io/api/v1/calendar/economic',
                params={'from': from_date, 'to': to_date, 'token': FINNHUB_KEY}
            )
            if resp.status_code != 200:
                logger.warning(f"Finnhub economic calendar HTTP {resp.status_code}: {resp.text[:200]}")
                if cached:
                    return cached['data']
                return []
            raw = resp.json().get('economicCalendar', [])
            if not isinstance(raw, list):
                if cached:
                    return cached['data']
                return []
            events = []
            for e in raw:
                country = (e.get('country') or '').upper()
                impact = (e.get('impact') or '').lower()
                # Only US events, medium or high impact (skip speeches with no data)
                if country != 'US':
                    continue
                if impact not in ('medium', 'high'):
                    continue
                raw_time = e.get('time', '')  # "2026-04-18 12:30:00"
                event_date = raw_time[:10] if raw_time else ''
                # Categorize for UI color coding
                name = (e.get('event') or '').lower()
                if 'fomc' in name or 'fed ' in name or 'federal funds' in name or 'powell' in name or 'interest rate' in name:
                    category = 'fed'
                elif 'cpi' in name or 'ppi' in name or 'pce' in name or 'inflation' in name or 'price index' in name:
                    category = 'inflation'
                elif 'payroll' in name or 'unemploy' in name or 'jobless' in name or 'adp' in name or 'employment' in name:
                    category = 'employment'
                elif 'gdp' in name:
                    category = 'gdp'
                elif 'retail' in name or 'consumer' in name:
                    category = 'consumer'
                elif 'manufacturing' in name or 'ism' in name or 'pmi' in name:
                    category = 'manufacturing'
                elif 'housing' in name or 'home' in name or 'mortgage' in name or 'building' in name:
                    category = 'housing'
                else:
                    category = 'economic'
                # Skip speeches unless they have actual data (usually noise)
                if 'speech' in name and e.get('actual') is None and e.get('estimate') is None:
                    continue
                actual = e.get('actual')
                estimate = e.get('estimate')
                prev = e.get('prev')
                events.append({
                    'event': e.get('event', '') or 'Economic Event',
                    'date': event_date,
                    'time_utc': raw_time,
                    'impact': impact,
                    'category': category,
                    'estimate': str(estimate) if estimate is not None else '',
                    'previous': str(prev) if prev is not None else '',
                    'actual': str(actual) if actual is not None else '',
                    'unit': e.get('unit', '') or '',
                    'description': f"{e.get('event', '')} — US"
                })
            events.sort(key=lambda x: (x.get('date', ''), x.get('time_utc', '')))
            _ECON_CAL_CACHE[cache_key] = {'ts': now_ts, 'data': events}
            logger.info(f"Econ calendar: FETCHED {len(events)} US events for {from_date} → {to_date} (cached 30m)")
            return events
    except Exception as e:
        logger.warning(f"Finnhub economic calendar error: {e}")
        if cached:
            return cached['data']
        return []

def get_economic_events_for_week(today: datetime) -> list:
    """Return known economic events for the current week"""
    from calendar import monthrange
    year = today.year
    month = today.month
    day = today.day
    weekday = today.weekday()  # 0=Mon
    week_start = today - timedelta(days=weekday)
    week_end = week_start + timedelta(days=6)

    events = []

    # FOMC 2026 meeting dates (2-day meetings, announcement on day 2)
    fomc_dates = [
        (1, 28, 29), (3, 18, 19), (5, 6, 7), (6, 17, 18),
        (7, 29, 30), (9, 16, 17), (11, 4, 5), (12, 16, 17),
    ]
    for m, d1, d2 in fomc_dates:
        meeting_date = datetime(year, m, d2, 18, 0, tzinfo=timezone.utc)  # 2 PM ET = 18:00 UTC (EDT)
        if week_start.date() <= meeting_date.date() <= week_end.date():
            events.append({
                'event': 'FOMC Interest Rate Decision',
                'date': meeting_date.strftime('%Y-%m-%d'),
                'time_utc': meeting_date.isoformat(),
                'impact': 'high',
                'category': 'fed',
                'estimate': '',
                'previous': '',
                'description': 'Federal Reserve interest rate decision and policy statement'
            })

    # CPI - typically released mid-month (around 12th-14th) at 8:30 AM ET = 12:30 UTC (EDT)
    cpi_day = 12 if monthrange(year, month)[1] >= 12 else 10
    cpi_date = datetime(year, month, cpi_day, 12, 30, tzinfo=timezone.utc)
    if week_start.date() <= cpi_date.date() <= week_end.date():
        events.append({
            'event': 'CPI (Consumer Price Index)',
            'date': cpi_date.strftime('%Y-%m-%d'),
            'time_utc': cpi_date.isoformat(),
            'impact': 'high',
            'category': 'inflation',
            'estimate': '',
            'previous': '',
            'description': 'Monthly inflation data - key driver of Fed policy and market direction'
        })

    # PPI - typically day after CPI
    ppi_date = cpi_date + timedelta(days=1)
    if week_start.date() <= ppi_date.date() <= week_end.date():
        events.append({
            'event': 'PPI (Producer Price Index)',
            'date': ppi_date.strftime('%Y-%m-%d'),
            'time_utc': ppi_date.isoformat(),
            'impact': 'high',
            'category': 'inflation',
            'estimate': '',
            'previous': '',
            'description': 'Wholesale inflation data - leading indicator for consumer prices'
        })

    # NFP (Non-Farm Payrolls) - first Friday at 8:30 AM ET = 12:30 UTC (EDT)
    first_day = datetime(year, month, 1)
    days_until_friday = (4 - first_day.weekday()) % 7
    nfp_date = datetime(year, month, 1 + days_until_friday, 12, 30, tzinfo=timezone.utc)
    if week_start.date() <= nfp_date.date() <= week_end.date():
        events.append({
            'event': 'Non-Farm Payrolls (NFP)',
            'date': nfp_date.strftime('%Y-%m-%d'),
            'time_utc': nfp_date.isoformat(),
            'impact': 'high',
            'category': 'employment',
            'estimate': '',
            'previous': '',
            'description': 'Monthly jobs report - major market mover'
        })

    # Initial Jobless Claims - every Thursday at 8:30 AM ET = 12:30 UTC (EDT)
    days_until_thurs = (3 - weekday) % 7
    claims_date_dt = datetime(year, month, (today + timedelta(days=days_until_thurs)).day, 12, 30, tzinfo=timezone.utc)
    if week_start.date() <= claims_date_dt.date() <= week_end.date():
        events.append({
            'event': 'Initial Jobless Claims',
            'date': claims_date_dt.strftime('%Y-%m-%d'),
            'time_utc': claims_date_dt.isoformat(),
            'impact': 'medium',
            'category': 'employment',
            'estimate': '',
            'previous': '',
            'description': 'Weekly unemployment claims data'
        })

    # Retail Sales - mid-month at 8:30 AM ET = 12:30 UTC (EDT)
    retail_day = 15 if monthrange(year, month)[1] >= 15 else 13
    retail_date = datetime(year, month, retail_day, 12, 30, tzinfo=timezone.utc)
    if week_start.date() <= retail_date.date() <= week_end.date():
        events.append({
            'event': 'Retail Sales',
            'date': retail_date.strftime('%Y-%m-%d'),
            'time_utc': retail_date.isoformat(),
            'impact': 'medium',
            'category': 'economic',
            'estimate': '',
            'previous': '',
            'description': 'Monthly consumer spending data'
        })

    events.sort(key=lambda x: x['date'])
    return events

@api_router.get("/preflight")
async def get_preflight(user=Depends(get_current_user)):
    """Daily preflight briefing: economic calendar, earnings, breaking news.
    All external fetches run in parallel for speed."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime('%Y-%m-%d')
    weekday = now.weekday()  # 0=Mon
    week_start = (now - timedelta(days=weekday)).strftime('%Y-%m-%d')
    week_end = (now + timedelta(days=(6 - weekday))).strftime('%Y-%m-%d')
    end_date = (now + timedelta(days=60)).strftime('%Y-%m-%d')
    # Earnings window: include the past 7 days so recently-reported earnings (e.g. MSFT, GOOG)
    # aren't missed right after they report. Then look ahead 60 days for upcoming reports.
    earn_from = (now - timedelta(days=7)).strftime('%Y-%m-%d')

    # === Run all Finnhub fetches + DB query in PARALLEL ===
    econ_task = fetch_finnhub_economic_calendar(week_start, week_end) if FINNHUB_KEY else asyncio.sleep(0, result=[])
    earn_task = fetch_finnhub_earnings(earn_from, end_date)
    recent_earn_task = _fetch_recent_earnings(days_back=14)  # yfinance — fills Finnhub's past-earnings gap
    news_task = fetch_finnhub_news()
    db_task = db.economic_events.find(
        {'date': {'$gte': today_str}}, {'_id': 0}
    ).sort('date', 1).to_list(20)

    economic_events, earnings, recent_earnings, finnhub_news, db_events = await asyncio.gather(
        econ_task, earn_task, recent_earn_task, news_task, db_task,
        return_exceptions=False,
    )

    # Economic events: decide source
    data_source = 'none'
    if FINNHUB_KEY:
        data_source = 'live' if economic_events else 'live_empty'
    if not economic_events:
        economic_events = get_economic_events_for_week(now)
        if data_source == 'none':
            data_source = 'stub'

    # Merge DB events with generated ones
    all_events = economic_events + (db_events or [])
    all_events.sort(key=lambda x: x.get('date', ''))

    # Earnings list — tag "reported" vs "upcoming" and sort so recent reports appear first,
    # then upcoming in chronological order. Merge Finnhub (upcoming) + yfinance (recent past).
    earnings_list = []
    seen = set()  # dedupe by (symbol, date)

    # 1. Recent past earnings from yfinance (with actuals)
    for e in (recent_earnings or []):
        key = (e.get('symbol', ''), e.get('date', ''))
        if key in seen:
            continue
        seen.add(key)
        earnings_list.append({
            'symbol': e.get('symbol', ''),
            'date': e.get('date', ''),
            'hour': e.get('hour', ''),
            'epsEstimate': e.get('epsEstimate'),
            'revenueEstimate': e.get('revenueEstimate'),
            'epsActual': e.get('epsActual'),
            'revenueActual': e.get('revenueActual'),
            'reported': True,
        })

    # 2. Finnhub upcoming earnings
    for e in (earnings or []):
        event_date = e.get('date', '')
        key = (e.get('symbol', ''), event_date)
        if key in seen:
            continue
        seen.add(key)
        has_actuals = e.get('epsActual') is not None or e.get('revenueActual') is not None
        is_past = event_date and event_date < today_str
        reported = has_actuals or is_past
        earnings_list.append({
            'symbol': e.get('symbol', ''),
            'date': event_date,
            'hour': e.get('hour', ''),
            'epsEstimate': e.get('epsEstimate'),
            'revenueEstimate': e.get('revenueEstimate'),
            'epsActual': e.get('epsActual'),
            'revenueActual': e.get('revenueActual'),
            'reported': reported,
        })
    # Sort: recently-reported first (desc within past), then upcoming (asc within future)
    earnings_list.sort(key=lambda x: (
        0 if x['reported'] else 1,                  # reported rows first
        -int(x['date'].replace('-', '')) if x['reported'] and x['date'] else 0,  # desc within reported
        int(x['date'].replace('-', '')) if not x['reported'] and x['date'] else 0,  # asc within upcoming
    ))

    # Breaking news (most recent Finnhub news)
    breaking = []
    if finnhub_news:
        for item in finnhub_news[:10]:
            headline = item.get('headline', '')
            summary = item.get('summary', '')
            breaking.append({
                'id': str(item.get('id', uuid.uuid4())),
                'headline': headline,
                'source': item.get('source', 'Unknown'),
                'summary': summary,
                'sentiment': simple_sentiment(headline + ' ' + summary),
                'url': item.get('url', ''),
                'timestamp': datetime.fromtimestamp(item.get('datetime', 0), tz=timezone.utc).isoformat() if item.get('datetime') else now.isoformat()
            })
    else:
        for news in MOCK_NEWS[:8]:
            ts = now - timedelta(hours=random.randint(0, 6))
            breaking.append({
                'id': str(uuid.uuid4()),
                'headline': news['headline'],
                'source': news['source'],
                'summary': news['summary'],
                'sentiment': news['sentiment'],
                'url': '',
                'timestamp': ts.isoformat()
            })

    return {
        'date': today_str,
        'economic_events': all_events,
        'economic_source': data_source,
        'earnings': earnings_list,
        'breaking_news': breaking,
    }

@api_router.post("/preflight/events")
async def add_economic_event(body: dict = Body(...), user=Depends(get_admin_user)):
    """Admin: Add a custom economic event to the calendar"""
    event = {
        'id': str(uuid.uuid4()),
        'event': body.get('event', ''),
        'date': body.get('date', ''),
        'time': body.get('time', ''),
        'impact': body.get('impact', 'medium'),
        'category': body.get('category', 'economic'),
        'estimate': body.get('estimate', ''),
        'previous': body.get('previous', ''),
        'description': body.get('description', ''),
    }
    await db.economic_events.insert_one(event)
    return {k: v for k, v in event.items() if k != '_id'}

# =====================
# ALERT ENDPOINTS (NDX Trading Pipeline)
# =====================
@api_router.get("/alerts")
async def get_alerts(user=Depends(get_current_user)):
    """Get NDX trading alerts - only from webhook pipeline and admin. Requires auth."""
    alerts = await db.alerts.find(
        {'source': {'$in': ['webhook', 'pipedream', 'tradingview', 'admin', 'signal', 'discord']}},
        {'_id': 0}
    ).sort('created_at', -1).to_list(500)
    return {'alerts': alerts}

@api_router.post("/alerts")
async def create_alert(data: AlertCreate, user=Depends(get_admin_user)):
    alert = {
        'id': str(uuid.uuid4()),
        'title': data.title,
        'message': data.message,
        'type': data.type,
        'ticker': data.ticker or 'NDX',
        'severity': data.severity,
        'source': 'admin',
        'created_by': user['username'],
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    await db.alerts.insert_one(alert)
    return {k: v for k, v in alert.items() if k != '_id'}

@api_router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, user=Depends(get_admin_user)):
    result = await db.alerts.delete_one({'id': alert_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Alert not found')
    return {'status': 'deleted'}


def _detect_discord_type(text: str) -> str:
    """Detect bullish/bearish/signal type from message text.
    Checks Unicode emojis first, then falls back to trading keywords."""
    try:
        from discord_bot import _detect_alert_type
        return _detect_alert_type(text or '')
    except Exception:
        # Inline fallback if import fails
        if not text:
            return 'signal'
        _BUP = {'🟢', '✅', '📈', '🚀', '💚', '🏆', '💰', '🎯', '💹', '👍', '🌟', '🔝', '⬆️', '▲'}
        _BDN = {'🔴', '❌', '📉', '💀', '🛑', '⛔', '🚨', '⚠️', '👎', '☠️', '⬇️', '▼', '🆘'}
        for c in text:
            if c in _BUP: return 'bullish'
        for c in text:
            if c in _BDN: return 'bearish'
        tl = text.lower()
        import re as _re
        bkw = {'winner','winners','long','buy','buying','call','calls','bullish','breakout','bounce','moon','squeeze','rip'}
        rkw = {'loser','losers','short','sell','selling','put','puts','bearish','breakdown','dump','drop','crash'}
        found_bear = False
        for w in _re.findall(r'\b[a-z]+\b', tl):
            if w in bkw: return 'bullish'
            if w in rkw: found_bear = True
        return 'bearish' if found_bear else 'signal'


@api_router.post("/alerts/webhook")
async def webhook_alert(
    body: dict = Body(...),
    x_webhook_secret: Optional[str] = Header(None, alias="X-Webhook-Secret"),
    authorization: Optional[str] = Header(None),
):
    """
    Webhook endpoint for incoming trade signals.

    Expected payload:
    {"content": "24,580.50"}  or  {"content": "NDX at 24,580 - support bounce"}

    Also accepts:
    {"text": "..."}  or  {"price": "24580"}  or  {"title": "...", "message": "..."}

    Authentication:
    - If WEBHOOK_SECRET env var is set, requests must include it via either:
        * X-Webhook-Secret: <secret>
        * Authorization: Bearer <secret>
    - If WEBHOOK_SECRET is not set, endpoint allows all (with a warning log).
    """
    # === Auth check ===
    if WEBHOOK_SECRET:
        provided = x_webhook_secret or ''
        if not provided and authorization:
            # Support "Authorization: Bearer <secret>" as a fallback
            if authorization.lower().startswith('bearer '):
                provided = authorization.split(' ', 1)[1].strip()
        if provided != WEBHOOK_SECRET:
            logger.warning("Webhook rejected: invalid or missing secret")
            raise HTTPException(status_code=403, detail="Forbidden: invalid webhook secret")
    else:
        logger.warning("Webhook accepted without auth (WEBHOOK_SECRET not configured)")

    # Extract the alert content - try multiple fields
    content = body.get('content', '') or body.get('text', '') or body.get('message', '') or body.get('alert', '')
    price = body.get('price', '')
    
    # If content looks like a price, extract it
    if content and not price:
        import re
        price_match = re.search(r'[\d,]+\.?\d*', content.replace(' ', ''))
        if price_match:
            price = price_match.group(0)
    
    # Build the alert title
    if price:
        title = f"NDX @ {price}"
    elif content:
        title = content[:120]
    else:
        title = "NDX Trade Signal"
    
    alert = {
        'id': str(uuid.uuid4()),
        'title': title,
        'message': content or title,
        'type': _detect_discord_type(content or title),
        'ticker': 'NDX',
        'severity': 'high',
        'source': 'webhook',
        'price': price,
        'created_by': 'Alerts Command',
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    await db.alerts.insert_one(alert)
    logger.info(f"Webhook alert received: {title}")
    
    # Send push notifications to all registered devices
    await send_push_notifications(title, content or title, alert['id'])
    
    return {'status': 'ok', 'alert_id': alert['id']}

# =====================
# PUSH NOTIFICATION ENDPOINTS
# =====================
async def send_push_notifications(title: str, body: str, alert_id: str = ''):
    """Send push notifications to all registered devices via Expo"""
    try:
        from exponent_server_sdk import PushClient, PushMessage, PushServerError
        tokens = await db.push_tokens.find({}, {'_id': 0, 'token': 1}).to_list(1000)
        if not tokens:
            return
        messages = []
        for doc in tokens:
            token = doc.get('token', '')
            if not token:
                continue
            messages.append(PushMessage(
                to=token,
                title=title,
                body=body[:200],
                data={'type': 'alert', 'alert_id': alert_id},
                sound='default',
                priority='high',
            ))
        if messages:
            client = PushClient()
            try:
                responses = client.publish_multiple(messages)
                logger.info(f"Push notifications sent: {len(responses)} devices")
            except PushServerError as e:
                logger.error(f"Push server error: {e}")
            except Exception as e:
                logger.error(f"Push send error: {e}")
    except ImportError:
        logger.warning("exponent_server_sdk not installed, skipping push")
    except Exception as e:
        logger.error(f"Push notification error: {e}")

@api_router.post("/notifications/register")
async def register_push_token(body: dict = Body(...), user=Depends(get_current_user)):
    token = body.get('token', '').strip()
    if not token:
        raise HTTPException(status_code=400, detail='Push token is required')
    # Upsert: one token per user, update if exists
    await db.push_tokens.update_one(
        {'user_id': user['id']},
        {'$set': {'user_id': user['id'], 'token': token, 'updated_at': datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    logger.info(f"Push token registered for user {user['username']}")
    return {'status': 'registered'}

@api_router.post("/notifications/unregister")
async def unregister_push_token(user=Depends(get_current_user)):
    await db.push_tokens.delete_many({'user_id': user['id']})
    return {'status': 'unregistered'}

# =====================
# CHAT ENDPOINTS
# =====================
@api_router.get("/chat/channels")
async def get_channels(user=Depends(get_optional_user)):
    channels = await db.channels.find({}, {'_id': 0}).to_list(20)
    return {'channels': channels}

@api_router.get("/chat/messages/{channel_id}")
async def get_messages(channel_id: str, limit: int = 50, user=Depends(get_current_user)):
    messages = await db.messages.find(
        {'channel_id': channel_id}, {'_id': 0}
    ).sort('created_at', -1).to_list(limit)
    messages.reverse()
    return {'messages': messages}

@api_router.post("/chat/messages/{channel_id}")
async def send_message(channel_id: str, data: MessageCreate, user=Depends(get_current_user)):
    msg = {
        'id': str(uuid.uuid4()),
        'channel_id': channel_id,
        'user_id': user['id'],
        'username': user['username'],
        'content': data.content,
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    await db.messages.insert_one(msg)
    return {k: v for k, v in msg.items() if k != '_id'}

# =====================
# VIDEO ENDPOINTS (Teaching Content)
# =====================
class VideoCreate(BaseModel):
    title: str
    description: str = ""
    url: str
    category: str = "General"
    thumbnail_url: str = ""

def extract_video_embed_url(url: str) -> dict:
    """Extract embed URL and thumbnail from YouTube/Vimeo links"""
    import re
    # YouTube patterns
    yt_patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com/shorts/([a-zA-Z0-9_-]{11})',
    ]
    for pattern in yt_patterns:
        match = re.search(pattern, url)
        if match:
            vid = match.group(1)
            return {
                'embed_url': f'https://www.youtube.com/embed/{vid}?modestbranding=1&rel=0&showinfo=0&controls=1&playsinline=1&color=white',
                'thumbnail': f'https://img.youtube.com/vi/{vid}/hqdefault.jpg',
                'platform': 'youtube',
                'video_id': vid,
            }
    # Vimeo patterns
    vimeo_match = re.search(r'vimeo\.com/(\d+)', url)
    if vimeo_match:
        vid = vimeo_match.group(1)
        return {
            'embed_url': f'https://player.vimeo.com/video/{vid}?title=0&byline=0&portrait=0',
            'thumbnail': '',
            'platform': 'vimeo',
            'video_id': vid,
        }
    # Direct URL fallback
    return {'embed_url': url, 'thumbnail': '', 'platform': 'direct', 'video_id': ''}

@api_router.get("/videos")
async def get_videos(category: str = "", user=Depends(get_optional_user)):
    query = {}
    if category:
        query['category'] = category
    videos = await db.videos.find(query, {'_id': 0}).sort('created_at', -1).to_list(100)
    return {'videos': videos}

@api_router.post("/videos")
async def create_video(data: VideoCreate, user=Depends(get_admin_user)):
    embed_info = extract_video_embed_url(data.url)
    video = {
        'id': str(uuid.uuid4()),
        'title': data.title,
        'description': data.description,
        'url': data.url,
        'embed_url': embed_info['embed_url'],
        'thumbnail_url': data.thumbnail_url or embed_info['thumbnail'],
        'platform': embed_info['platform'],
        'video_id': embed_info['video_id'],
        'category': data.category,
        'created_by': user['username'],
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    await db.videos.insert_one(video)
    return {k: v for k, v in video.items() if k != '_id'}

@api_router.delete("/videos/{video_id}")
async def delete_video(video_id: str, user=Depends(get_admin_user)):
    result = await db.videos.delete_one({'id': video_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Video not found')
    return {'status': 'deleted'}

@api_router.get("/videos/categories")
async def get_video_categories(user=Depends(get_optional_user)):
    categories = await db.videos.distinct('category')
    return {'categories': categories or ['General', 'Beginner', 'Strategy', 'Technical Analysis', 'Advanced']}

# =====================
# WATCHLIST ENDPOINTS
# =====================
DEFAULT_WATCHLIST = ['QQQ', 'NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL']

@api_router.get("/watchlist")
async def get_watchlist(user=Depends(get_current_user)):
    doc = await db.watchlists.find_one({'user_id': user['id']}, {'_id': 0})
    if not doc:
        # Create default watchlist for new users
        doc = {'user_id': user['id'], 'symbols': DEFAULT_WATCHLIST}
        await db.watchlists.insert_one(doc)
    return {'symbols': doc.get('symbols', DEFAULT_WATCHLIST)}

@api_router.post("/watchlist/add")
async def add_to_watchlist(body: dict = Body(...), user=Depends(get_current_user)):
    symbol = body.get('symbol', '').upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail='Symbol is required')
    if len(symbol) > 10:
        raise HTTPException(status_code=400, detail='Invalid symbol')
    
    doc = await db.watchlists.find_one({'user_id': user['id']})
    if not doc:
        await db.watchlists.insert_one({'user_id': user['id'], 'symbols': DEFAULT_WATCHLIST + [symbol]})
    else:
        symbols = doc.get('symbols', [])
        if symbol not in symbols:
            symbols.append(symbol)
            await db.watchlists.update_one({'user_id': user['id']}, {'$set': {'symbols': symbols}})
    
    return {'status': 'added', 'symbol': symbol}

@api_router.post("/watchlist/remove")
async def remove_from_watchlist(body: dict = Body(...), user=Depends(get_current_user)):
    symbol = body.get('symbol', '').upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail='Symbol is required')
    
    doc = await db.watchlists.find_one({'user_id': user['id']})
    if doc:
        symbols = doc.get('symbols', [])
        if symbol in symbols:
            symbols.remove(symbol)
            await db.watchlists.update_one({'user_id': user['id']}, {'$set': {'symbols': symbols}})
    
    return {'status': 'removed', 'symbol': symbol}

@api_router.get("/market/quote-multi")
async def get_multi_quotes(symbols: str = "", user=Depends(get_optional_user)):
    """Fetch quotes for a list of comma-separated symbols — fully parallel."""
    if not symbols:
        return {'quotes': []}
    symbol_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]

    async def _one(sym: str):
        try:
            if sym == 'NDX':
                quote = await fetch_ndx_quote()
            else:
                quote = await fetch_finnhub_quote(sym)
            if not quote:
                quote = generate_mock_quote(sym)
        except Exception:
            quote = generate_mock_quote(sym)
        quote['sparkline'] = generate_mock_sparkline(sym)
        return quote

    quotes = await asyncio.gather(*[_one(s) for s in symbol_list], return_exceptions=False)
    return {'quotes': list(quotes)}

@api_router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, body: dict = Body(...), user=Depends(get_admin_user)):
    """Admin: Update an existing alert"""
    update_fields = {}
    if 'title' in body:
        update_fields['title'] = body['title']
    if 'message' in body:
        update_fields['message'] = body['message']
    if 'type' in body:
        update_fields['type'] = body['type']
    if 'ticker' in body:
        update_fields['ticker'] = body['ticker']
    if 'severity' in body:
        update_fields['severity'] = body['severity']
    if not update_fields:
        raise HTTPException(status_code=400, detail='No fields to update')
    update_fields['updated_at'] = datetime.now(timezone.utc).isoformat()
    update_fields['updated_by'] = user['username']
    result = await db.alerts.update_one({'id': alert_id}, {'$set': update_fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail='Alert not found')
    return {'success': True, 'id': alert_id, **update_fields}

# =====================
# AI SENTIMENT ANALYSIS
# =====================
_ai_sentiment_cache: Dict[str, Any] = {}
_ai_sentiment_cache_time: float = 0
_ai_sentiment_refresh_lock = asyncio.Lock()
_ai_sentiment_refreshing: bool = False
AI_SENTIMENT_CACHE_TTL = 900           # 15 min — fresh
AI_SENTIMENT_HARD_TTL = 3600           # 60 min — beyond this, force fresh fetch

# Weekly recap cache (keyed by ISO week, e.g. "2026-W16")
_weekly_recap_cache: Dict[str, Dict[str, Any]] = {}
_weekly_recap_lock = asyncio.Lock()
# Daily after-hours recap — keyed by YYYY-MM-DD trading day
_daily_recap_cache: Dict[str, Dict[str, Any]] = {}
_daily_recap_lock = asyncio.Lock()


def _market_state() -> str:
    """Return one of: 'open', 'after_hours', 'weekend'.
    - 'open':        Mon-Fri 9:30 AM - 4:00 PM ET (regular session)
    - 'after_hours': Mon-Fri outside regular hours (pre-market, post-market)
    - 'weekend':     Sat / Sun ET
    Intra-week holidays aren't handled — they just read as 'after_hours' most of the day, which is fine."""
    try:
        from datetime import datetime as _dt, time as _time_cls
        from zoneinfo import ZoneInfo
        et_now = _dt.now(ZoneInfo("America/New_York"))
    except Exception:
        return 'open'  # fallback: assume open if tz data missing
    # Sat=5, Sun=6
    if et_now.weekday() >= 5:
        return 'weekend'
    t = et_now.time()
    market_open = _time_cls(9, 30)
    market_close = _time_cls(16, 0)  # 4:00 PM ET
    if market_open <= t < market_close:
        return 'open'
    return 'after_hours'


def _is_market_closed_now() -> bool:
    """Legacy helper: True for weekend only (used where weekly recap was previously gated)."""
    return _market_state() == 'weekend'


def _current_trading_day_key() -> str:
    """Returns YYYY-MM-DD for the most recent completed/in-progress US trading day in ET.
    Used as the cache key for the daily after-hours recap."""
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo
        et_now = _dt.now(ZoneInfo("America/New_York"))
    except Exception:
        et_now = datetime.now(timezone.utc)
    # If it's weekend, roll back to Friday for the recap target date
    wd = et_now.weekday()
    if wd == 5:  # Sat
        et_now = et_now - timedelta(days=1)
    elif wd == 6:  # Sun
        et_now = et_now - timedelta(days=2)
    return et_now.strftime('%Y-%m-%d')


def _current_iso_week_key() -> str:
    """Returns an ISO week identifier like '2026-W16'. Used as weekly recap cache key."""
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo
        et_now = _dt.now(ZoneInfo("America/New_York"))
    except Exception:
        et_now = datetime.now(timezone.utc)
    iso_year, iso_week, _ = et_now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _fetch_daily_movers_yf() -> Dict[str, Any]:
    """Fetch SINGLE-DAY % change for indexes and tracked stocks (for after-hours daily recap).
    Uses last 2 trading days: today_close vs prior_close."""
    import yfinance as _yf

    index_specs = [
        ('^NDX', 'Nasdaq 100'),
        ('^GSPC', 'S&P 500'),
        ('^DJI', 'Dow Jones'),
        ('^RUT', 'Russell 2000'),
        ('^VIX', 'VIX (Volatility)'),
    ]
    stock_symbols = ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL', 'QQQ']

    def _day_pct(symbol: str) -> Optional[Dict[str, Any]]:
        try:
            t = _yf.Ticker(symbol)
            hist = t.history(period='5d', interval='1d')
            if hist.empty or len(hist) < 2:
                return None
            prior_close = float(hist['Close'].iloc[-2])
            today_close = float(hist['Close'].iloc[-1])
            if prior_close <= 0:
                return None
            pct = round(((today_close - prior_close) / prior_close) * 100, 2)
            return {
                'symbol': symbol.lstrip('^'),
                'price': round(today_close, 2),
                'change_pct': pct,
                'open_week': round(prior_close, 2),  # reused as prior_close
            }
        except Exception as e:
            logger.warning(f"Daily movers yfinance error for {symbol}: {e}")
            return None

    indexes = []
    for sym, name in index_specs:
        row = _day_pct(sym)
        if row:
            row['name'] = name
            indexes.append(row)

    stock_rows = []
    for sym in stock_symbols:
        row = _day_pct(sym)
        if row:
            row['name'] = TRACKED_SYMBOLS.get(sym, {}).get('name', sym)
            stock_rows.append(row)

    stock_rows.sort(key=lambda r: r['change_pct'], reverse=True)
    return {
        'indexes': indexes,
        'top_gainers': stock_rows[:5],
        'top_losers': list(reversed(stock_rows[-5:])) if len(stock_rows) >= 5 else [],
    }


async def _fetch_daily_movers() -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _fetch_daily_movers_yf)


def _fetch_weekly_movers_yf() -> Dict[str, Any]:
    """Fetch weekly % change scoped to THIS CURRENT calendar week (Monday → now).
    Runs in thread pool (yfinance is sync)."""
    import yfinance as _yf
    from datetime import datetime as _dt

    # Current week's Monday in US Eastern (market time)
    try:
        from zoneinfo import ZoneInfo
        et_now = _dt.now(ZoneInfo("America/New_York"))
    except Exception:
        et_now = datetime.now(timezone.utc)
    monday = et_now - timedelta(days=et_now.weekday())
    # Download 2 weeks of history so we can safely find this Monday's open + latest close
    start = (monday - timedelta(days=3)).strftime('%Y-%m-%d')

    index_specs = [
        ('^NDX', 'Nasdaq 100'),
        ('^GSPC', 'S&P 500'),
        ('^DJI', 'Dow Jones'),
        ('^RUT', 'Russell 2000'),
        ('^VIX', 'VIX (Volatility)'),
    ]
    stock_symbols = ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL', 'QQQ']

    def _pct_change(symbol: str) -> Optional[Dict[str, Any]]:
        try:
            t = _yf.Ticker(symbol)
            hist = t.history(start=start, interval='1d')
            if hist.empty or len(hist) < 2:
                return None
            # Filter to rows from this calendar week's Monday onward
            week_rows = hist[hist.index.date >= monday.date()]
            if week_rows.empty:
                # Market hasn't opened this week yet (e.g. early Monday pre-market) — fall back to last row
                week_rows = hist.tail(1)
            open_price = float(week_rows['Open'].iloc[0])
            close_price = float(week_rows['Close'].iloc[-1])
            if open_price <= 0:
                return None
            pct = round(((close_price - open_price) / open_price) * 100, 2)
            return {
                'symbol': symbol.lstrip('^'),
                'price': round(close_price, 2),
                'change_pct': pct,
                'open_week': round(open_price, 2),
            }
        except Exception as e:
            logger.warning(f"Weekly movers yfinance error for {symbol}: {e}")
            return None

    indexes = []
    for sym, name in index_specs:
        row = _pct_change(sym)
        if row:
            row['name'] = name
            indexes.append(row)

    stock_rows = []
    for sym in stock_symbols:
        row = _pct_change(sym)
        if row:
            row['name'] = TRACKED_SYMBOLS.get(sym, {}).get('name', sym)
            stock_rows.append(row)

    # Sort once, slice for gainers/losers
    stock_rows.sort(key=lambda r: r['change_pct'], reverse=True)
    top_gainers = stock_rows[:5]
    top_losers = list(reversed(stock_rows[-5:])) if len(stock_rows) >= 5 else []

    return {
        'indexes': indexes,
        'top_gainers': top_gainers,
        'top_losers': top_losers,
    }


async def _fetch_weekly_movers() -> Dict[str, Any]:
    """Async wrapper for weekly movers fetch (runs yfinance in thread pool)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _fetch_weekly_movers_yf)


def _week_label(week_key: str) -> str:
    """Given '2026-W16', return a human-readable 'Apr 13–19, 2026' label."""
    try:
        year, week = week_key.split('-W')
        year_i, week_i = int(year), int(week)
        monday = datetime.strptime(f'{year_i}-W{week_i:02d}-1', '%G-W%V-%u')
        sunday = monday + timedelta(days=6)
        if monday.month == sunday.month:
            return f"{monday.strftime('%b')} {monday.day}–{sunday.day}, {monday.year}"
        return f"{monday.strftime('%b %d')} – {sunday.strftime('%b %d')}, {sunday.year}"
    except Exception:
        return week_key


async def _generate_weekly_recap() -> Dict[str, Any]:
    """Generate the weekend 'Week in Review' payload.
    Parallelizes movers + news fetches; Claude summarizes both.
    Cached per ISO-week so it regenerates at most once per week."""
    if not EMERGENT_LLM_KEY:
        return {'error': 'AI service not configured', 'sentiment': None, 'mode': 'weekly_recap'}

    movers, finnhub_news = await asyncio.gather(
        _fetch_weekly_movers(),
        fetch_finnhub_news(),
        return_exceptions=False,
    )

    # Filter news to last 7 days, take top 10 with summary
    week_news_items = []
    now_ts = time.time()
    seven_days_ago = now_ts - (7 * 86400)
    if finnhub_news:
        for item in finnhub_news:
            dt = item.get('datetime', 0) or 0
            if dt >= seven_days_ago:
                week_news_items.append(item)
            if len(week_news_items) >= 15:
                break
    if not week_news_items and finnhub_news:
        week_news_items = finnhub_news[:10]

    key_news = []
    for item in week_news_items[:10]:
        headline = item.get('headline', '')
        summary = item.get('summary', '')
        key_news.append({
            'headline': headline,
            'source': item.get('source', 'Unknown'),
            'summary': summary[:250],
            'sentiment': simple_sentiment(headline + ' ' + summary),
            'url': item.get('url', ''),
            'timestamp': datetime.fromtimestamp(item.get('datetime', 0), tz=timezone.utc).isoformat() if item.get('datetime') else datetime.now(timezone.utc).isoformat()
        })

    # Build Claude prompt
    news_text = "\n".join(f"- [{n['source']}] {n['headline']}. {n['summary'][:150]}" for n in key_news[:8])
    indexes_text = "\n".join(f"- {i['name']} ({i['symbol']}): {i['change_pct']:+.2f}% (close ${i['price']})" for i in movers.get('indexes', []))
    gainers_text = "\n".join(f"- {g['symbol']} ({g['name']}): {g['change_pct']:+.2f}%" for g in movers.get('top_gainers', [])[:3])
    losers_text = "\n".join(f"- {l['symbol']} ({l['name']}): {l['change_pct']:+.2f}%" for l in movers.get('top_losers', [])[:3])

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ndx-weekly-{_current_iso_week_key()}",
        system_message="""You are a senior market analyst writing a weekend 'Week in Review' brief for a Nasdaq-100 (NDX) trading community.
Markets are closed; produce a concise, static recap of what happened this past week.

Respond ONLY with valid JSON in this exact format:
{
  "overall_sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 1-10,
  "summary": "3-4 sentence recap of how markets moved this week",
  "key_drivers": ["driver 1", "driver 2", "driver 3"],
  "ndx_outlook": "1-2 sentence take on what to watch when markets reopen Monday",
  "risk_factors": ["risk 1", "risk 2"],
  "trade_bias": "Brief actionable stance heading into next week"
}

Be direct, professional, trading-focused. No disclaimers."""
    )
    chat.with_model("anthropic", "claude-4-sonnet-20250514")
    chat.with_params(timeout=15, num_retries=0)

    user_msg = UserMessage(text=f"""Weekly market recap — produce JSON analysis.

INDEX PERFORMANCE (week):
{indexes_text or '(data unavailable)'}

TOP GAINERS (NDX-100 tracked, this week):
{gainers_text or '(none)'}

TOP LOSERS (NDX-100 tracked, this week):
{losers_text or '(none)'}

KEY NEWS THIS WEEK:
{news_text or '(no news available)'}

Provide your JSON analysis.""")

    # Sentiment via Claude (with its own 15s litellm timeout)
    sentiment_data: Dict[str, Any] = {
        'overall_sentiment': 'neutral',
        'confidence': 0,
        'summary': 'Week in review summary unavailable.',
        'key_drivers': [],
        'ndx_outlook': '',
        'risk_factors': [],
        'trade_bias': ''
    }
    try:
        response = await chat.send_message(user_msg)
        resp_text = response.strip()
        if resp_text.startswith('```'):
            resp_text = resp_text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        sentiment_data = json.loads(resp_text)
    except Exception as e:
        logger.warning(f"Weekly recap Claude call failed: {e} — returning movers-only recap")

    week_key = _current_iso_week_key()
    return {
        'mode': 'weekly_recap',
        'sentiment': sentiment_data,
        'weekly_recap': {
            'week_key': week_key,
            'week_label': _week_label(week_key),
            'indexes': movers.get('indexes', []),
            'top_gainers': movers.get('top_gainers', []),
            'top_losers': movers.get('top_losers', []),
            'key_news': key_news,
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'ndx_price': next((i['price'] for i in movers.get('indexes', []) if i['symbol'] == 'NDX'), None),
        'ndx_change': next((i['change_pct'] for i in movers.get('indexes', []) if i['symbol'] == 'NDX'), None),
        'news_count': len(key_news),
    }


async def _generate_daily_recap() -> Dict[str, Any]:
    """Generate the weekday after-hours 'Today's Recap' payload.
    Similar to weekly recap, but focused on single-day performance."""
    if not EMERGENT_LLM_KEY:
        return {'error': 'AI service not configured', 'sentiment': None, 'mode': 'daily_recap'}

    movers, finnhub_news = await asyncio.gather(
        _fetch_daily_movers(),    # 1-day % change (yesterday close → today close)
        fetch_finnhub_news(),
        return_exceptions=False,
    )

    # Pick up to 6 most recent news items
    key_news = []
    for item in (finnhub_news or [])[:8]:
        headline = item.get('headline', '')
        summary = item.get('summary', '')
        key_news.append({
            'headline': headline,
            'source': item.get('source', 'Unknown'),
            'summary': summary[:250],
            'sentiment': simple_sentiment(headline + ' ' + summary),
            'url': item.get('url', ''),
            'timestamp': datetime.fromtimestamp(item.get('datetime', 0), tz=timezone.utc).isoformat() if item.get('datetime') else datetime.now(timezone.utc).isoformat()
        })

    news_text = "\n".join(f"- [{n['source']}] {n['headline']}. {n['summary'][:150]}" for n in key_news[:6])
    indexes_text = "\n".join(f"- {i['name']} ({i['symbol']}): {i['change_pct']:+.2f}% (close ${i['price']})" for i in movers.get('indexes', []))
    gainers_text = "\n".join(f"- {g['symbol']} ({g['name']}): {g['change_pct']:+.2f}%" for g in movers.get('top_gainers', [])[:3])
    losers_text = "\n".join(f"- {l['symbol']} ({l['name']}): {l['change_pct']:+.2f}%" for l in movers.get('top_losers', [])[:3])

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    today_key = _current_trading_day_key()
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ndx-daily-{today_key}",
        system_message="""You are a senior market analyst writing a post-close 'Today's Recap' brief for a Nasdaq-100 (NDX) trading community.
Markets just closed for the day; produce a concise, static recap of how today's session played out and what to watch tomorrow.

Respond ONLY with valid JSON in this exact format:
{
  "overall_sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 1-10,
  "summary": "2-3 sentence recap of today's market action",
  "key_drivers": ["driver 1", "driver 2", "driver 3"],
  "ndx_outlook": "1-2 sentence take on tomorrow's open",
  "risk_factors": ["risk 1", "risk 2"],
  "trade_bias": "Brief actionable stance for the next session"
}

Be direct, professional, trading-focused. No disclaimers."""
    )
    chat.with_model("anthropic", "claude-4-sonnet-20250514")
    chat.with_params(timeout=15, num_retries=0)

    user_msg = UserMessage(text=f"""Post-close recap for {today_key} — produce JSON analysis.

TODAY'S INDEX PERFORMANCE:
{indexes_text or '(data unavailable)'}

TOP GAINERS (NDX-100 tracked, today):
{gainers_text or '(none)'}

TOP LOSERS (NDX-100 tracked, today):
{losers_text or '(none)'}

KEY NEWS TODAY:
{news_text or '(no news available)'}

Provide your JSON analysis.""")

    sentiment_data: Dict[str, Any] = {
        'overall_sentiment': 'neutral',
        'confidence': 0,
        'summary': "Today's recap summary unavailable.",
        'key_drivers': [],
        'ndx_outlook': '',
        'risk_factors': [],
        'trade_bias': ''
    }
    try:
        response = await chat.send_message(user_msg)
        resp_text = response.strip()
        if resp_text.startswith('```'):
            resp_text = resp_text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        sentiment_data = json.loads(resp_text)
    except Exception as e:
        logger.warning(f"Daily recap Claude call failed: {e} — returning movers-only recap")

    # Human-readable date label like "Apr 21, 2026"
    try:
        dt_obj = datetime.strptime(today_key, '%Y-%m-%d')
        date_label = dt_obj.strftime('%b %-d, %Y') if hasattr(dt_obj, 'strftime') else today_key
    except Exception:
        date_label = today_key

    return {
        'mode': 'daily_recap',
        'sentiment': sentiment_data,
        'daily_recap': {
            'date_key': today_key,
            'date_label': date_label,
            'indexes': movers.get('indexes', []),
            'top_gainers': movers.get('top_gainers', []),
            'top_losers': movers.get('top_losers', []),
            'key_news': key_news,
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'ndx_price': next((i['price'] for i in movers.get('indexes', []) if i['symbol'] == 'NDX'), None),
        'ndx_change': next((i['change_pct'] for i in movers.get('indexes', []) if i['symbol'] == 'NDX'), None),
        'news_count': len(key_news),
    }


async def _generate_ai_sentiment() -> Dict[str, Any]:
    """Fetch data + call Claude. Used by the endpoint and the background refresher."""
    if not EMERGENT_LLM_KEY:
        return {'error': 'AI service not configured', 'sentiment': None}

    # Gather context in parallel: NDX quote + news
    ndx_quote, finnhub_news = await asyncio.gather(
        fetch_ndx_quote(),
        fetch_finnhub_news(),
        return_exceptions=False,
    )

    # Build news summary for Claude
    news_text = ""
    if finnhub_news:
        for item in finnhub_news[:8]:
            headline = item.get('headline', '')
            source = item.get('source', 'Unknown')
            summary = item.get('summary', '')[:150]
            news_text += f"- [{source}] {headline}. {summary}\n"
    else:
        for item in MOCK_NEWS[:8]:
            news_text += f"- [{item['source']}] {item['headline']}. {item['summary'][:150]}\n"

    ndx_info = ""
    if ndx_quote:
        ndx_info = f"NDX (Nasdaq 100) is currently at ${ndx_quote.get('price', 'N/A')}, change: {ndx_quote.get('change', 0)} ({ndx_quote.get('changePercent', 0)}%). Open: ${ndx_quote.get('open', 'N/A')}, High: ${ndx_quote.get('high', 'N/A')}, Low: ${ndx_quote.get('low', 'N/A')}."

    # Call Claude via emergentintegrations with a hard timeout
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ndx-sentiment-{datetime.now(timezone.utc).strftime('%Y%m%d%H')}",
        system_message="""You are a senior market analyst for a Nasdaq-100 (NDX) trading community. 
Your job is to analyze breaking financial news and market data to produce a concise, actionable market intelligence brief.

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "overall_sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 1-10,
  "summary": "2-3 sentence market overview",
  "key_drivers": ["driver 1", "driver 2", "driver 3"],
  "ndx_outlook": "1-2 sentence NDX-specific analysis with key levels",
  "risk_factors": ["risk 1", "risk 2"],
  "trade_bias": "A brief actionable suggestion for NDX traders"
}

Be direct, professional, and trading-focused. No disclaimers or caveats."""
    )
    chat.with_model("anthropic", "claude-4-sonnet-20250514")
    # Tight timeout + no retries at litellm level (the underlying sync call blocks the
    # event loop, so our outer asyncio.wait_for won't cancel it — must be enforced here).
    chat.with_params(timeout=15, num_retries=0)

    user_message = UserMessage(
        text=f"""Analyze the following market data and news for the NDX trading community:

MARKET DATA:
{ndx_info}

BREAKING NEWS:
{news_text}

Provide your JSON analysis."""
    )

    # Hard 20s timeout so a slow Claude response can never hang the endpoint
    response = await asyncio.wait_for(chat.send_message(user_message), timeout=20.0)

    # Parse the JSON response
    try:
        resp_text = response.strip()
        if resp_text.startswith('```'):
            resp_text = resp_text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        sentiment_data = json.loads(resp_text)
    except json.JSONDecodeError:
        sentiment_data = {
            'overall_sentiment': 'neutral',
            'confidence': 5,
            'summary': response[:300] if response else 'Analysis unavailable',
            'key_drivers': [],
            'ndx_outlook': '',
            'risk_factors': [],
            'trade_bias': ''
        }

    return {
        'sentiment': sentiment_data,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'ndx_price': ndx_quote.get('price') if ndx_quote else None,
        'ndx_change': ndx_quote.get('changePercent') if ndx_quote else None,
        'news_count': len(finnhub_news) if finnhub_news else 0,
    }


async def _refresh_ai_sentiment_bg():
    """Background refresh — runs if cache is stale but still usable."""
    global _ai_sentiment_cache, _ai_sentiment_cache_time, _ai_sentiment_refreshing
    import time as _time
    if _ai_sentiment_refreshing:
        return
    _ai_sentiment_refreshing = True
    try:
        result = await _generate_ai_sentiment()
        if result.get('sentiment') or not _ai_sentiment_cache:
            _ai_sentiment_cache = result
            _ai_sentiment_cache_time = _time.time()
            logger.info("AI sentiment: background refresh complete")
    except Exception as e:
        logger.warning(f"AI sentiment background refresh failed: {e}")
    finally:
        _ai_sentiment_refreshing = False


@api_router.get("/ai/sentiment")
async def get_ai_sentiment(user=Depends(get_current_user)):
    """AI-powered market sentiment.

    - Weekends (Sat/Sun ET): returns a static 'Week in Review' cached per ISO week.
      Includes top gainers/losers, index performance, key news, and Claude summary.
    - Weekdays: returns live market sentiment with stale-while-revalidate caching
      (fresh <15 min, stale up to 60 min with background refresh).
    """
    global _ai_sentiment_cache, _ai_sentiment_cache_time
    import time as _time

    if not EMERGENT_LLM_KEY:
        return {'error': 'AI service not configured', 'sentiment': None}

    # === Market closed (weekend OR weekday after-hours) ===
    state = _market_state()

    if state == 'weekend':
        week_key = _current_iso_week_key()
        cached = _weekly_recap_cache.get(week_key)
        if cached:
            return cached
        # Cache miss — fire background generation and return placeholder IMMEDIATELY.
        # Do NOT block the request; the frontend 15s timeout fires before yfinance+Claude finishes.
        async def _gen_weekly_bg():
            try:
                async with _weekly_recap_lock:
                    if week_key in _weekly_recap_cache:
                        return  # already generated by another request
                    result = await _generate_weekly_recap()
                    if result.get('weekly_recap', {}).get('indexes') or result.get('weekly_recap', {}).get('top_gainers'):
                        _weekly_recap_cache[week_key] = result
                        logger.info(f"Weekly recap background-generated for {week_key}")
            except Exception as e:
                logger.error(f"Weekly recap background generation failed: {e}")
        asyncio.create_task(_gen_weekly_bg())
        return {
            'mode': 'weekly_recap',
            'pending': True,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'sentiment': {
                'overall_sentiment': 'neutral',
                'confidence': 0,
                'summary': 'Weekly recap is generating… pull down to refresh in about 30 seconds.',
                'key_drivers': [],
                'ndx_outlook': '',
                'risk_factors': [],
                'trade_bias': '',
            },
            'weekly_recap': None,
        }

    if state == 'after_hours':
        day_key = _current_trading_day_key()
        cached = _daily_recap_cache.get(day_key)
        if cached:
            return cached
        # Cache miss — non-blocking background generation
        async def _gen_daily_bg():
            try:
                async with _daily_recap_lock:
                    if day_key in _daily_recap_cache:
                        return
                    result = await _generate_daily_recap()
                    if result.get('daily_recap', {}).get('indexes') or result.get('daily_recap', {}).get('top_gainers'):
                        _daily_recap_cache[day_key] = result
                        logger.info(f"Daily recap background-generated for {day_key}")
            except Exception as e:
                logger.error(f"Daily recap background generation failed: {e}")
        asyncio.create_task(_gen_daily_bg())
        return {
            'mode': 'daily_recap',
            'pending': True,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'sentiment': {
                'overall_sentiment': 'neutral',
                'confidence': 0,
                'summary': "After-market recap is generating… pull down to refresh in about 30 seconds.",
                'key_drivers': [],
                'ndx_outlook': '',
                'risk_factors': [],
                'trade_bias': '',
            },
            'daily_recap': None,
        }

    # === Weekday: live sentiment (existing stale-while-revalidate) ===
    now = _time.time()
    age = now - _ai_sentiment_cache_time

    # Fresh cache hit
    if _ai_sentiment_cache and age < AI_SENTIMENT_CACHE_TTL:
        return {**_ai_sentiment_cache, 'mode': 'live'}

    # Stale but usable — serve cache, refresh in background
    if _ai_sentiment_cache and age < AI_SENTIMENT_HARD_TTL:
        asyncio.create_task(_refresh_ai_sentiment_bg())
        return {**_ai_sentiment_cache, 'mode': 'live'}

    # Expired or no cache — return a placeholder immediately and refresh in background.
    # NEVER block the user-facing request on a 5-9s Claude call.
    if not _ai_sentiment_cache:
        # First call after server boot — fire off generation, return placeholder
        asyncio.create_task(_refresh_ai_sentiment_bg())
        return {
            'mode': 'live',
            'sentiment': {
                'overall_sentiment': 'neutral',
                'confidence': 0,
                'summary': 'Market intelligence loading… refresh in a moment to see AI analysis.',
                'key_drivers': [],
                'ndx_outlook': '',
                'risk_factors': [],
                'trade_bias': '',
            },
            'pending': True,
        }
    # Stale-stale (>60min): refresh in bg, serve last known
    asyncio.create_task(_refresh_ai_sentiment_bg())
    return {**_ai_sentiment_cache, 'mode': 'live'}

# =====================
# ADMIN ENDPOINTS
# =====================

@api_router.post("/admin/refresh-sentiment")
async def admin_force_refresh_sentiment(user=Depends(get_admin_user)):
    """Admin: Force-regenerate AI sentiment immediately, bypassing cache TTL.
    Routes to weekly recap, daily recap, or live sentiment based on current market state."""
    global _ai_sentiment_cache, _ai_sentiment_cache_time, _ai_sentiment_refreshing
    import time as _time

    state = _market_state()

    # --- Weekend → regenerate weekly recap ---
    if state == 'weekend':
        week_key = _current_iso_week_key()
        _weekly_recap_cache.pop(week_key, None)  # clear so regeneration is forced
        try:
            result = await _generate_weekly_recap()
            if result.get('weekly_recap', {}).get('indexes') or result.get('weekly_recap', {}).get('top_gainers'):
                _weekly_recap_cache[week_key] = result
            logger.info(f"Admin force-refresh weekly recap {week_key} by {user['username']}")
            return {'status': 'success', 'message': 'Weekly recap refreshed.', 'mode': 'weekly_recap', 'generated_at': datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            logger.error(f"Admin force-refresh weekly recap failed: {e}")
            raise HTTPException(status_code=500, detail=f'Weekly recap refresh failed: {str(e)}')

    # --- After-hours → regenerate daily recap ---
    if state == 'after_hours':
        day_key = _current_trading_day_key()
        _daily_recap_cache.pop(day_key, None)  # clear so regeneration is forced
        try:
            result = await _generate_daily_recap()
            if result.get('daily_recap', {}).get('indexes') or result.get('daily_recap', {}).get('top_gainers'):
                _daily_recap_cache[day_key] = result
            logger.info(f"Admin force-refresh daily recap {day_key} by {user['username']}")
            return {'status': 'success', 'message': 'Daily recap refreshed.', 'mode': 'daily_recap', 'generated_at': datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            logger.error(f"Admin force-refresh daily recap failed: {e}")
            raise HTTPException(status_code=500, detail=f'Daily recap refresh failed: {str(e)}')

    # --- Live market hours → regenerate live sentiment ---
    if _ai_sentiment_refreshing:
        return {'status': 'already_refreshing', 'message': 'AI refresh already in progress. Check back in ~30 seconds.'}
    _ai_sentiment_refreshing = True
    try:
        result = await _generate_ai_sentiment()
        _ai_sentiment_cache = result
        _ai_sentiment_cache_time = _time.time()
        logger.info(f"Admin force-refresh live sentiment by {user['username']}")
        return {'status': 'success', 'message': 'AI sentiment refreshed and pushed to all users.', 'mode': 'live', 'generated_at': datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        logger.error(f"Admin force-refresh AI sentiment failed: {e}")
        raise HTTPException(status_code=500, detail=f'AI refresh failed: {str(e)}')
    finally:
        _ai_sentiment_refreshing = False


@api_router.post("/admin/reclassify-alerts")
async def admin_reclassify_alerts(user=Depends(get_admin_user)):
    """Admin: Re-run emoji detection on ALL alerts in the DB and update their type.
    Fixes historical imported alerts that were saved as 'signal' before emoji detection existed."""
    _BULLISH = {
        '🟢','✅','📈','⬆️','🚀','💚','🔝','🏆','💰','🤑','✔','🎯','🟩','▲','↑','🔼','💹','👍','🌙','⭐','🌟','💫',
    }
    _BEARISH = {
        '🔴','❌','📉','⬇️','💔','🛑','⛔','📛','🟥','▼','↓','🔽','🚨','⚠️','👎','💀','☠️','🩸','🆘',
    }

    def detect(text: str) -> str:
        if not text:
            return 'signal'
        import re as _re
        found_bearish = False
        for emoji in _BULLISH:
            if emoji in text:
                return 'bullish'
        for emoji in _BEARISH:
            if emoji in text:
                found_bearish = True
        if found_bearish:
            return 'bearish'
        # Keyword fallback for plain-text trading alerts
        _bkw = {'winner', 'winners', 'long', 'buy', 'buying', 'call', 'calls', 'bullish', 'breakout', 'bounce', 'squeeze', 'moon'}
        _rkw = {'loser', 'losers', 'short', 'sell', 'selling', 'put', 'puts', 'bearish', 'breakdown', 'dump', 'drop', 'crash'}
        text_lower = text.lower()
        for w in _re.findall(r'\b[a-z]+\b', text_lower):
            if w in _bkw:
                return 'bullish'
            if w in _rkw:
                found_bearish = True
        return 'bearish' if found_bearish else 'signal'

    alerts = await db.alerts.find({}, {'_id': 0, 'id': 1, 'message': 1, 'title': 1, 'type': 1}).to_list(None)
    updated = 0
    for alert in alerts:
        text = f"{alert.get('title','')} {alert.get('message','')}"
        new_type = detect(text)
        if new_type != alert.get('type'):
            await db.alerts.update_one({'id': alert['id']}, {'$set': {'type': new_type}})
            updated += 1

    logger.info(f"Admin reclassify-alerts: {updated}/{len(alerts)} alerts updated by {user['username']}")
    return {'status': 'success', 'total': len(alerts), 'updated': updated,
            'message': f'Re-classified {updated} of {len(alerts)} alerts based on emoji detection.'}


@api_router.post("/admin/broadcast")
async def broadcast_alert(data: AlertCreate, user=Depends(get_admin_user)):
    alert = {
        'id': str(uuid.uuid4()),
        'title': data.title,
        'message': data.message,
        'type': data.type,
        'ticker': data.ticker or 'NDX',
        'severity': 'high',
        'source': 'admin',
        'created_by': user['username'],
        'created_at': datetime.now(timezone.utc).isoformat(),
        'is_broadcast': True
    }
    await db.alerts.insert_one(alert)
    return {k: v for k, v in alert.items() if k != '_id'}

@api_router.get("/admin/stats")
async def get_stats(user=Depends(get_admin_user)):
    user_count = await db.users.count_documents({})
    alert_count = await db.alerts.count_documents({})
    message_count = await db.messages.count_documents({})
    video_count = await db.videos.count_documents({})
    return {'users': user_count, 'alerts': alert_count, 'messages': message_count, 'videos': video_count}

# =====================
# ACCOUNT DELETION
# =====================
@api_router.delete("/auth/account")
async def delete_account(user=Depends(get_current_user)):
    """Permanently delete user account and all associated data"""
    user_id = user['id']
    # Delete all user data
    await db.users.delete_one({'id': user_id})
    await db.watchlists.delete_many({'user_id': user_id})
    await db.push_tokens.delete_many({'user_id': user_id})
    await db.messages.delete_many({'author_id': user_id})
    logger.info(f"Account deleted: {user.get('email', user_id)}")
    return {'status': 'deleted', 'message': 'Your account and all associated data have been permanently deleted.'}

# =====================
# ADMIN: USER MANAGEMENT
# =====================
@api_router.get("/admin/users")
async def admin_list_users(user=Depends(get_admin_user)):
    """Admin: List all registered users"""
    users = await db.users.find({}, {'_id': 0, 'password_hash': 0}).sort('created_at', -1).to_list(500)
    return {'users': users, 'total': len(users)}

@api_router.post("/admin/users/{user_id}/revoke")
async def admin_revoke_user(user_id: str, user=Depends(get_admin_user)):
    """Admin: Revoke user access"""
    target = await db.users.find_one({'id': user_id})
    if not target:
        raise HTTPException(status_code=404, detail='User not found')
    if target.get('is_admin'):
        raise HTTPException(status_code=400, detail='Cannot revoke admin access')
    await db.users.update_one({'id': user_id}, {'$set': {'is_revoked': True, 'revoked_at': datetime.now(timezone.utc).isoformat(), 'revoked_by': user['id']}})
    # Remove push tokens for revoked user
    await db.push_tokens.delete_many({'user_id': user_id})
    logger.info(f"User revoked: {target.get('email', user_id)} by admin {user.get('email')}")
    return {'status': 'revoked', 'user_id': user_id}

@api_router.post("/admin/users/{user_id}/restore")
async def admin_restore_user(user_id: str, user=Depends(get_admin_user)):
    """Admin: Restore revoked user access"""
    target = await db.users.find_one({'id': user_id})
    if not target:
        raise HTTPException(status_code=404, detail='User not found')
    await db.users.update_one({'id': user_id}, {'$set': {'is_revoked': False}, '$unset': {'revoked_at': '', 'revoked_by': ''}})
    logger.info(f"User restored: {target.get('email', user_id)} by admin {user.get('email')}")
    return {'status': 'restored', 'user_id': user_id}

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, user=Depends(get_admin_user)):
    """Admin: Permanently delete a user"""
    target = await db.users.find_one({'id': user_id})
    if not target:
        raise HTTPException(status_code=404, detail='User not found')
    if target.get('is_admin'):
        raise HTTPException(status_code=400, detail='Cannot delete admin account')
    await db.users.delete_one({'id': user_id})
    await db.watchlists.delete_many({'user_id': user_id})
    await db.push_tokens.delete_many({'user_id': user_id})
    await db.messages.delete_many({'author_id': user_id})
    logger.info(f"User deleted by admin: {target.get('email', user_id)}")
    return {'status': 'deleted', 'user_id': user_id}

# === INCLUDE ROUTER & MIDDLEWARE ===
@api_router.get("/admin/discord/status")
async def get_discord_status(user=Depends(get_admin_user)):
    """Return current Discord bot health for the admin dashboard."""
    try:
        import discord_bot as _discord_bot
        return _discord_bot.STATE
    except Exception as e:
        return {'enabled': False, 'connected': False, 'last_error': str(e)}


# === DISCORD HISTORY IMPORT ===
DISCORD_EPOCH = 1420070400000
DISCORD_API_UA = 'DiscordBot (https://github.com/Rapptz/discord.py, 2.3.2)'

_discord_import_state: Dict[str, Any] = {
    'running': False,
    'imported': 0,
    'skipped': 0,
    'total_fetched': 0,
    'error': None,
    'started_at': None,
    'completed_at': None,
    'status': 'idle',  # idle | running | done | error
}


async def _fetch_discord_page(session, token: str, channel_id: str, before: Optional[str]) -> list:
    """Fetch up to 100 messages before a given snowflake ID, with rate-limit retry."""
    import aiohttp
    url = f'https://discord.com/api/v10/channels/{channel_id}/messages?limit=100'
    if before:
        url += f'&before={before}'
    headers = {'Authorization': f'Bot {token}', 'User-Agent': DISCORD_API_UA}
    try:
        async with session.get(url, headers=headers) as resp:
            if resp.status == 429:
                data = await resp.json()
                await asyncio.sleep(float(data.get('retry_after', 1)) + 0.1)
                return await _fetch_discord_page(session, token, channel_id, before)
            if resp.status != 200:
                text = await resp.text()
                logger.warning(f"Discord API {resp.status}: {text[:200]}")
                return []
            return await resp.json()
    except Exception as e:
        logger.error(f"Discord page fetch error: {e}")
        return []


async def _run_discord_import(token: str, channel_id: str, years_back: int = 2):
    """Background task: import all Discord messages from past N years into alerts collection."""
    global _discord_import_state
    import aiohttp
    from discord_bot import parse_message as _parse_msg

    _discord_import_state.update({
        'running': True, 'status': 'running', 'imported': 0,
        'skipped': 0, 'total_fetched': 0, 'error': None,
        'started_at': datetime.now(timezone.utc).isoformat(), 'completed_at': None,
    })

    cutoff_ms = int((datetime.now(timezone.utc) - timedelta(days=365 * years_back)).timestamp() * 1000)
    cutoff_snowflake = (cutoff_ms - DISCORD_EPOCH) << 22

    imported = skipped = total_fetched = 0
    before = None
    reached_cutoff = False

    try:
        async with aiohttp.ClientSession() as session:
            while not reached_cutoff:
                messages = await _fetch_discord_page(session, token, channel_id, before)
                if not messages:
                    break

                total_fetched += len(messages)
                _discord_import_state['total_fetched'] = total_fetched

                for msg in messages:
                    msg_id = msg.get('id', '')
                    try:
                        msg_id_int = int(msg_id)
                    except ValueError:
                        msg_id_int = 0

                    # Stop once we pass the 2-year cutoff
                    if msg_id_int and msg_id_int < cutoff_snowflake:
                        reached_cutoff = True
                        break

                    # Build text from content + embeds
                    parts = []
                    if msg.get('content'):
                        parts.append(msg['content'])
                    for emb in (msg.get('embeds') or []):
                        if emb.get('title'): parts.append(str(emb['title']))
                        if emb.get('description'): parts.append(str(emb['description']))
                        for f in (emb.get('fields') or []):
                            if f.get('name'): parts.append(str(f['name']))
                            if f.get('value'): parts.append(str(f['value']))
                    text = '\n'.join(p for p in parts if p).strip()

                    if not text:
                        skipped += 1
                        continue

                    # Dedup by Discord message ID
                    if await db.alerts.find_one({'discord_message_id': msg_id}):
                        skipped += 1
                        continue

                    parsed = _parse_msg(text)
                    ts_ms = (msg_id_int >> 22) + DISCORD_EPOCH if msg_id_int else 0
                    created_at = (
                        datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
                        if ts_ms else datetime.now(timezone.utc).isoformat()
                    )
                    alert_doc = {
                        'id': str(uuid.uuid4()),
                        'title': parsed['title'],
                        'message': text,
                        'type': 'info',
                        'ticker': parsed.get('ticker', 'NDX'),
                        'price': parsed.get('price'),
                        'severity': 'medium',
                        'source': 'discord',
                        'created_by': msg.get('author', {}).get('username', 'Discord'),
                        'created_at': created_at,
                        'discord_message_id': msg_id,
                    }
                    await db.alerts.insert_one(alert_doc)
                    imported += 1

                _discord_import_state['imported'] = imported
                _discord_import_state['skipped'] = skipped

                if not messages:
                    break
                before = messages[-1]['id']
                await asyncio.sleep(0.3)  # gentle rate limiting

        _discord_import_state.update({
            'status': 'done', 'imported': imported, 'skipped': skipped,
            'completed_at': datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Discord import complete: {imported} imported, {skipped} skipped")

    except Exception as e:
        _discord_import_state.update({'status': 'error', 'error': str(e)})
        logger.error(f"Discord history import failed: {e}")
    finally:
        _discord_import_state['running'] = False


@api_router.post("/admin/discord/import-history")
async def start_discord_import(user=Depends(get_admin_user)):
    """Start importing Discord channel history (last 2 years) as alerts. Runs in background."""
    global _discord_import_state
    if _discord_import_state.get('running'):
        return {'status': 'already_running', **_discord_import_state}

    token = os.environ.get('DISCORD_BOT_TOKEN', '').strip()
    channel_id = os.environ.get('DISCORD_ALERTS_CHANNEL_ID', '').strip()
    if not token or not channel_id:
        raise HTTPException(400, detail='DISCORD_BOT_TOKEN or DISCORD_ALERTS_CHANNEL_ID not configured')

    asyncio.create_task(_run_discord_import(token, channel_id, years_back=2))
    return {'status': 'started'}


@api_router.get("/admin/discord/import-status")
async def get_discord_import_status(user=Depends(get_admin_user)):
    """Return current Discord history import progress."""
    return _discord_import_state


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# =====================
# LEGAL PAGES (Public)
# =====================
PRIVACY_POLICY_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alerts Command - Privacy Policy</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e0e0e0;line-height:1.7}
h1{color:#00C805;font-size:28px;margin-bottom:4px}
h2{color:#00C805;font-size:18px;margin-top:32px;border-bottom:1px solid #222;padding-bottom:8px}
p,li{font-size:14px;color:#b0b0b0}
.updated{font-size:12px;color:#666;margin-bottom:32px}
a{color:#00C805}
</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p class="updated">Last updated: April 2026</p>

<h2>1. Introduction</h2>
<p>Alerts Command ("we", "our", "the App") is a trading intelligence platform that provides market data, alerts, and educational content for the Nasdaq-100 trading community. We respect your privacy and are committed to protecting your personal information.</p>

<h2>2. Information We Collect</h2>
<p><strong>Account Information:</strong> When you register, we collect your email address, username, and a securely hashed password.</p>
<p><strong>Usage Data:</strong> We collect information about how you interact with the App, including watchlist preferences and alert settings.</p>
<p><strong>Push Notification Tokens:</strong> If you enable push notifications, we store your device's push token to deliver trade alerts.</p>
<p>We do <strong>not</strong> collect financial account credentials, brokerage data, or payment information.</p>

<h2>3. How We Use Your Information</h2>
<ul>
<li>To provide and maintain the App's core functionality (market data, alerts, charts)</li>
<li>To send push notifications for trade alerts you have opted into</li>
<li>To personalize your experience (custom watchlists)</li>
<li>To improve the App through aggregated, anonymized usage analytics</li>
</ul>

<h2>4. Data Sharing</h2>
<p>We do <strong>not</strong> sell, trade, or rent your personal information to third parties. We may share data with:</p>
<ul>
<li><strong>Service Providers:</strong> Finnhub (market data), Expo (push notifications), and AI providers (anonymized market analysis) — only as needed to operate the App.</li>
</ul>

<h2>5. Data Storage & Security</h2>
<p>Your data is stored on secure, encrypted servers. Passwords are hashed using bcrypt and are never stored in plain text. We use JWT tokens for secure authentication.</p>

<h2>6. Your Rights</h2>
<p>You may request deletion of your account and associated data at any time by contacting us. You can disable push notifications through your device settings.</p>

<h2>7. Third-Party Services</h2>
<p>The App integrates with third-party market data providers (Finnhub, Yahoo Finance). These services have their own privacy policies that govern their data practices.</p>

<h2>8. Children's Privacy</h2>
<p>The App is not intended for users under 18 years of age. We do not knowingly collect information from minors.</p>

<h2>9. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. Changes will be posted within the App.</p>

<h2>10. Contact</h2>
<p>For privacy-related questions, contact us through the App's support channels.</p>
</body>
</html>"""

TERMS_OF_SERVICE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alerts Command - Terms of Service</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e0e0e0;line-height:1.7}
h1{color:#00C805;font-size:28px;margin-bottom:4px}
h2{color:#00C805;font-size:18px;margin-top:32px;border-bottom:1px solid #222;padding-bottom:8px}
p,li{font-size:14px;color:#b0b0b0}
.updated{font-size:12px;color:#666;margin-bottom:32px}
a{color:#00C805}
.warning{background:#1a1200;border:1px solid #332200;border-radius:8px;padding:12px 16px;margin:16px 0}
.warning p{color:#ffcc00;font-size:13px}
</style>
</head>
<body>
<h1>Terms of Service</h1>
<p class="updated">Last updated: April 2026</p>

<div class="warning"><p><strong>⚠️ Disclaimer:</strong> Alerts Command is an informational tool only. Nothing in this App constitutes financial advice. Always consult a licensed financial advisor before making investment decisions.</p></div>

<h2>1. Acceptance of Terms</h2>
<p>By using Alerts Command, you agree to be bound by these Terms of Service. If you do not agree, do not use the App.</p>

<h2>2. Description of Service</h2>
<p>Alerts Command provides real-time market data, trade alerts, AI-powered market analysis, educational content, and community tools for Nasdaq-100 traders.</p>

<h2>3. No Financial Advice</h2>
<p>All market data, AI sentiment analysis, suggested trends, and alerts provided by the App are for <strong>informational and educational purposes only</strong>. They do not constitute investment advice, financial advice, or trading recommendations.</p>

<h2>4. User Accounts</h2>
<p>You are responsible for maintaining the confidentiality of your account credentials. You must provide accurate information during registration.</p>

<h2>5. Acceptable Use</h2>
<p>You agree not to misuse the App, including but not limited to: reverse engineering, unauthorized access, distributing malware, or using the App for illegal purposes.</p>

<h2>6. Market Data</h2>
<p>Market data is provided by third-party sources (Finnhub, Yahoo Finance) and may be delayed or inaccurate. We do not guarantee the accuracy, completeness, or timeliness of any market data.</p>

<h2>7. Limitation of Liability</h2>
<p>Alerts Command shall not be liable for any financial losses, damages, or other liabilities arising from your use of the App or reliance on information provided within it.</p>

<h2>8. Termination</h2>
<p>We reserve the right to terminate or suspend your account at our discretion, without notice, for conduct that we believe violates these Terms.</p>

<h2>9. Changes to Terms</h2>
<p>We may modify these Terms at any time. Continued use of the App after changes constitutes acceptance of the updated Terms.</p>

<h2>10. Contact</h2>
<p>For questions about these Terms, contact us through the App's support channels.</p>
</body>
</html>"""

@app.get("/privacy-policy", response_class=HTMLResponse)
async def privacy_policy():
    return PRIVACY_POLICY_HTML

@app.get("/terms-of-service", response_class=HTMLResponse)
async def terms_of_service():
    return TERMS_OF_SERVICE_HTML

@app.get("/api/privacy-policy", response_class=HTMLResponse)
async def api_privacy_policy():
    return PRIVACY_POLICY_HTML

@app.get("/api/terms-of-service", response_class=HTMLResponse)
async def api_terms_of_service():
    return TERMS_OF_SERVICE_HTML

SUPPORT_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alerts Command - Support</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e0e0e0;line-height:1.7}
h1{color:#00C805;font-size:28px;margin-bottom:4px}
h2{color:#00C805;font-size:18px;margin-top:32px;border-bottom:1px solid #222;padding-bottom:8px}
p,li{font-size:14px;color:#b0b0b0}
.updated{font-size:12px;color:#666;margin-bottom:32px}
a{color:#00C805}
.faq{background:#111;border:1px solid #222;border-radius:12px;padding:16px 20px;margin:12px 0}
.faq h3{color:#fff;font-size:15px;margin:0 0 8px 0}
.faq p{margin:0;font-size:13px}
.contact-card{background:#0a1f0a;border:1px solid rgba(0,200,5,0.2);border-radius:12px;padding:20px;margin:16px 0;text-align:center}
.contact-card h3{color:#00C805;margin:0 0 8px 0}
</style>
</head>
<body>
<h1>Support Center</h1>
<p class="updated">Alerts Command — Trading Intelligence Platform</p>

<h2>Frequently Asked Questions</h2>

<div class="faq">
<h3>What is Alerts Command?</h3>
<p>Alerts Command is an independent, third-party trading intelligence app that provides real-time market data, trade alerts, AI-powered sentiment analysis, and educational content for Nasdaq-100 traders. We are NOT affiliated with, endorsed by, or connected to Nasdaq, Inc. or any stock exchange.</p>
</div>

<div class="faq">
<h3>How do I receive push notifications?</h3>
<p>Create an account, then enable push notifications in the Settings tab. You'll receive real-time trade alerts directly to your device.</p>
</div>

<div class="faq">
<h3>Is the market data real-time?</h3>
<p>We source data from Finnhub and Yahoo Finance. Most data is near real-time, though some may have a brief delay depending on the data provider.</p>
</div>

<div class="faq">
<h3>Is this financial advice?</h3>
<p>No. Alerts Command is an informational tool only. All market data, AI analysis, and alerts are for educational purposes. Always consult a licensed financial advisor before making investment decisions.</p>
</div>

<div class="faq">
<h3>How do I delete my account?</h3>
<p>Go to Settings in the app and tap "Delete My Account." This will permanently remove your account and all associated data including watchlists and push notification tokens.</p>
</div>

<div class="faq">
<h3>Can I use the app without an account?</h3>
<p>Yes! You can browse market data, charts, and news as a guest. An account is only needed to receive personalized alerts and manage a custom watchlist.</p>
</div>

<div class="contact-card">
<h3>Need More Help?</h3>
<p>Contact our support team at <a href="mailto:support@alertscommand.com">support@alertscommand.com</a></p>
<p style="margin-top:8px;font-size:12px;color:#666">We typically respond within 24-48 hours.</p>
</div>

<h2>App Information</h2>
<p><strong>Version:</strong> 1.0</p>
<p><strong>Platform:</strong> iOS</p>
<p><strong>Category:</strong> Finance</p>
<p>Alerts Command is an independent application. All trademarks belong to their respective owners.</p>
</body>
</html>"""

@app.get("/support", response_class=HTMLResponse)
async def support_page():
    return SUPPORT_HTML

@app.get("/api/support", response_class=HTMLResponse)
async def api_support_page():
    return SUPPORT_HTML

# === STARTUP ===


@app.on_event("startup")
async def startup():
    """Startup MUST return instantly so the /health probe works immediately.
    All DB seeding + warm-up happens in background tasks."""
    logger.info("Alerts Command backend startup: kicking off background init...")

    async def _background_init():
        # === Create DB indexes (idempotent — fast if already exist) ===
        try:
            await db.users.create_index("email", unique=True)
            await db.alerts.create_index([("created_at", -1)])
            await db.alerts.create_index("source")
            await db.alerts.create_index("ticker")
            await db.channels.create_index("slug", unique=True)
            await db.watchlist.create_index("user_id")
            await db.push_tokens.create_index("token", unique=True)
            await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
            logger.info("DB indexes ensured")
        except Exception as e:
            logger.error(f"Index creation issue: {e}")

        # === Seed admin (only if ADMIN_PASSWORD env var is set) ===
        admin_password = os.environ.get('ADMIN_PASSWORD', '')
        admin_email = os.environ.get('ADMIN_EMAIL', 'admin@alertscommand.com')
        if not admin_password:
            logger.warning(
                "ADMIN_PASSWORD not set — skipping admin seed. "
                "Set ADMIN_PASSWORD in your environment / deployment secrets to enable."
            )
        else:
            try:
                admin = await db.users.find_one({'email': admin_email})
                if not admin:
                    await db.users.insert_one({
                        'id': str(uuid.uuid4()),
                        'email': admin_email,
                        'username': 'Admin',
                        'password_hash': hash_password(admin_password),
                        'is_admin': True,
                        'created_at': datetime.now(timezone.utc).isoformat()
                    })
                    logger.info(f"Admin user seeded: {admin_email}")
                else:
                    # Rotate password if it changed (so updating the env var propagates)
                    await db.users.update_one(
                        {'email': admin_email},
                        {'$set': {
                            'password_hash': hash_password(admin_password),
                            'is_admin': True,
                        }}
                    )
                    logger.info(f"Admin password synced from env for {admin_email}")
            except Exception as e:
                logger.error(f"Admin seed failed: {e}")

        # Seed channels
        try:
            channel_defs = [
                ('general', 'General Market Chat', 'Open discussion about markets'),
                ('trade-alerts', 'Trade Alerts', 'Real-time trading alerts'),
                ('trade-ideas', 'Trade Ideas', 'Share and discuss trade setups'),
                ('macro-news', 'Macro News', 'Macro economic updates and analysis'),
                ('admin-announcements', 'Admin Announcements', 'Official announcements'),
            ]
            for slug, name, desc in channel_defs:
                existing = await db.channels.find_one({'slug': slug})
                if not existing:
                    await db.channels.insert_one({'id': str(uuid.uuid4()), 'slug': slug, 'name': name, 'description': desc})
        except Exception as e:
            logger.error(f"Channel seed failed: {e}")

        # Seed alerts
        try:
            alert_count = await db.alerts.count_documents({})
            if alert_count == 0:
                now = datetime.now(timezone.utc)
                seed_alerts = [
                    {'id': str(uuid.uuid4()), 'title': 'NDX ALERT: Bullish Divergence', 'message': 'Bullish divergence forming on RSI. Possible bounce from VWAP support.', 'type': 'bullish', 'ticker': 'NDX', 'severity': 'high', 'created_by': 'Admin', 'created_at': (now - timedelta(hours=2)).isoformat()},
                    {'id': str(uuid.uuid4()), 'title': 'NVDA: Breakout Watch', 'message': 'NVDA approaching key resistance at $148. Watch for volume confirmation.', 'type': 'bullish', 'ticker': 'NVDA', 'severity': 'medium', 'created_by': 'Admin', 'created_at': (now - timedelta(hours=5)).isoformat()},
                    {'id': str(uuid.uuid4()), 'title': 'TSLA: Support Test', 'message': 'Tesla testing 50-day moving average support. Bearish below $255.', 'type': 'bearish', 'ticker': 'TSLA', 'severity': 'medium', 'created_by': 'Admin', 'created_at': (now - timedelta(hours=8)).isoformat()},
                    {'id': str(uuid.uuid4()), 'title': 'Macro Alert: CPI Release Tomorrow', 'message': 'CPI data releasing tomorrow at 8:30 AM ET. Expect volatility.', 'type': 'info', 'ticker': '', 'severity': 'high', 'created_by': 'Admin', 'created_at': (now - timedelta(hours=12)).isoformat()},
                    {'id': str(uuid.uuid4()), 'title': 'QQQ: Key Level at $515', 'message': 'QQQ holding above $515 support. Bullish above, bearish breakdown below.', 'type': 'neutral', 'ticker': 'QQQ', 'severity': 'medium', 'created_by': 'Admin', 'created_at': (now - timedelta(hours=15)).isoformat()},
                ]
                await db.alerts.insert_many(seed_alerts)
                logger.info("Alerts seeded")
        except Exception as e:
            logger.error(f"Alert seed failed: {e}")

        logger.info("Alerts Command backend init complete")

        # === Pre-warm slow caches so first user request is instant ===
        # Lightweight Finnhub HTTP fetches run immediately.
        # Heavy in-process libraries (yfinance/pandas & LiteLLM/openai) are delayed 90s
        # so the K8s readiness probe registers the pod as healthy before RAM climbs.
        try:
            from datetime import datetime as _dt
            today = _dt.now(timezone.utc)
            ws = today.strftime('%Y-%m-%d')
            we = (today + timedelta(days=6)).strftime('%Y-%m-%d')
            ee = (today + timedelta(days=60)).strftime('%Y-%m-%d')
            ef = (today - timedelta(days=7)).strftime('%Y-%m-%d')
            if FINNHUB_KEY:
                asyncio.create_task(fetch_finnhub_economic_calendar(ws, we))
                asyncio.create_task(fetch_finnhub_earnings(ef, ee))
                asyncio.create_task(fetch_finnhub_news())
            logger.info("Pre-warm: lightweight caches kicked off in background")
        except Exception as e:
            logger.warning(f"Pre-warm (fast) failed: {e}")

        # Heavy pre-warm deferred — runs 90s after startup to keep baseline RAM low
        async def _deferred_heavy_prewarm():
            import gc, time as _prewarm_t
            await asyncio.sleep(90)
            try:
                logger.info("Pre-warm: starting deferred heavy caches (yfinance + AI)...")
                await _fetch_recent_earnings(days_back=14)
                gc.collect()
                # Warm the correct cache based on current market state
                prewarm_state = _market_state()
                if prewarm_state == 'weekend':
                    wk = _current_iso_week_key()
                    if wk not in _weekly_recap_cache:
                        res = await _generate_weekly_recap()
                        if res.get('weekly_recap', {}).get('indexes') or res.get('weekly_recap', {}).get('top_gainers'):
                            _weekly_recap_cache[wk] = res
                            logger.info(f"Pre-warm: weekly recap cached for {wk}")
                elif prewarm_state == 'after_hours':
                    dk = _current_trading_day_key()
                    if dk not in _daily_recap_cache:
                        res = await _generate_daily_recap()
                        if res.get('daily_recap', {}).get('indexes') or res.get('daily_recap', {}).get('top_gainers'):
                            _daily_recap_cache[dk] = res
                            logger.info(f"Pre-warm: daily recap cached for {dk}")
                else:
                    # Live hours — populate the live sentiment cache
                    res = await _generate_ai_sentiment()
                    if res.get('sentiment'):
                        _ai_sentiment_cache.update(res)
                        _ai_sentiment_cache_time = _prewarm_t.time()
                        logger.info("Pre-warm: live sentiment cached")
                gc.collect()
                logger.info("Pre-warm: deferred heavy caches complete")
            except Exception as e:
                logger.warning(f"Pre-warm (heavy/deferred) failed: {e}")

        asyncio.create_task(_deferred_heavy_prewarm())

        # === Start Discord bot (no-op if DISCORD_BOT_TOKEN not set or DISCORD_BOT_ENABLED=false) ===
        try:
            import discord_bot as _discord_bot

            async def _on_discord_message(parsed: dict):
                """Callback: Discord message → app alert + push notification"""
                alert = {
                    'id': str(uuid.uuid4()),
                    'title': parsed['title'],
                    'message': parsed['message'],
                    'type': parsed.get('type', 'signal'),
                    'ticker': parsed.get('ticker') or 'NDX',
                    'severity': 'high',
                    'source': 'discord',
                    'price': parsed.get('price'),
                    'created_by': 'Alerts Command',
                    'created_at': datetime.now(timezone.utc).isoformat(),
                }
                await db.alerts.insert_one(alert)
                try:
                    await send_push_notifications(alert['title'], alert['message'], alert['id'])
                except Exception as _pe:
                    logger.warning(f"Push after Discord alert failed: {_pe}")

            _discord_bot.start_bot(_on_discord_message)
        except Exception as e:
            logger.error(f"Discord bot startup error: {e}")

    # CRITICAL: don't await — let startup return immediately so /health probes work
    asyncio.create_task(_background_init())

@app.on_event("shutdown")
async def shutdown():
    try:
        import discord_bot as _discord_bot
        await _discord_bot.stop_bot()
    except Exception:
        pass
    mongo_client.close()
