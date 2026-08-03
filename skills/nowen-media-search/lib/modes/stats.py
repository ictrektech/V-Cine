"""stats mode - count media assets with optional filters."""

from toon import encode as toon_encode

from . import register_mode


class StatsMode:
    name = "stats"
    help = "Count media assets (total, by type, by filters)"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument("--type", choices=["movie", "episode"],
                        help="Media type filter (movie/episode)")
        sp.add_argument("--genre", help="Genre filter")
        sp.add_argument("--year-min", type=int, help="Minimum year")
        sp.add_argument("--year-max", type=int, help="Maximum year")
        sp.add_argument("--rating", type=float, help="Minimum rating")

    def handle(self, args, config, api):
        filters = {}
        for f in ("type", "genre", "year_min", "year_max", "rating"):
            v = getattr(args, f, None)
            if v not in (None, "", 0, 0.0):
                filters[f] = v

        # Use search_advanced with size=1 to get total count
        resp = api.search_advanced(page=1, size=1, **filters)
        total = resp.get("total", 0)

        filters_display = " + ".join(f"{k}={v}" for k, v in filters.items()) or "none"
        label = filters.get("type", "ALL")

        # Also get total library count for context
        all_resp = api.media_list(page=1, size=1)
        library_total = all_resp.get("total", 0)

        result = {
            "mode": "stats",
            "total": total,
            "type": label,
            "filters": filters_display,
            "library_total": library_total,
        }
        return toon_encode(result)


register_mode(StatsMode())
