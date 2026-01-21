#!/usr/bin/env python3
"""Run a scripted browser flow and capture screenshots.

Spec format (JSON):
{
  "url": "https://spark.eviworld.com/",
  "viewport": {"width": 1440, "height": 900},
  "fullPage": true,
  "timeoutMs": 30000,
  "headless": true,
  "steps": [
    {"action": "waitFor", "selector": "text=LOGIN"},
    {"action": "screenshot", "path": "01-landing.png"},
    {"action": "click", "selector": "text=LOGIN"},
    {"action": "screenshot", "path": "02-after-login-click.png", "afterMs": 100},
    {"action": "clickText", "text": "Continue with Google"},
    {"action": "screenshot", "path": "03-after-google-click.png", "afterMs": 100}
  ]
}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


class SpecError(ValueError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a scripted web flow using Playwright and capture screenshots.",
    )
    parser.add_argument(
        "--spec",
        required=True,
        help="Path to JSON spec describing the flow",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Base directory for relative screenshot paths (default: spec dir)",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run with a visible browser window",
    )
    parser.add_argument(
        "--slowmo",
        type=int,
        default=None,
        help="Slow down Playwright actions by N ms",
    )
    return parser.parse_args()


def load_spec(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SpecError(f"invalid JSON spec: {exc}") from exc
    if not isinstance(raw, dict):
        raise SpecError("spec must be a JSON object")
    return raw


def require_key(spec: dict[str, Any], key: str, expected_type: type) -> Any:
    value = spec.get(key)
    if not isinstance(value, expected_type):
        raise SpecError(f"spec.{key} must be {expected_type.__name__}")
    return value


def resolve_path(path: str, base_dir: Path) -> Path:
    out = Path(path)
    if not out.is_absolute():
        out = base_dir / out
    return out


def click_by_text(page, text: str, timeout_ms: int) -> None:
    locator = page.get_by_role("button", name=text)
    if locator.count() > 0:
        locator.first.click(timeout=timeout_ms)
        return
    locator = page.get_by_role("link", name=text)
    if locator.count() > 0:
        locator.first.click(timeout=timeout_ms)
        return
    locator = page.get_by_text(text)
    if locator.count() > 0:
        locator.first.click(timeout=timeout_ms)
        return
    raise PlaywrightTimeoutError(f"No element found matching text: {text}")


def maybe_wait(page, ms: int | None) -> None:
    if ms is None:
        return
    if ms <= 0:
        return
    page.wait_for_timeout(ms)


def run() -> int:
    args = parse_args()
    spec_path = Path(args.spec).expanduser().resolve()
    if not spec_path.exists():
        print(f"spec not found: {spec_path}", file=sys.stderr)
        return 2

    try:
        spec = load_spec(spec_path)
        url = require_key(spec, "url", str)
        steps = require_key(spec, "steps", list)
    except SpecError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    viewport = spec.get("viewport", {"width": 1440, "height": 900})
    if not isinstance(viewport, dict):
        print("error: spec.viewport must be an object", file=sys.stderr)
        return 2
    width = viewport.get("width", 1440)
    height = viewport.get("height", 900)
    if not isinstance(width, int) or not isinstance(height, int):
        print("error: spec.viewport width/height must be integers", file=sys.stderr)
        return 2

    timeout_ms = spec.get("timeoutMs", 30000)
    if not isinstance(timeout_ms, int):
        print("error: spec.timeoutMs must be an integer", file=sys.stderr)
        return 2

    full_page = bool(spec.get("fullPage", False))
    headless = bool(spec.get("headless", True))
    wait_until = spec.get("waitUntil", "networkidle")
    if wait_until not in ("load", "domcontentloaded", "networkidle", "commit"):
        print("error: spec.waitUntil must be load|domcontentloaded|networkidle|commit", file=sys.stderr)
        return 2
    slow_mo = spec.get("slowMoMs")
    if args.slowmo is not None:
        slow_mo = args.slowmo

    if args.headed:
        headless = False

    base_dir = Path(args.out_dir).expanduser().resolve() if args.out_dir else spec_path.parent

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless, slow_mo=slow_mo)
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            page.goto(url, wait_until=wait_until, timeout=timeout_ms)

            for raw_step in steps:
                if not isinstance(raw_step, dict):
                    raise SpecError("each step must be an object")
                action = raw_step.get("action")
                if not isinstance(action, str):
                    raise SpecError("step.action must be a string")

                if action == "waitFor":
                    selector = raw_step.get("selector")
                    if not isinstance(selector, str):
                        raise SpecError("waitFor requires selector")
                    page.wait_for_selector(selector, timeout=timeout_ms)
                    maybe_wait(page, raw_step.get("afterMs"))
                elif action == "click":
                    selector = raw_step.get("selector")
                    if not isinstance(selector, str):
                        raise SpecError("click requires selector")
                    no_wait = bool(raw_step.get("noWaitAfter", False))
                    page.click(selector, timeout=timeout_ms, no_wait_after=no_wait)
                    maybe_wait(page, raw_step.get("afterMs"))
                elif action == "clickText":
                    text = raw_step.get("text")
                    if not isinstance(text, str):
                        raise SpecError("clickText requires text")
                    no_wait = bool(raw_step.get("noWaitAfter", False))
                    if no_wait:
                        locator = page.get_by_role("button", name=text)
                        if locator.count() > 0:
                            locator.first.click(timeout=timeout_ms, no_wait_after=True)
                        else:
                            locator = page.get_by_role("link", name=text)
                            if locator.count() > 0:
                                locator.first.click(timeout=timeout_ms, no_wait_after=True)
                            else:
                                locator = page.get_by_text(text)
                                if locator.count() > 0:
                                    locator.first.click(timeout=timeout_ms, no_wait_after=True)
                                else:
                                    raise PlaywrightTimeoutError(
                                        f"No element found matching text: {text}"
                                    )
                    else:
                        click_by_text(page, text, timeout_ms)
                    maybe_wait(page, raw_step.get("afterMs"))
                elif action == "sleep":
                    sleep_ms = raw_step.get("ms")
                    if not isinstance(sleep_ms, int):
                        raise SpecError("sleep requires ms")
                    page.wait_for_timeout(sleep_ms)
                elif action == "screenshot":
                    path = raw_step.get("path")
                    if not isinstance(path, str):
                        raise SpecError("screenshot requires path")
                    maybe_wait(page, raw_step.get("afterMs"))
                    out_path = resolve_path(path, base_dir)
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(out_path), full_page=full_page)
                    print(f"Saved screenshot: {out_path}")
                elif action == "goto":
                    next_url = raw_step.get("url")
                    if not isinstance(next_url, str):
                        raise SpecError("goto requires url")
                    page.goto(next_url, wait_until=wait_until, timeout=timeout_ms)
                    maybe_wait(page, raw_step.get("afterMs"))
                else:
                    raise SpecError(f"unknown action: {action}")

            context.close()
            browser.close()
    except SpecError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except PlaywrightTimeoutError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(run())
