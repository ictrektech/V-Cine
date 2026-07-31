"""search mode — keyword, advanced, and mixed search."""

from toon import encode as toon_encode

from . import register_mode


class SearchMode:
    name = "search"
    help = "Search media by keyword / advanced filters / mixed"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument("--keyword", "-k", help="Search keyword")
        sp.add_argument("--advanced", "-a", action="store_true",
                        help="Advanced search with filters")
        sp.add_argument("--mixed", "-m", nargs="?", const=True, default=False,
                        help="Mixed search (media + collections). "
                             "Optional value: --mixed \"query\"")
        sp.add_argument("--smart", nargs="?", const=True, default=False,
                        help="AI-powered natural language search. "
                             "Optional value: --smart \"query\"")
        sp.add_argument("--type", choices=["movie", "episode"],
                        help="Media type filter (advanced)")
        sp.add_argument("--genre", help="Genre filter (advanced)")
        sp.add_argument("--year-min", type=int, help="Minimum year")
        sp.add_argument("--year-max", type=int, help="Maximum year")
        sp.add_argument("--rating", type=float,
                        help="Minimum rating 0-10 (advanced)")
        sp.add_argument("--sort-by",
                        choices=["relevance", "rating_desc", "year_desc", "year_asc"],
                        default="relevance", help="Sort order")
        sp.add_argument("--page", type=int, default=1, help="Page number")
        sp.add_argument("--size", type=int, default=20, help="Page size")

    def handle(self, args, config, api):
        page = args.page or 1
        size = min(args.size or config.page_size, config.max_page_size)

        # --smart/--mixed accept an optional inline query: --smart "query".
        # Falls back to --keyword when invoked bare: --smart --keyword "query".
        # Enabled = flag passed (bare or with a value); a bare True or an empty
        # inline query "" must still enter its branch and fall back below.
        smart_enabled = args.smart is not False
        mixed_enabled = args.mixed is not False
        smart_q = args.smart if isinstance(args.smart, str) else None
        mixed_q = args.mixed if isinstance(args.mixed, str) else None

        if smart_enabled:
            return self._smart_search(api, smart_q or args.keyword, page, size)
        if args.advanced:
            return self._advanced_search(api, args, page, size)
        if mixed_enabled:
            return self._mixed_search(api, mixed_q or args.keyword, page, size)
        return self._keyword_search(api, args.keyword, page, size)

    def _keyword_search(self, api, keyword, page, size):
        if not keyword:
            return toon_encode({
                "mode": "search",
                "error": "keyword required (use --keyword or --help)",
            })
        resp = api.search(keyword, page=page, size=size)
        return self._build_result("search", keyword, resp, page)

    def _advanced_search(self, api, args, page, size):
        filters = {}
        for f in ("type", "genre", "year_min", "year_max", "rating", "sort_by"):
            v = getattr(args, f, None)
            if v not in (None, "", "relevance"):
                filters[f] = v
        filters["sort_order"] = "desc"

        resp = api.search_advanced(page=page, size=size, **filters)
        keyword = args.keyword or ""
        return self._build_result("search_advanced", keyword, resp, page)

    def _mixed_search(self, api, keyword, page, size):
        if not keyword:
            return toon_encode({
                "mode": "search_mixed",
                "error": "keyword required for mixed search",
            })
        resp = api.search_mixed(keyword, page=page, size=size)
        return self._build_mixed_result(keyword, resp, page)

    def _smart_search(self, api, keyword, page, size):
        if not keyword:
            return toon_encode({
                "mode": "search_smart",
                "error": "keyword required for smart search",
            })
        resp = api.smart_search(keyword)
        items = resp.get("data", resp.get("results", []))
        if isinstance(items, list):
            items = items[:size]
        total = len(items)
        return toon_encode({
            "mode": "search_smart",
            "query": keyword,
            "total": total,
            "page": page,
            "results": items,
        })

    @staticmethod
    def _extract_media_items(resp):
        """Extract media items from various response shapes."""
        data = resp.get("data", resp)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", data.get("items", data.get("results", [])))
        return []

    @staticmethod
    def _build_result(mode, keyword, resp, page):
        items = SearchMode._extract_media_items(resp)
        total = resp.get("total", len(items))
        results = []
        for m in items:
            results.append({
                "id": m.get("id", ""),
                "title": m.get("title", m.get("name", "")),
                "year": m.get("year", "-"),
                "type": m.get("media_type", m.get("type", "-")),
                "rating": m.get("rating", "-"),
                "genres": m.get("genres", ""),
            })
        return toon_encode({
            "mode": mode,
            "query": keyword,
            "total": total,
            "page": page,
            "results": results,
        })

    @staticmethod
    def _build_mixed_result(keyword, resp, page):
        media = resp.get("media", [])
        series = resp.get("series", [])
        media_total = resp.get("media_total", len(media))
        series_total = resp.get("series_total", len(series))
        results = []
        for m in media:
            results.append({
                "id": m.get("id", ""),
                "title": m.get("title", ""),
                "year": m.get("year", "-"),
                "type": "movie",
                "rating": m.get("rating", "-"),
            })
        for s in series:
            results.append({
                "id": s.get("id", ""),
                "title": s.get("title", ""),
                "year": s.get("year", "-"),
                "type": "series",
                "rating": s.get("rating", "-"),
            })
        return toon_encode({
            "mode": "search_mixed",
            "query": keyword,
            "total": media_total + series_total,
            "media_total": media_total,
            "series_total": series_total,
            "page": page,
            "results": results,
        })


register_mode(SearchMode())
