"""NDX Command - Trading Intelligence Platform Backend"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Body, Query
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
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# === CONFIG ===
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'ndx_command')
FINNHUB_KEY = os.environ.get('FINNHUB_API_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'ndx-command-jwt-secret-2026-secure')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', '')

# === APP SETUP ===
app = FastAPI(title="NDX Command API")
api_router = APIRouter(prefix="/api")
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[db_name]
_executor = ThreadPoolExecutor(max_workers=2)

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
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')

async def get_admin_user(user=Depends(get_current_user)):
    if not user.get('is_admin'):
        raise HTTPException(status_code=403, detail='Admin access required')
    return user

# === YFINANCE NDX FETCHER ===
def _fetch_ndx_yfinance() -> Optional[dict]:
    """Fetch live NDX quote using yfinance (runs in thread pool)"""
    try:
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
async def fetch_finnhub_quote(symbol: str) -> Optional[dict]:
    if not FINNHUB_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/quote', params={'symbol': symbol, 'token': FINNHUB_KEY})
            if resp.status_code == 200:
                data = resp.json()
                if data.get('c', 0) > 0:
                    info = TRACKED_SYMBOLS.get(symbol, {'name': symbol, 'sector': ''})
                    return {
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
    except Exception as e:
        logger.warning(f"Finnhub quote error for {symbol}: {e}")
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
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/news', params={'category': category, 'token': FINNHUB_KEY})
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning(f"Finnhub news error: {e}")
    return None

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
async def get_ndx_live(user=Depends(get_current_user)):
    """Fast NDX-only endpoint with 5s cache for real-time tracking"""
    quote = await fetch_ndx_quote()
    if not quote:
        quote = generate_mock_quote('NDX')
    return quote

@api_router.get("/market/quotes")
async def get_all_quotes(user=Depends(get_current_user)):
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
async def get_quote(symbol: str, user=Depends(get_current_user)):
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
async def get_candles(symbol: str, resolution: str = 'D', count: int = 100, user=Depends(get_current_user)):
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
async def get_news(user=Depends(get_current_user)):
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
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get('https://finnhub.io/api/v1/calendar/earnings', params={
                'from': from_date, 'to': to_date, 'token': FINNHUB_KEY
            })
            if resp.status_code == 200:
                data = resp.json()
                tracked = {'NVDA','MSFT','AAPL','AMZN','META','TSLA','AMD','AVGO','GOOGL'}
                return [e for e in data.get('earningsCalendar', []) if e.get('symbol') in tracked]
    except Exception as e:
        logger.warning(f"Finnhub earnings error: {e}")
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
    """Daily preflight briefing: economic calendar, earnings, breaking news"""
    now = datetime.now(timezone.utc)
    today_str = now.strftime('%Y-%m-%d')
    
    # 1. Economic events this week
    economic_events = get_economic_events_for_week(now)
    
    # 2. Check DB for any admin-added economic events
    db_events = await db.economic_events.find(
        {'date': {'$gte': today_str}}, {'_id': 0}
    ).sort('date', 1).to_list(20)
    
    # Merge DB events with generated ones
    all_events = economic_events + db_events
    all_events.sort(key=lambda x: x.get('date', ''))
    
    # 3. Earnings calendar from Finnhub (next 30 days)
    end_date = (now + timedelta(days=30)).strftime('%Y-%m-%d')
    earnings = await fetch_finnhub_earnings(today_str, end_date)
    earnings_list = []
    for e in earnings:
        earnings_list.append({
            'symbol': e.get('symbol', ''),
            'date': e.get('date', ''),
            'hour': e.get('hour', ''),
            'epsEstimate': e.get('epsEstimate'),
            'revenueEstimate': e.get('revenueEstimate'),
            'epsActual': e.get('epsActual'),
            'revenueActual': e.get('revenueActual'),
        })
    
    # 4. Breaking news (most recent Finnhub news)
    finnhub_news = await fetch_finnhub_news()
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
    """Get NDX trading alerts - only from webhook pipeline and admin"""
    alerts = await db.alerts.find(
        {'source': {'$in': ['webhook', 'pipedream', 'tradingview', 'admin']}},
        {'_id': 0}
    ).sort('created_at', -1).to_list(100)
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

@api_router.post("/alerts/webhook")
async def webhook_alert(body: dict = Body(...)):
    """
    Webhook for TradingView → Pipedream → NDX Command.
    
    Your Pipedream sends the TradingView alert text as "content".
    This is typically the NDX price point at time of alert.
    
    Expected payload from Pipedream:
    {"content": "24,580.50"}  or  {"content": "NDX at 24,580 - support bounce"}
    
    Also accepts:
    {"text": "..."}  or  {"price": "24580"}  or  {"title": "...", "message": "..."}
    """
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
        'type': 'signal',
        'ticker': 'NDX',
        'severity': 'high',
        'source': 'pipedream',
        'price': price,
        'created_by': 'TradingView',
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
async def get_channels(user=Depends(get_current_user)):
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
async def get_videos(category: str = '', user=Depends(get_current_user)):
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
async def get_video_categories(user=Depends(get_current_user)):
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
async def get_multi_quotes(symbols: str = '', user=Depends(get_current_user)):
    """Fetch quotes for a list of comma-separated symbols"""
    if not symbols:
        return {'quotes': []}
    symbol_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    quotes = []
    for sym in symbol_list:
        if sym == 'NDX':
            quote = await fetch_ndx_quote()
            if not quote:
                quote = generate_mock_quote(sym)
        else:
            quote = await fetch_finnhub_quote(sym)
            if not quote:
                # Try to generate a basic quote for unknown symbols
                quote = generate_mock_quote(sym)
        quote['sparkline'] = generate_mock_sparkline(sym)
        quotes.append(quote)
    return {'quotes': quotes}

# =====================
# ADMIN ENDPOINTS
# =====================
@api_router.get("/admin/users")
async def get_users(user=Depends(get_admin_user)):
    users = await db.users.find({}, {'_id': 0, 'password_hash': 0}).to_list(500)
    return {'users': users}

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, user=Depends(get_admin_user)):
    result = await db.users.delete_one({'id': user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='User not found')
    return {'status': 'deleted'}

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

# === INCLUDE ROUTER & MIDDLEWARE ===
app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# === STARTUP ===
@app.on_event("startup")
async def startup():
    # Seed admin
    admin = await db.users.find_one({'email': 'admin@ndxcommand.com'})
    if not admin:
        await db.users.insert_one({
            'id': str(uuid.uuid4()),
            'email': 'admin@ndxcommand.com',
            'username': 'NDX Admin',
            'password_hash': hash_password('admin123'),
            'is_admin': True,
            'created_at': datetime.now(timezone.utc).isoformat()
        })
        logger.info("Admin user seeded")

    # Seed channels
    channel_defs = [
        ('general', 'General Market Chat', 'Open discussion about markets'),
        ('ndx-alerts', 'NDX Alerts', 'Real-time NDX trading alerts'),
        ('trade-ideas', 'Trade Ideas', 'Share and discuss trade setups'),
        ('macro-news', 'Macro News', 'Macro economic updates and analysis'),
        ('admin-announcements', 'Admin Announcements', 'Official announcements'),
    ]
    for slug, name, desc in channel_defs:
        existing = await db.channels.find_one({'slug': slug})
        if not existing:
            await db.channels.insert_one({'id': str(uuid.uuid4()), 'slug': slug, 'name': name, 'description': desc})

    # Seed alerts
    alert_count = await db.alerts.count_documents({})
    if alert_count == 0:
        now = datetime.now(timezone.utc)
        seed_alerts = [
            {'id': str(uuid.uuid4()), 'title': 'NDX ALERT: Bullish Divergence', 'message': 'Bullish divergence forming on RSI. Possible bounce from VWAP support.', 'type': 'bullish', 'ticker': 'NDX', 'severity': 'high', 'created_by': 'NDX Admin', 'created_at': (now - timedelta(hours=2)).isoformat()},
            {'id': str(uuid.uuid4()), 'title': 'NVDA: Breakout Watch', 'message': 'NVDA approaching key resistance at $148. Watch for volume confirmation.', 'type': 'bullish', 'ticker': 'NVDA', 'severity': 'medium', 'created_by': 'NDX Admin', 'created_at': (now - timedelta(hours=5)).isoformat()},
            {'id': str(uuid.uuid4()), 'title': 'TSLA: Support Test', 'message': 'Tesla testing 50-day moving average support. Bearish below $255.', 'type': 'bearish', 'ticker': 'TSLA', 'severity': 'medium', 'created_by': 'NDX Admin', 'created_at': (now - timedelta(hours=8)).isoformat()},
            {'id': str(uuid.uuid4()), 'title': 'Macro Alert: CPI Release Tomorrow', 'message': 'CPI data releasing tomorrow at 8:30 AM ET. Expect volatility.', 'type': 'info', 'ticker': '', 'severity': 'high', 'created_by': 'NDX Admin', 'created_at': (now - timedelta(hours=12)).isoformat()},
            {'id': str(uuid.uuid4()), 'title': 'QQQ: Key Level at $515', 'message': 'QQQ holding above $515 support. Bullish above, bearish breakdown below.', 'type': 'neutral', 'ticker': 'QQQ', 'severity': 'medium', 'created_by': 'NDX Admin', 'created_at': (now - timedelta(hours=15)).isoformat()},
        ]
        await db.alerts.insert_many(seed_alerts)
        logger.info("Alerts seeded")

    logger.info("NDX Command backend started successfully")

@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()
