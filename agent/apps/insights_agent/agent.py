"""Snug Insights Agent: answers store managers' questions about fit, sizing and stock using anonymous data."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google.adk.agents import Agent  # noqa: E402

from snug_core.llm import make_model, model_error_fallback  # noqa: E402
from google.adk.tools import ToolContext  # noqa: E402

from snug_core import insights  # noqa: E402
from snug_core.db import STORES, get_db  # noqa: E402


def _store(tool_context: ToolContext) -> str:
    return tool_context.state.get("store_id") or "BLR-07"


def get_fit_signals(tool_context: ToolContext, all_stores: bool = False) -> dict:
    """Per-style fit signals from try-on feedback: % who kept the recommended size, sized up, sized down,
    top complaint and a signal ("runs small", "runs large", "length issues", "true to size").

    Args:
      all_stores: true to include every store, false (default) for the manager's store only.
    """
    store = "" if all_stores else _store(tool_context)
    rows = insights.fit_signals(store)
    return {"store_id": store or "all", "styles": rows,
            "note": "History includes simulated demo feedback; live app feedback is added as it arrives."}


def get_impact(tool_context: ToolContext, hours: float = 24) -> dict:
    """Live impact of Snug in this store over the last N hours: tags scanned, wrong-size try-ons avoided,
    estimated trial-room trips saved, staff requests, rooms held."""
    return {"store_id": _store(tool_context), **insights.impact(_store(tool_context), hours)}


def get_stock(style_id: str, tool_context: ToolContext) -> dict:
    """Current stock by size for a style in this store and nearby stores."""
    g = get_db().get_garment(style_id)
    if not g:
        return {"error": f"Unknown style_id {style_id}"}
    return {"style_id": style_id, "name": g["name"], "stock_by_store": g.get("stock", {}),
            "store_names": {k: v["name"] for k, v in STORES.items()}}


INSTRUCTION = """
You are the Snug Insights Agent for store managers. You answer questions about how clothes fit shoppers,
which styles run small or large, and what to restock, using ONLY your tools.
- Use get_fit_signals for sizing patterns, get_impact for today's Snug impact, get_stock for stock.
- Give concrete, short answers with numbers, e.g. "Maroon Velvet Kurta runs small: 75% of 18 shoppers
  sized up. Stock is thin in L (2 left): move more units from M to L in the next order."
- Suggest practical actions: restock sizes, add a "runs small" note on the tag, check a style's specs
  with the supplier, or move stock between stores.
- Mention that feedback history includes simulated demo data when it matters.
- Data is anonymous; never speculate about individual shoppers.
"""

root_agent = Agent(
    name="snug_insights_agent",
    model=make_model(),
    on_model_error_callback=model_error_fallback,
    description="Answers store managers' questions about fit patterns, sizing signals, stock and Snug's impact.",
    instruction=INSTRUCTION,
    tools=[get_fit_signals, get_impact, get_stock],
)
