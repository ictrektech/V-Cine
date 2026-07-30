"""explore mode - browse series, collections, persons."""

from toon import encode as toon_encode

from . import register_mode


class ExploreMode:
    name = "explore"
    help = "Browse series, collections, and persons"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument("--mode", choices=["series", "collections", "persons"],
                        default="series",
                        help="Browse mode (default: series)")
        sp.add_argument("--id", help="Item UUID (for single-item detail)")
        sp.add_argument("--page", type=int, default=1, help="Page number")
        sp.add_argument("--size", type=int, default=20, help="Page size")

    def handle(self, args, config, api):
        mode = args.mode or "series"

        if mode == "series":
            return self._browse_series(api, args)
        elif mode == "collections":
            return self._browse_collections(api, args)
        elif mode == "persons":
            return self._browse_persons(api, args)
        else:
            return toon_encode({"mode": "explore", "error": f"unknown mode: {mode}"})

    def _browse_series(self, api, args):
        if args.id:
            resp = api.series_detail(args.id)
            data = resp.get("data", {})
            return toon_encode({
                "mode": "explore",
                "type": "series",
                "id": args.id,
                "title": data.get("title", ""),
                "year": data.get("year", "-"),
                "season_count": data.get("season_count", 0),
                "media_count": data.get("media_count", 0),
                "overview": data.get("overview", ""),
            })
        resp = api.series_list()
        items = resp.get("data", [])
        results = []
        for s in items:
            results.append({
                "id": s.get("id", ""),
                "title": s.get("title", ""),
                "year": s.get("year", "-"),
                "season_count": s.get("season_count", 0),
                "media_count": s.get("media_count", 0),
            })
        return toon_encode({
            "mode": "explore",
            "type": "series",
            "total": resp.get("total", len(items)),
            "results": results,
        })

    def _browse_collections(self, api, args):
        resp = api._get("/collections",
                        params={"page": args.page, "size": args.size})
        items = resp.get("data", [])
        results = []
        for c in items:
            results.append({
                "id": c.get("id", ""),
                "title": c.get("title", ""),
                "media_count": c.get("media_count", 0),
            })
        return toon_encode({
            "mode": "explore",
            "type": "collections",
            "total": resp.get("total", len(items)),
            "results": results,
        })

    def _browse_persons(self, api, args):
        if args.id:
            try:
                resp = api.person_media(args.id)
            except SystemExit:
                return toon_encode({
                    "mode": "explore",
                    "type": "persons",
                    "id": args.id,
                    "error": "person not found",
                })
            media = resp.get("media", [])
            return toon_encode({
                "mode": "explore",
                "type": "persons",
                "id": args.id,
                "media": [{
                    "id": m.get("id", ""),
                    "title": m.get("title", ""),
                    "year": m.get("year", "-"),
                    "type": m.get("media_type", ""),
                } for m in media],
            })
        # List all persons indirectly via media persons
        return toon_encode({
            "mode": "explore",
            "type": "persons",
            "hint": "use --id <person_id> to view a person's works",
            "results": [],
        })


register_mode(ExploreMode())
