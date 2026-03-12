import pytest
import requests
import os

@pytest.fixture(scope="session")
def base_url():
    return os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')

@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="session")
def admin_token(base_url):
    """Login as admin and return token for protected endpoint tests"""
    resp = requests.post(f"{base_url}/api/auth/login", json={
        "email": "admin@ndxcommand.com",
        "password": "admin123"
    })
    if resp.status_code == 200:
        return resp.json()['token']
    pytest.skip("Admin login failed, skipping protected endpoint tests")

@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
