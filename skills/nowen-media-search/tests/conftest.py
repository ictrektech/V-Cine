"""pytest fixtures for nowen-media-search tests."""

import os
import re
import sys
from unittest.mock import Mock, patch

import pytest
import yaml

# Ensure lib/ is on the path (uv run pytest from project root)
_this_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_this_dir)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from lib.config import Config
from lib.client import NowenAPI
from lib.modes import REGISTRY
from lib.formatters import encode as toon_encode


# ── Helpers ──


def _load_local_config():
    """Read api_key from config.yaml if no env var set."""
    if "VCINE_API_KEY" in os.environ:
        return
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.yaml"
    )
    if not os.path.isfile(config_path):
        return
    with open(config_path) as f:
        content = f.read()
    m = re.search(r'api_key:\s*"([^"]+)"', content)
    if m:
        os.environ.setdefault("VCINE_API_KEY", m.group(1))


# ── Fixtures ──


@pytest.fixture
def config():
    """Return a Config instance with test defaults."""
    c = Config()
    # Override to avoid loading real config.yaml during unit tests
    c.url = "http://localhost:38080"
    c.api_key = os.environ.get("VCINE_API_KEY", "nk_test_key_for_unit")
    c.frontend_url = ""
    c.page_size = 20
    c.max_page_size = 100
    c.language = "zh"
    return c


@pytest.fixture
def api(config):
    """Return a NowenAPI instance (unit tests should mock HTTP)."""
    return NowenAPI(config)


@pytest.fixture
def mock_api():
    """Return a MagicMock-based fake API for testing mode handlers."""
    mock = Mock(spec=NowenAPI)
    mock.url = "http://localhost:38080"
    mock.frontend_url = ""
    return mock


@pytest.fixture(params=sorted(REGISTRY.keys()))
def mode(request):
    """Parametrized fixture: yields each registered mode handler."""
    return REGISTRY[request.param]


@pytest.fixture
def sample_media():
    """A realistic media dict mimicking the backend response."""
    return {
        "id": "2589729f-5f7f-4bec-a5d3-c7b8ef0cf7ba",
        "title": "肖申克的救赎",
        "orig_title": "The Shawshank Redemption",
        "year": 1994,
        "media_type": "movie",
        "rating": 8.7,
        "genres": "剧情,犯罪",
        "overview": "安迪·杜佛兰被错判谋杀妻子...",
        "runtime": 142,
        "country": "US",
        "language": "en",
        "studio": "Castle Rock",
        "premiered": "1994-09-23",
        "tags": "剧情,犯罪",
        "resolution": "480p",
        "duration": 203.414,
        "file_size": 6420941,
        "video_codec": "av1",
        "audio_codec": "aac",
        "scrape_status": "scraped",
    }


# ── Auto-load local config (runs once per session) ──

_load_local_config()
