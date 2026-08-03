"""Configuration management for nowen-media-search."""

import os
import sys
from typing import Optional

import yaml

from .utils import deep_merge

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONFIG_FILES = [
    os.path.join(SCRIPT_DIR, "config.yaml"),
]

DEFAULT_URL = "http://localhost:38080"
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
DEFAULT_LANG = "zh"


class Config:
    """Load config from env vars and yaml files.

    Priority: environment variable > config.yaml > default value.
    """

    def __init__(self) -> None:
        raw = self._load_raw()
        ncfg = raw.get("nowen", {})
        scfg = raw.get("search", {})

        self.url = (
            os.environ.get("NOWEN_URL") or ncfg.get("url") or DEFAULT_URL
        ).rstrip("/")
        self.frontend_url = (
            os.environ.get("NOWEN_FRONTEND_URL") or ncfg.get("frontend_url", "")
        ).rstrip("/")
        self.api_key = os.environ.get("NOWEN_API_KEY") or ncfg.get("api_key", "")
        self.page_size = int(scfg.get("default_page_size", DEFAULT_PAGE_SIZE))
        self.max_page_size = int(scfg.get("max_page_size", MAX_PAGE_SIZE))
        self.language = scfg.get("language", DEFAULT_LANG)

    @staticmethod
    def _load_raw() -> dict:
        m = {}
        for p in CONFIG_FILES:
            p = os.path.realpath(p)
            if not os.path.isfile(p):
                continue
            try:
                with open(p, encoding="utf-8") as f:
                    d = yaml.safe_load(f) or {}
                m = deep_merge(m, d)
            except Exception as e:
                print(f"Config warn {p}: {e}", file=sys.stderr)
        return m

    def validate(self) -> Optional[str]:
        """Return an error message if config is invalid, or None."""
        if not self.api_key:
            return (
                "Nowen API key not configured.\n"
                "  Set $NOWEN_API_KEY env var, or\n"
                f"  Create {CONFIG_FILES[0]} with:\n"
                "    nowen:\n"
                "      api_key: nk_your_key_here"
            )
        return None
