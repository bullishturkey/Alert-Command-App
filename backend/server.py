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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# === CONFIG ===
mongo_url = os.environ['MONGO_URL']
db_name = os.environ.get('DB_NAME', 'ndx_command')
FINNHUB_KEY = os.environ.get('FINNHUB_API_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'ndx-command-jwt-secret-2026-secure')

# === APP SETUP ===
app = FastAPI(title="NDX Command API")
api_router = APIRouter(prefix="/api")
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[db_name]

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
@api_router.get("/market/quotes")
async def get_all_quotes(user=Depends(get_current_user)):
    global _quote_cache, _quote_cache_time
    import time
    now = time.time()
    if now - _quote_cache_time < CACHE_TTL and _quote_cache:
        return {'quotes': list(_quote_cache.values()), 'cached': True}
    quotes = []
    for symbol in TRACKED_SYMBOLS:
        if symbol in ('NDX',):
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
    if symbol not in TRACKED_SYMBOLS:
        raise HTTPException(status_code=404, detail=f'Symbol {symbol} not tracked')
    quote = await fetch_finnhub_quote(symbol)
    if not quote:
        quote = generate_mock_quote(symbol)
    quote['sparkline'] = generate_mock_sparkline(symbol)
    return quote

@api_router.get("/market/candles/{symbol}")
async def get_candles(symbol: str, resolution: str = 'D', count: int = 100, user=Depends(get_current_user)):
    symbol = symbol.upper()
    candles = await fetch_finnhub_candles(symbol, resolution, count)
    if not candles:
        candles = generate_mock_candles(symbol, resolution, count)
    return candles

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
# ALERT ENDPOINTS
# =====================
@api_router.get("/alerts")
async def get_alerts(user=Depends(get_current_user)):
    alerts = await db.alerts.find({}, {'_id': 0}).sort('created_at', -1).to_list(100)
    return {'alerts': alerts}

@api_router.post("/alerts")
async def create_alert(data: AlertCreate, user=Depends(get_admin_user)):
    alert = {
        'id': str(uuid.uuid4()),
        'title': data.title,
        'message': data.message,
        'type': data.type,
        'ticker': data.ticker,
        'severity': data.severity,
        'created_by': user['username'],
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    await db.alerts.insert_one(alert)
    return {k: v for k, v in alert.items() if k != '_id'}

@api_router.post("/alerts/webhook")
async def webhook_alert(body: dict = Body(...)):
    alert = {
        'id': str(uuid.uuid4()),
        'title': body.get('title', 'Webhook Alert'),
        'message': body.get('message', ''),
        'type': body.get('type', 'info'),
        'ticker': body.get('ticker', ''),
        'severity': body.get('severity', 'medium'),
        'created_by': 'Webhook',
        'created_at': datetime.now(timezone.utc).isoformat()
    }
    await db.alerts.insert_one(alert)
    return {'status': 'ok', 'alert_id': alert['id']}

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
        'ticker': data.ticker,
        'severity': 'high',
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
    return {'users': user_count, 'alerts': alert_count, 'messages': message_count}

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
