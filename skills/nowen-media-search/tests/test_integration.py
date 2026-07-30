"""Integration tests — require a live nowen-video backend.

Skipped unless NOWEN_API_KEY is set.
"""

import os

import pytest

from lib.config import Config
from lib.client import NowenAPI
from lib.modes import REGISTRY

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOWEN_API_KEY"),
    reason="requires $NOWEN_API_KEY (config.yaml auto-loaded via conftest)",
)


@pytest.fixture(scope="module")
def live_api():
    """One-time live API client for integration tests."""
    c = Config()
    return NowenAPI(c)


class TestLiveConfig:
    def test_ping(self, live_api):
        info = live_api.ping()
        assert info.get("status") == "ok"
        assert info.get("version")


class TestLiveSearch:

    def test_keyword_search(self, live_api):
        resp = live_api.search("肖申克")
        items = resp.get("data", [])
        assert isinstance(items, list)
        if items:
            assert items[0].get("title")

    def test_advanced_search(self, live_api):
        resp = live_api.search_advanced(page=1, size=5, media_type="movie")
        assert resp.get("total", 0) >= 0
        assert isinstance(resp.get("data"), list)


class TestLiveMedia:

    def test_media_list(self, live_api):
        resp = live_api.media_list(page=1, size=3)
        assert resp.get("total", 0) >= 0
        items = resp.get("data", [])
        if items:
            # pick first item for detail test
            mid = items[0]["id"]
            detail = live_api.media_detail(mid)
            assert detail.get("data", {}).get("id") == mid


class TestLiveStats:
    """Stats mode end-to-end via mode handler."""

    def test_stats_total(self, live_api, config):
        handler = REGISTRY["stats"]
        args = MockArgs(type=None, genre=None, year_min=None,
                        year_max=None, rating=None)
        output = handler.handle(args, config, live_api)
        assert "total:" in output
        assert "library_total:" in output


# ── Helpers ──


class MockArgs:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
