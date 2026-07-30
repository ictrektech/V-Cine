"""Tests for all mode handlers (argparse + output shape).

Uses mock API to avoid backend dependency.
"""

import pytest
from toon import encode as toon_encode

from lib.modes import REGISTRY


class TestConfigMode:
    """config mode: display config / health check."""

    def test_help(self):
        """--help should show --test flag."""
        handler = REGISTRY["config"]
        assert handler.name == "config"
        assert handler.help

    def test_config_output_shape(self, mock_api, config):
        """Output should contain all expected fields."""
        handler = REGISTRY["config"]
        args = MockArgs(test=False)
        output = handler.handle(args, config, mock_api)
        assert "mode: config" in output
        assert "url:" in output
        assert "api_key:" in output

    def test_ping_ok(self, mock_api, config):
        """--test should produce status: ok when API responds."""
        mock_api.ping.return_value = {
            "status": "ok",
            "version": "1.2.8",
            "server_name": "test-server",
        }
        handler = REGISTRY["config"]
        args = MockArgs(test=True)
        output = handler.handle(args, config, mock_api)
        assert "status: ok" in output
        assert "server: test-server" in output

    def test_ping_fail(self, mock_api, config):
        """--test should gracefully handle API errors."""
        mock_api.ping.side_effect = Exception("Connection refused")
        handler = REGISTRY["config"]
        args = MockArgs(test=True)
        output = handler.handle(args, config, mock_api)
        assert "status: error" in output


