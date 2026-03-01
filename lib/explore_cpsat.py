#!/usr/bin/env python3
"""
Local CP-SAT exploration tool.

Usage:
  python3 lib/explore_cpsat.py                     # runs built-in sample
  python3 lib/explore_cpsat.py input.json           # reads SolverInput JSON file
  python3 lib/explore_cpsat.py input.json --verbose # also prints coverage grid

The SolverInput JSON shape matches what the web app sends:
  {
    "oph": [[...], ...],   // 7 rows × 24 cols, orders-per-hour
    "config": {
      "productivityRate": 20,
      "partTimerCapPct": 40,
      "weekenderCapPct": 0,
      "allowWeekendDayOff": false
    }
  }
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from solver_cpsat import solve  # noqa: E402

DAYS  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TYPES = ["FT", "PT", "WFT", "WPT"]


# ── Built-in sample: a typical Instamart dark-store pattern ──────────────────
def sample_input():
    oph = [[0] * 24 for _ in range(7)]
    # Weekday demand: morning rush 8–12, evening rush 17–21
    for d in range(5):  # Mon–Fri
        for h in range(8, 13):
            oph[d][h] = 120   # 6 workers @ rate 20
        for h in range(17, 22):
            oph[d][h] = 160   # 8 workers
        for h in range(13, 17):
            oph[d][h] = 60    # 3 workers (afternoon lull)
    # Weekend: lighter but all-day
    for d in range(5, 7):  # Sat–Sun
        for h in range(9, 21):
            oph[d][h] = 80    # 4 workers
    return {
        "oph": oph,
        "config": {
            "productivityRate": 20,
            "partTimerCapPct": 40,
            "weekenderCapPct": 30,
            "allowWeekendDayOff": False,
        },
    }


# ── Formatting helpers ────────────────────────────────────────────────────────
def bar(n, total, width=20):
    filled = round(n / total * width) if total else 0
    return "█" * filled + "░" * (width - filled)


def fmt_hours(h):
    return f"{h:02d}:00"


def print_summary(result, config):
    r = result
    print("\n" + "═" * 60)
    print("  CP-SAT ROSTER SUMMARY")
    print("═" * 60)
    print(f"  Status          : {r['status'].upper()}")
    print(f"  Solve time      : {r.get('solveTimeMs', '?')} ms")
    print()

    total = r["totalWorkers"]
    ft, pt, wft, wpt = r["ftCount"], r["ptCount"], r["wftCount"], r["wptCount"]
    fte = ft + wft + 0.5 * (pt + wpt)

    print(f"  Total workers   : {total}  ({fte:.1f} FTE)")
    print(f"  FT              : {ft:3d}  {bar(ft, total)}")
    print(f"  PT              : {pt:3d}  {bar(pt, total)}")
    print(f"  WFT             : {wft:3d}  {bar(wft, total)}")
    print(f"  WPT             : {wpt:3d}  {bar(wpt, total)}")
    pt_pct = round((pt + wpt) / total * 100) if total else 0
    print(f"  PT share        : {pt_pct}%  (cap {round(config['partTimerCapPct'])}%)")

    # Weekly cost
    rate = 783 / 8  # ₹97.875/hr
    paid = ft * 48 + pt * 24 + wft * 16 + wpt * 8
    print(f"\n  Weekly paid hrs : {paid}")
    print(f"  Weekly cost     : ₹{math.ceil(paid * rate):,}")

    # Coverage
    req  = r["required"]
    cov  = r["coverage"]
    slots_req = sum(1 for d in range(7) for h in range(24) if req[d][h] > 0)
    slots_met = sum(1 for d in range(7) for h in range(24)
                    if req[d][h] > 0 and cov[d][h] >= req[d][h])
    print(f"  Coverage        : {slots_met}/{slots_req} demand slots met"
          f"  ({round(slots_met/slots_req*100) if slots_req else 100}%)")
    print("═" * 60)


def print_coverage_grid(result):
    req = result["required"]
    cov = result["coverage"]
    print("\n  COVERAGE GRID  (R=required  A=actual  ✓=met  ✗=short)")
    print("  Day  " + "".join(f"{h:>3}" for h in range(6, 24)))
    for d, day in enumerate(DAYS):
        row = []
        for h in range(6, 24):
            r, a = req[d][h], cov[d][h]
            if r == 0:
                row.append("  .")
            elif a >= r:
                row.append(f" {a:2d}")
            else:
                row.append(f"!{a:2d}")
        print(f"  {day:<4}" + "".join(row))
    print("  (! = deficit)")


def print_shift_distribution(result):
    from collections import Counter
    starts = Counter()
    for w in result["workers"]:
        starts[(w["type"], w["shiftStart"])] += 1

    print("\n  SHIFT START DISTRIBUTION")
    print(f"  {'Type':<5} {'Start':>6}  Count")
    print("  " + "-" * 30)
    for (wtype, s), count in sorted(starts.items()):
        print(f"  {wtype:<5} {fmt_hours(s):>6}  {'█' * count} {count}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    verbose = "--verbose" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if args:
        with open(args[0]) as f:
            inp = json.load(f)
        print(f"  Loaded input from: {args[0]}")
    else:
        inp = sample_input()
        print("  Using built-in sample (weekday peaks + weekend demand)")

    config = inp["config"]
    print(f"  Productivity rate : {config['productivityRate']} OPH")
    print(f"  PT cap            : {config['partTimerCapPct']}%")
    print(f"  Weekender cap     : {config['weekenderCapPct']}%")
    print("  Solving…")

    result = solve(inp)
    print_summary(result, config)

    if verbose and result["status"] in ("optimal", "feasible"):
        print_coverage_grid(result)
        print_shift_distribution(result)

    print()


if __name__ == "__main__":
    main()
