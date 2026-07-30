"""detail mode - get single media asset metadata."""

from toon import encode as toon_encode

from . import register_mode


class DetailMode:
    name = "detail"
    help = "Get single media asset detail and metadata"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument("--id", required=True, help="Media UUID")
        sp.add_argument("--enhanced", "-e", action="store_true",
                        help="Get enhanced detail with tech specs")

    def handle(self, args, config, api):
        media_id = args.id

        try:
            if args.enhanced:
                resp = api.media_detail_enhanced(media_id)
            else:
                resp = api.media_detail(media_id)
        except SystemExit:
            return toon_encode({
                "mode": "detail",
                "id": media_id,
                "error": "media not found",
            })

        data = resp.get("data", resp)
        if not data or not isinstance(data, dict):
            return toon_encode({
                "mode": "detail",
                "id": media_id,
                "error": "media not found",
            })

        result = {
            "mode": "detail",
            "id": data.get("id", media_id),
            "title": data.get("title", ""),
            "orig_title": data.get("orig_title", ""),
            "year": data.get("year", "-"),
            "type": data.get("media_type", ""),
            "rating": data.get("rating", "-"),
            "genres": data.get("genres", ""),
            "overview": data.get("overview", ""),
            "runtime": data.get("runtime", 0),
            "country": data.get("country", ""),
            "language": data.get("language", ""),
            "studio": data.get("studio", ""),
            "premiered": data.get("premiered", ""),
            "tags": data.get("tags", ""),
            "resolution": data.get("resolution", ""),
            "duration_sec": data.get("duration", 0),
            "file_size": data.get("file_size", 0),
            "video_codec": data.get("video_codec", ""),
            "audio_codec": data.get("audio_codec", ""),
            "scrape_status": data.get("scrape_status", ""),
        }
        return toon_encode(result)


register_mode(DetailMode())