class TestSearchMode:
    """search mode: keyword / advanced / mixed / smart."""

    def test_help(self):
        handler = REGISTRY["search"]
        assert handler.name == "search"

    def test_no_keyword_returns_error(self, mock_api, config):
        """search without --keyword should return TOON error."""
        handler = REGISTRY["search"]
        args = MockArgs(keyword=None, advanced=False, mixed=False, smart=False,
                        type=None, genre=None, year_min=None, year_max=None,
                        rating=None, sort_by="relevance", page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "error" in output

    def test_keyword_search_output(self, mock_api, config):
        """keyword search should produce proper TOON."""
        mock_api.search.return_value = {
            "data": [
                {"id": "1", "title": "Test", "year": 2020,
                 "media_type": "movie", "rating": 7.5, "genres": "Action"}
            ],
            "total": 1,
        }
        handler = REGISTRY["search"]
        args = MockArgs(keyword="test", advanced=False, mixed=False, smart=False,
                        type=None, genre=None, year_min=None, year_max=None,
                        rating=None, sort_by="relevance", page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "mode: search" in output
        assert "total: 1" in output
        assert "Test" in output

    def test_advanced_search(self, mock_api, config):
        """advanced search passes filters to API."""
        mock_api.search_advanced.return_value = {
            "data": [{"id": "1", "title": "Sci-Fi Movie", "year": 2022,
                      "media_type": "movie", "rating": 8, "genres": "科幻"}],
            "total": 1,
        }
        handler = REGISTRY["search"]
        args = MockArgs(keyword=None, advanced=True, mixed=False, smart=False,
                        type="movie", genre="科幻", year_min=2020, year_max=None,
                        rating=7, sort_by="rating_desc", page=1, size=10)
        output = handler.handle(args, config, mock_api)
        assert "mode: search_advanced" in output
        assert "Sci-Fi Movie" in output
        # Verify that the filters were passed through to the API call
        mock_api.search_advanced.assert_called_once()

    def test_mixed_search(self, mock_api, config):
        """mixed search should combine media + series."""
        mock_api.search_mixed.return_value = {
            "media": [{"id": "m1", "title": "Matrix"}],
            "series": [],
            "media_total": 1,
            "series_total": 0,
        }
        handler = REGISTRY["search"]
        args = MockArgs(keyword="matrix", advanced=False, mixed=True, smart=False,
                        type=None, genre=None, year_min=None, year_max=None,
                        rating=None, sort_by="relevance", page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "mode: search_mixed" in output
        assert "Matrix" in output

    def test_smart_search(self, mock_api, config):
        """AI smart search should call smart_search on API."""
        mock_api.smart_search.return_value = {
            "data": [{"id": "1", "title": "Inception", "year": 2010}]
        }
        handler = REGISTRY["search"]
        args = MockArgs(keyword="sci-fi movie", advanced=False, mixed=False, smart=True,
                        type=None, genre=None, year_min=None, year_max=None,
                        rating=None, sort_by="relevance", page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "mode: search_smart" in output
        mock_api.smart_search.assert_called_once_with("sci-fi movie")


class TestStatsMode:
    """stats mode: count media assets."""

    def test_help(self):
        handler = REGISTRY["stats"]
        assert handler.name == "stats"

    def test_stats_output_shape(self, mock_api, config):
        """Should contain mode, total, type, filters."""
        mock_api.search_advanced.return_value = {"total": 5}
        mock_api.media_list.return_value = {"total": 42}
        handler = REGISTRY["stats"]
        args = MockArgs(type=None, genre=None, year_min=None,
                        year_max=None, rating=None)
        output = handler.handle(args, config, mock_api)
        assert "mode: stats" in output
        assert "total: 5" in output
        assert "library_total: 42" in output

    def test_stats_with_type_filter(self, mock_api, config):
        """--type movie should filter by type."""
        mock_api.search_advanced.return_value = {"total": 3}
        mock_api.media_list.return_value = {"total": 42}
        handler = REGISTRY["stats"]
        args = MockArgs(type="movie", genre=None, year_min=None,
                        year_max=None, rating=None)
        output = handler.handle(args, config, mock_api)
        assert "filters: type=movie" in output


class TestDetailMode:
    """detail mode: single media metadata."""

    def test_help(self):
        handler = REGISTRY["detail"]
        assert handler.name == "detail"

    def test_detail_output_shape(self, mock_api, config, sample_media):
        """Should include all metadata fields."""
        mock_api.media_detail.return_value = {"data": sample_media}
        handler = REGISTRY["detail"]
        args = MockArgs(id="abc-123", enhanced=False)
        output = handler.handle(args, config, mock_api)
        assert "mode: detail" in output
        assert "title: 肖申克的救赎" in output
        assert "year: 1994" in output
        assert "rating: 8.7" in output

    def test_detail_not_found(self, mock_api, config):
        """Unknown ID should return error in TOON."""
        mock_api.media_detail.side_effect = SystemExit(1)
        handler = REGISTRY["detail"]
        args = MockArgs(id="nonexistent", enhanced=False)
        output = handler.handle(args, config, mock_api)
        assert "error" in output
        assert "not found" in output or "error" in output

    def test_detail_enhanced(self, mock_api, config, sample_media):
        """--enhanced should call media_detail_enhanced."""
        mock_api.media_detail_enhanced.return_value = {"data": sample_media}
        handler = REGISTRY["detail"]
        args = MockArgs(id="abc-123", enhanced=True)
        handler.handle(args, config, mock_api)
        mock_api.media_detail_enhanced.assert_called_once_with("abc-123")


class TestExploreMode:
    """explore mode: browse series / collections / persons."""

    def test_help(self):
        handler = REGISTRY["explore"]
        assert handler.name == "explore"

    def test_series_list(self, mock_api, config):
        mock_api.series_list.return_value = {
            "data": [
                {"id": "s1", "title": "Test Series",
                 "season_count": 3, "media_count": 24}
            ],
            "total": 1,
        }
        handler = REGISTRY["explore"]
        args = MockArgs(mode="series", id=None, page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "type: series" in output
        assert "Test Series" in output

    def test_collections_list(self, mock_api, config):
        mock_api._get.return_value = {
            "data": [{"id": "c1", "title": "Collection 1", "media_count": 3}],
            "total": 1,
        }
        handler = REGISTRY["explore"]
        args = MockArgs(mode="collections", id=None, page=1, size=20)
        output = handler.handle(args, config, mock_api)
        assert "type: collections" in output
        assert "Collection 1" in output


# ── Helpers ──


class MockArgs:
    """Simple argparse.Namespace stand-in.

    Usage: MockArgs(keyword="test", advanced=True, ...)
    """

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
