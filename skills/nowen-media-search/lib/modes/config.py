"""config mode — show config or test server connectivity."""

from toon import encode as toon_encode

from . import register_mode


class ConfigMode:
    name = "config"
    help = "Show configuration or test server connectivity"

    def register(self, subparsers):
        sp = subparsers.add_parser(self.name, help=self.help)
        sp.add_argument("--test", action="store_true", help="Test API connectivity")

    def handle(self, args, config, api):
        result = {
            "mode": "config",
            "url": config.url,
            "frontend_url": config.frontend_url,
            "api_key": config.api_key[:11] + "..." if config.api_key else "",
            "page_size": config.page_size,
            "language": config.language,
        }
        if args.test:
            try:
                info = api.ping()
                result["status"] = "ok"
                result["server"] = info.get("server_name", info.get("version", "unknown"))
                result["version"] = info.get("version", "")
            except Exception as e:
                result["status"] = "error"
                result["error"] = str(e)
        return toon_encode(result)


register_mode(ConfigMode())
