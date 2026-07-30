"""CLI routing: argparse dispatch to mode handlers."""

import os
import sys
import traceback

import requests

from .config import Config
from .client import NowenAPI
from .modes import REGISTRY


def build_parser():
    import argparse

    p = argparse.ArgumentParser(
        prog="nowen_media_search",
        description="Search nowen-video media library.",
    )
    p.add_argument("--config", help="Config path")
    subs = p.add_subparsers(dest="cmd", required=True)
    for handler in REGISTRY.values():
        handler.register(subs)
    return p


def main():
    args = build_parser().parse_args()
    try:
        cfg = Config()
        if err := cfg.validate():
            print(err, file=sys.stderr)
            sys.exit(1)
        api = NowenAPI(cfg)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        handler = REGISTRY.get(args.cmd)
        if handler is None:
            print(f"Unknown command: {args.cmd}", file=sys.stderr)
            sys.exit(1)
        output = handler.handle(args, cfg, api)
        print(output)
    except requests.RequestException as e:
        print(f"Network: {e}", file=sys.stderr)
        if os.environ.get("NOWEN_DEBUG"):
            traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if os.environ.get("NOWEN_DEBUG"):
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
