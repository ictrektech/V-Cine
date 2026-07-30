"""Mode handler registry.

Each mode module registers itself via register_mode() at import time.
Must import all mode modules here to trigger registration.
"""

import importlib
import pkgutil

REGISTRY = {}


class ModeHandler:
    """Base class for mode handlers."""

    name = ""
    help = ""

    def register(self, subparsers):
        """Add subparser arguments."""
        raise NotImplementedError

    def handle(self, args, config, api):
        """Execute mode and return TOON string."""
        raise NotImplementedError


def register_mode(handler):
    REGISTRY[handler.name] = handler


# Auto-import all mode modules to trigger register_mode() calls
__path__ = __path__  # make package discoverable
for _importer, _modname, _ispkg in pkgutil.iter_modules(__path__):
    if _modname != "__init__":
        importlib.import_module(f"{__name__}.{_modname}")
