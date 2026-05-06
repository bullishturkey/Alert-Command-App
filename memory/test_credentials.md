# Test Credentials — Alerts Command

## Admin Account
- **Email**: `admin@alertscommand.com`
- **Password**: `AlertsAdmin2026`

Password is now loaded from `ADMIN_PASSWORD` env var in `/app/backend/.env`.
If `ADMIN_PASSWORD` is unset, admin seeding is skipped entirely.

## Webhook Secret (for TradingView / Pipedream)
- **Header**: `X-Webhook-Secret: hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV`
- Also accepted: `Authorization: Bearer hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV`
- Stored in backend `.env` as `WEBHOOK_SECRET`.
