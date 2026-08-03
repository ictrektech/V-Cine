"""scene mode — semantic scene search (video analysis)."""

from toon import encode as toon_encode

from . import register_mode


class SceneMode:
    name = "scene"
    help = "Semantic scene search (video analysis embeddings)"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument(
            "query", nargs="?", default=None, help='Search text (e.g. "雨夜追逐")'
        )
        sp.add_argument(
            "--mode",
            choices=["text", "image"],
            default="image",
            help="image (default): match scene visuals; text: match scene descriptions",
        )
        sp.add_argument(
            "--limit", type=int, default=20, help="Max results (default 20)"
        )
        sp.add_argument(
            "--task-id",
            default=None,
            help="List all scenes of an analysis task instead",
        )

    def handle(self, args, config, api):
        if args.task_id:
            return self._scene_list(api, args.task_id)
        return self._scene_search(api, args.query, args.mode, args.limit)

    def _scene_search(self, api, query, mode, limit):
        if not query:
            return toon_encode(
                {
                    "mode": "scene",
                    "error": 'query required (e.g. scene "雨夜追逐")',
                }
            )
        try:
            resp = api.scene_search(query, limit=limit, mode=mode)
        except SystemExit:
            return toon_encode(
                {
                    "mode": "scene",
                    "query": query,
                    "total": 0,
                    "error": "request failed or server unavailable",
                }
            )
        items = resp.get("data", resp.get("results", []))
        if not isinstance(items, list):
            items = []
        total = len(items)
        results = []
        for s in items:
            # 格式化时间：将秒数转换为 HH:MM:SS
            start = self._format_time(s.get("start_time", 0))
            end = self._format_time(s.get("end_time", 0))
            results.append(
                {
                    "scene_index": s.get("scene_index", -1),
                    "start_time": start,
                    "end_time": end,
                    "description": s.get("description", ""),
                    "media_id": s.get("media_id", ""),
                    "media_title": s.get("media_title", ""),
                }
            )
        return toon_encode(
            {
                "mode": "scene",
                "query": query,
                "search_mode": mode,
                "total": total,
                "results": results,
            }
        )

    def _format_time(self, seconds):
        """将秒数转换为 HH:MM:SS 格式"""
        if isinstance(seconds, str):
            return seconds
        seconds = int(float(seconds) if seconds else 0)
        hours, seconds = divmod(seconds, 3600)
        minutes, secs = divmod(seconds, 60)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"

    def _scene_list(self, api, task_id):
        try:
            resp = api.scene_list(task_id)
        except SystemExit:
            return toon_encode(
                {
                    "mode": "scene_list",
                    "task_id": task_id,
                    "error": "request failed or server unavailable",
                }
            )
        items = resp.get("scenes", resp.get("data", []))
        if not isinstance(items, list):
            items = []
        total = len(items)
        results = []
        for s in items:
            results.append(
                {
                    "scene_index": s.get("scene_index", -1),
                    "start_time": s.get("start_time", ""),
                    "end_time": s.get("end_time", ""),
                    "description": s.get("description", ""),
                    "status": s.get("status", ""),
                }
            )
        return toon_encode(
            {
                "mode": "scene_list",
                "task_id": task_id,
                "total": total,
                "results": results,
            }
        )


register_mode(SceneMode())
