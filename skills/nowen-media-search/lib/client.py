"""Nowen REST API client.

Wraps nowen-video backend REST API with API Key authentication.
All methods return parsed JSON dicts.
"""

import sys

import requests


class NowenAPI:
    """HTTP client for nowen-video REST API."""

    def __init__(self, cfg):
        self.url = cfg.url.rstrip("/")
        self.frontend_url = cfg.frontend_url.rstrip("/")
        self._s = requests.Session()
        self._s.headers.update({
            "Authorization": f"Bearer {cfg.api_key}",
            "Accept": "application/json",
        })
        self._s.timeout = (10, 60)

    def _api(self, method, path, **kw):
        url = f"{self.url}/api{path}"
        r = self._s.request(method, url, **kw)
        if r.status_code in (401, 403):
            print("Auth failed. Check API key.", file=sys.stderr)
            sys.exit(1)
        if r.status_code >= 400:
            try:
                d = r.json()
                d = d.get("message", d.get("error", str(d)))
            except Exception:
                d = r.text[:200]
            print(f"API error {r.status_code}: {d}", file=sys.stderr)
            sys.exit(1)
        return r

    def _get(self, p, **kw):
        return self._api("GET", p, params=kw.get("params")).json()

    # ---- health / ping ----

    def ping(self):
        """GET /api/health — server health check."""
        return self._api("GET", "/health").json()

    # ---- search ----

    def search(self, q, page=1, size=20):
        """GET /api/search — keyword search."""
        return self._get("/search", params={"q": q, "page": page, "size": size})

    def search_advanced(self, page=1, size=20, **filters):
        """GET /api/search/advanced — multi-condition search."""
        params = {"page": page, "size": size}
        params.update(self._clean_filters(filters))
        return self._get("/search/advanced", params=params)

    def search_mixed(self, q, page=1, size=20):
        """GET /api/search/mixed — mixed search (media + collections)."""
        return self._get("/search/mixed", params={"q": q, "page": page, "size": size})

    # ---- media ----

    def media_list(self, page=1, size=20, library_id=None):
        """GET /api/media — list media."""
        params = {"page": page, "size": size}
        if library_id:
            params["library_id"] = library_id
        return self._get("/media", params=params)

    def media_detail(self, media_id):
        """GET /api/media/:id — single media detail."""
        return self._get(f"/media/{media_id}")

    def media_detail_enhanced(self, media_id):
        """GET /api/media/:id/enhanced — enhanced detail with tech specs."""
        return self._get(f"/media/{media_id}/enhanced")

    # ---- series ----

    def series_list(self):
        """GET /api/series — list all series."""
        return self._get("/series")

    def series_detail(self, series_id):
        """GET /api/series/:id — single series detail."""
        return self._get(f"/series/{series_id}")

    # ---- persons ----

    def person_media(self, person_id):
        """GET /api/persons/:id/media — list media by person."""
        return self._get(f"/persons/{person_id}/media")

    # ---- smart search (AI) ----

    def smart_search(self, q):
        """GET /api/ai/search — AI-powered natural language search."""
        return self._get("/ai/search", params={"q": q})

    @staticmethod
    def _clean_filters(f):
        """Map Python-style filter names to API query parameters."""
        c = {}
        mapping = {
            "media_type": "type",
            "year_min": "year_min",
            "year_max": "year_max",
            "min_rating": "min_rating",
            "genre": "genre",
            "sort_by": "sort_by",
            "sort_order": "sort_order",
        }
        for k, v in f.items():
            if v is None or v == "" or v is False:
                continue
            c[mapping.get(k, k)] = v
        return c
