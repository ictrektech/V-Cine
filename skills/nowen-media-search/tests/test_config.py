"""Tests for config loading and validation."""

import os

import pytest
import yaml

from lib.config import Config


class TestConfigDefaults:
    """Config with no env vars or yaml files."""

    def test_default_url(self):
        """Default URL should be localhost:38080."""
        c = Config()
        assert c.url == "http://localhost:38080"

    def test_default_page_size(self):
        assert Config().page_size == 20

    def test_default_language(self):
        assert Config().language == "zh"


class TestConfigFromEnv:
    """Config loaded from environment variables."""

    def test_url_from_env(self, monkeypatch):
        monkeypatch.setenv("VCINE_URL", "http://example.com:9090")
        assert Config().url == "http://example.com:9090"

    def test_api_key_from_env(self, monkeypatch):
        monkeypatch.setenv("VCINE_API_KEY", "nk_mysecret123")
        assert Config().api_key == "nk_mysecret123"

    def test_frontend_url_from_env(self, monkeypatch):
        monkeypatch.setenv("VCINE_FRONTEND_URL", "http://frontend.example.com")
        assert Config().frontend_url == "http://frontend.example.com"

    def test_env_takes_priority(self, monkeypatch):
        """Env var should override default url."""
        monkeypatch.setenv("VCINE_URL", "http://custom:1234")
        assert Config().url == "http://custom:1234"


class TestConfigValidation:

    def test_validate_empty_key(self):
        """Config without api_key should return error."""
        c = Config()
        c.api_key = ""
        err = c.validate()
        assert err is not None
        assert "API key" in err

    def test_validate_with_key(self):
        """Config with api_key should return None."""
        c = Config()
        c.api_key = "nk_test"
        assert c.validate() is None
