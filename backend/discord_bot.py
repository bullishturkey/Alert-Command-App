"""
Discord bot integration for Alerts Command.

- Listens to a single alerts channel (DISCORD_ALERTS_CHANNEL_ID)
- Forwards every new message as an app alert (same shape as webhook alerts)
- Triggers push notifications to all registered devices

Runs as a background asyncio task on FastAPI startup.
"""
import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, Awaitable

import discord

logger = logging.getLogger("server")

# --- Emoji → alert type detection ---
# These sets map common Discord emoji to bullish (green) or bearish (red)
_BULLISH_EMOJIS = {
    '🟢', '✅', '📈', '⬆️', '🚀', '💚', '🔝', '🏆', '💰', '🤑', '✔', '🎯',
    '🟩', '▲', '↑', '🔼', '💹', '👍', '🌙', '⭐', '🌟', '💫',
}
_BEARISH_EMOJIS = {
    '🔴', '❌', '📉', '⬇️', '💔', '🛑', '⛔', '📛', '🟥', '▼', '↓',
    '🔽', '🚨', '⚠️', '👎', '💀', '☠️', '🩸', '🆘',
}

# Text keyword fallback — catches plain-text trading alerts without emojis
_BULLISH_KEYWORDS = frozenset([
    'winner', 'winners', 'long', 'buy', 'buying', 'call', 'calls',
    'bullish', 'breakout', 'bounce', 'squeeze', 'rip', 'moon',
])
_BEARISH_KEYWORDS = frozenset([
    'loser', 'losers', 'short', 'sell', 'selling', 'put', 'puts',
    'bearish', 'breakdown', 'dump', 'drop', 'crash',
])


def _detect_alert_type(text: str) -> str:
    """Scan Discord message for colour emojis and trading keywords.
    bullish (green) wins over bearish (red). Falls back to 'signal' if nothing found."""
    found_bearish = False

    # 1. Character-level emoji scan (single-codepoint emojis)
    for ch in text:
        if ch in _BULLISH_EMOJIS:
            return 'bullish'
        if ch in _BEARISH_EMOJIS:
            found_bearish = True

    # 2. Substring scan (multi-codepoint sequences like ⬆️ = 2 code points)
    for emoji in _BULLISH_EMOJIS:
        if emoji in text:
            return 'bullish'
    for emoji in _BEARISH_EMOJIS:
        if emoji in text:
            found_bearish = True

    if found_bearish:
        return 'bearish'

    # 3. Keyword fallback — catches plain-text trading alerts with no emojis
    text_lower = text.lower()
    for word in re.findall(r'\b[a-z]+\b', text_lower):
        if word in _BULLISH_KEYWORDS:
            return 'bullish'
        if word in _BEARISH_KEYWORDS:
            found_bearish = True

    return 'bearish' if found_bearish else 'signal'


# Global state — exposed via /api/admin/discord/status
STATE = {
    'enabled': False,
    'connected': False,
    'last_error': None,
    'last_message_at': None,
    'total_forwarded': 0,
    'channel_id': None,
    'bot_username': None,
}

_bot_task: Optional[asyncio.Task] = None
_client: Optional[discord.Client] = None


# --- Message parsing ---
_TICKER_RE = re.compile(r'\$?\b([A-Z]{1,5})\b(?:\s*@)?')
_PRICE_RE = re.compile(r'(?:@\s*|at\s+)?\$?\s*([0-9][0-9,\.]*)')
# Known ticker whitelist — we only auto-extract these so "NEW", "CALL", "PUT" etc don't become tickers
_KNOWN_TICKERS = {
    'NDX', 'SPX', 'SPY', 'QQQ', 'IWM', 'DIA', 'VIX',
    'NVDA', 'MSFT', 'AAPL', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'AMD',
    'TSM', 'LLY', 'JPM', 'WMT', 'V', 'ORCL', 'XOM', 'MA', 'UNH', 'COST', 'HD',
    'NFLX', 'PG', 'JNJ', 'BAC', 'CRM', 'ADBE', 'QCOM', 'INTC', 'CSCO', 'IBM',
    'BRK', 'GME', 'AMC', 'PLTR', 'COIN', 'HOOD', 'MSTR', 'SMCI',
}


def parse_message(text: str) -> dict:
    """Extract ticker + price + title from free-text Discord message."""
    t = (text or '').strip()
    if not t:
        return {'title': 'Trade Alert', 'message': '', 'ticker': 'NDX', 'price': None}

    # First line or first 80 chars = title
    first_line = t.split('\n', 1)[0].strip()
    title = first_line[:120] if first_line else 'Trade Alert'

    # Extract ticker — look for a known symbol in the text (prefer $PREFIX, then bare word)
    ticker = None
    for m in _TICKER_RE.finditer(t.upper()):
        candidate = m.group(1)
        if candidate in _KNOWN_TICKERS:
            ticker = candidate
            break
    # If we found a root-ticker like "BRK" upgrade to BRK.B by default
    if ticker == 'BRK':
        ticker = 'BRK.B'

    # Extract price — first number that could be a reasonable price/level
    price = None
    for m in _PRICE_RE.finditer(t):
        raw = m.group(1).replace(',', '').strip()
        if not raw or raw == '.':
            continue
        try:
            val = float(raw)
        except ValueError:
            continue
        # Skip obvious garbage (years, dates, percentages under 10)
        if val < 0.1 or val > 1_000_000:
            continue
        price = f"{val:,.2f}" if val >= 100 else f"{val:.2f}"
        break

    return {
        'title': title,
        'message': t,
        'ticker': ticker or 'NDX',
        'price': price,
        'type': _detect_alert_type(t),
    }


async def _start_client(
    token: str,
    channel_id: int,
    on_message_callback: Callable[[dict], Awaitable[None]],
):
    """Boot the Discord client and run it until cancelled."""
    global _client
    intents = discord.Intents.default()
    intents.message_content = True  # Required to read message text

    _client = discord.Client(
        intents=intents,
        member_cache_flags=discord.MemberCacheFlags.none(),
        max_messages=0,
        chunk_guilds_at_startup=False,
    )

    @_client.event
    async def on_ready():
        STATE['connected'] = True
        STATE['last_error'] = None
        STATE['bot_username'] = f"{_client.user.name}#{_client.user.discriminator}" if _client.user else None
        STATE['channel_id'] = channel_id
        logger.info(f"Discord bot connected as {STATE['bot_username']} (watching channel {channel_id})")

    @_client.event
    async def on_disconnect():
        STATE['connected'] = False
        logger.warning("Discord bot disconnected")

    @_client.event
    async def on_message(msg: discord.Message):
        # Ignore self + wrong channel
        if msg.author.id == (_client.user.id if _client.user else 0):
            return
        if msg.channel.id != channel_id:
            return
        # Handle both plain content and embed messages (TradingView uses embeds)
        text_parts = []
        if msg.content:
            text_parts.append(msg.content)
        for emb in (msg.embeds or []):
            if emb.title:
                text_parts.append(str(emb.title))
            if emb.description:
                text_parts.append(str(emb.description))
            for field in (emb.fields or []):
                if field.name:
                    text_parts.append(str(field.name))
                if field.value:
                    text_parts.append(str(field.value))
        text = '\n'.join(p for p in text_parts if p).strip()
        if not text:
            return  # Nothing to forward (probably pure image/sticker)

        try:
            parsed = parse_message(text)
            parsed['_author'] = str(msg.author)
            await on_message_callback(parsed)
            STATE['total_forwarded'] += 1
            STATE['last_message_at'] = datetime.now(timezone.utc).isoformat()
            logger.info(f"Discord→App alert forwarded: {parsed['title'][:50]}")
        except Exception as e:
            logger.error(f"Discord message forwarding failed: {e}")
            STATE['last_error'] = str(e)

    try:
        await _client.start(token)
    except discord.LoginFailure as e:
        STATE['last_error'] = f"LoginFailure: invalid token. {e}"
        STATE['connected'] = False
        logger.error(f"Discord bot login failed: {e}")
    except Exception as e:
        STATE['last_error'] = str(e)
        STATE['connected'] = False
        logger.error(f"Discord bot crashed: {e}")


def start_bot(on_message_callback: Callable[[dict], Awaitable[None]]):
    """Kick off the Discord bot as a background task if env vars are set.
    No-op if token/channel are missing — safe to call on any deployment."""
    global _bot_task
    token = os.environ.get('DISCORD_BOT_TOKEN', '').strip()
    channel_id_raw = os.environ.get('DISCORD_ALERTS_CHANNEL_ID', '').strip()

    if not token or not channel_id_raw:
        logger.info("Discord bot disabled (DISCORD_BOT_TOKEN or DISCORD_ALERTS_CHANNEL_ID not set)")
        return
    # Allow operators to opt-out in multi-replica production deployments — Discord enforces
    # a single active gateway session per token, so multiple replicas cause endless reconnect
    # storms ("Cannot write to closing transport"). Set DISCORD_BOT_ENABLED=false in prod env
    # if you scale > 1 replica without leader election.
    enabled_flag = os.environ.get('DISCORD_BOT_ENABLED', 'true').strip().lower()
    if enabled_flag in ('false', '0', 'no', 'off'):
        logger.info("Discord bot disabled by DISCORD_BOT_ENABLED env var")
        return
    try:
        channel_id = int(channel_id_raw)
    except ValueError:
        logger.error(f"Invalid DISCORD_ALERTS_CHANNEL_ID: {channel_id_raw}")
        return

    STATE['enabled'] = True

    async def _supervisor():
        # Reconnect loop with exponential backoff. Capped at 5 min to avoid log spam
        # when Discord rejects (e.g. due to another replica holding the session).
        consecutive_failures = 0
        max_failures_before_giveup = 10
        while True:
            try:
                await _start_client(token, channel_id, on_message_callback)
                consecutive_failures = 0  # reset on clean run
            except Exception as e:
                consecutive_failures += 1
                logger.error(f"Discord bot supervisor caught (failure {consecutive_failures}): {e}")
            # If we keep failing, this replica likely shouldn't be running the bot — back off hard
            if consecutive_failures >= max_failures_before_giveup:
                logger.error(f"Discord bot giving up after {consecutive_failures} consecutive failures. Set DISCORD_BOT_ENABLED=false to silence.")
                STATE['last_error'] = "Repeatedly failing — likely another replica holds the session"
                await asyncio.sleep(300)  # 5 min cooldown
                consecutive_failures = 0  # try again later
            else:
                # Exponential backoff: 10s, 20s, 40s, 80s ... capped at 5 min
                delay = min(10 * (2 ** (consecutive_failures - 1)), 300)
                await asyncio.sleep(delay)

    _bot_task = asyncio.create_task(_supervisor())


async def stop_bot():
    """Gracefully close the Discord connection on shutdown."""
    global _bot_task, _client
    if _client is not None:
        try:
            await _client.close()
        except Exception:
            pass
    if _bot_task is not None:
        _bot_task.cancel()
        try:
            await _bot_task
        except (asyncio.CancelledError, Exception):
            pass
    _client = None
    _bot_task = None
