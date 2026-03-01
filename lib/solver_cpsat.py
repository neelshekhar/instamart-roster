#!/usr/bin/env python3
"""
CP-SAT rostering solver for Instamart.

Reads SolverInput JSON from stdin, writes SolverResult JSON to stdout.

Objective: minimise total paid hours.
  FT / WFT  = 8 productive hours/day  → coefficient 2
  PT / WPT  = 4 productive hours/day  → coefficient 1
(ratio is what matters; CP-SAT handles integer coefficients of any size)

Single-phase solve — no two-phase workaround needed (unlike HiGHS WASM).
"""

import json
import math
import sys
import time
from ortools.sat.python import cp_model

# ── Shift definitions (mirrored from solver.worker.ts) ────────────────────────
FT_STARTS       = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23]
PT_STARTS       = list(range(5, 21))   # [5..20]
WFT_STARTS      = list(range(5, 16))   # [5..15]  day-only for weekenders
FT_BREAK_OFFSETS = [3, 4, 5]

MON_FRI  = [0, 1, 2, 3, 4]
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def ft_hours_raw(s, b):
    """All productive hours for FT (may include values ≥ 24 for overnight)."""
    return [s + i for i in range(9) if s + i != s + b]


def ft_hours(s, b):
    """Same-day productive hours for FT (values < 24 only)."""
    return [h for h in ft_hours_raw(s, b) if h < 24]


def pt_hours(s):
    return [s, s + 1, s + 2, s + 3]


def solve(inp):
    oph    = inp["oph"]
    config = inp["config"]
    rate   = config["productivityRate"]
    cap_pt = round(config["partTimerCapPct"])
    cap_wk = round(config["weekenderCapPct"])

    use_pt  = cap_pt > 0
    use_wft = cap_wk > 0
    use_wpt = cap_pt > 0 and cap_wk > 0
    day_off_days = ALL_DAYS if config["allowWeekendDayOff"] else MON_FRI

    # ── Pre-filter: only keep variables that cover ≥1 demand slot ─────────────
    def is_active_ft(s, p, b):
        same = ft_hours(s, b)
        nxt  = [h - 24 for h in ft_hours_raw(s, b) if h >= 24]
        for d in ALL_DAYS:
            if d == p:
                continue
            if any(oph[d][h] > 0 for h in same):
                return True
            if nxt:
                nd = (d + 1) % 7
                if any(oph[nd][h] > 0 for h in nxt):
                    return True
        return False

    def is_active_pt(s, p):
        hrs = pt_hours(s)
        return any(oph[d][h] > 0 for d in ALL_DAYS if d != p for h in hrs)

    def is_active_wft(s, b):
        return any(oph[d][h] > 0 for d in [5, 6] for h in ft_hours(s, b))

    def is_active_wpt(s):
        return any(oph[d][h] > 0 for d in [5, 6] for h in pt_hours(s))

    # ── Break-placement constraint for FT / WFT ───────────────────────────────
    # An FT/WFT worker's break must NOT fall at the peak demand hour within
    # their shift, nor in the hour immediately before or after that peak.
    # "Peak" = highest-demand hour in the 9-hour shift window on a given day.
    # Because the break offset is the same on every working day, a config is
    # rejected if the break is too close to the peak on ANY of the worker's days.

    def shift_peak_hours(d, s):
        """Raw hours (may be ≥ 24) with maximum demand in shift [s, s+9) on day d."""
        best = 0
        peaks = []
        for offset in range(9):
            h_raw = s + offset
            dem = oph[d][h_raw] if h_raw < 24 else oph[(d + 1) % 7][h_raw - 24]
            if dem > best:
                best, peaks = dem, [h_raw]
            elif dem == best and dem > 0:
                peaks.append(h_raw)
        return peaks  # empty if no demand in window

    def is_break_valid_ft(s, p, b):
        """True iff break at s+b is not within ±1 of the peak on any working day."""
        break_raw = s + b
        for d in ALL_DAYS:
            if d == p:
                continue
            for peak_h in shift_peak_hours(d, s):
                if abs(break_raw - peak_h) <= 1:
                    return False
        return True

    def is_break_valid_wft(s, b):
        """Same rule for WFT (works Sat=5 and Sun=6 only)."""
        break_raw = s + b
        for d in [5, 6]:
            for peak_h in shift_peak_hours(d, s):
                if abs(break_raw - peak_h) <= 1:
                    return False
        return True

    ft_keys  = [(s, p, b) for s in FT_STARTS for p in day_off_days
                for b in FT_BREAK_OFFSETS
                if is_active_ft(s, p, b) and is_break_valid_ft(s, p, b)]
    pt_keys  = [(s, p) for s in PT_STARTS for p in day_off_days
                if use_pt and is_active_pt(s, p)]
    wft_keys = [(s, b) for s in WFT_STARTS for b in FT_BREAK_OFFSETS
                if use_wft and is_active_wft(s, b) and is_break_valid_wft(s, b)]
    wpt_keys = [s for s in PT_STARTS if use_wpt and is_active_wpt(s)]

    # ── Build CP-SAT model ────────────────────────────────────────────────────
    model   = cp_model.CpModel()
    MAX_CNT = 500   # upper bound on any single worker-group variable

    xFT  = {k: model.new_int_var(0, MAX_CNT, f"xFT_{k[0]}_{k[1]}_{k[2]}") for k in ft_keys}
    xPT  = {k: model.new_int_var(0, MAX_CNT, f"xPT_{k[0]}_{k[1]}")         for k in pt_keys}
    xWFT = {k: model.new_int_var(0, MAX_CNT, f"xWFT_{k[0]}_{k[1]}")        for k in wft_keys}
    xWPT = {s: model.new_int_var(0, MAX_CNT, f"xWPT_{s}")                   for s in wpt_keys}

    # ── Coverage constraints ──────────────────────────────────────────────────
    for d in range(7):
        for h in range(24):
            demand = oph[d][h]
            if demand <= 0:
                continue
            required = math.ceil(demand / rate)
            terms = []

            # FT same-day
            for (s, p, b), var in xFT.items():
                if d != p and h in ft_hours(s, b):
                    terms.append(var)

            # FT overnight: shift started on prev_day, hour wraps into day d
            prev_day = (d - 1) % 7
            for (s, p, b), var in xFT.items():
                if s < 20:
                    continue
                if p == prev_day:
                    continue
                if (h + 24) in ft_hours_raw(s, b):
                    terms.append(var)

            # PT (no overnight)
            for (s, p), var in xPT.items():
                if d != p and h in pt_hours(s):
                    terms.append(var)

            # Weekenders (Sat=5, Sun=6 only)
            if d in (5, 6):
                for (s, b), var in xWFT.items():
                    if h in ft_hours(s, b):
                        terms.append(var)
                for s, var in xWPT.items():
                    if h in pt_hours(s):
                        terms.append(var)

            if terms:
                model.add(sum(terms) >= required)

    # ── Cap constraints ───────────────────────────────────────────────────────
    if use_pt and cap_pt < 100:
        # (100 - cap_pt) * (PT + WPT) ≤ cap_pt * (FT + WFT)
        pt_sum = list(xPT.values()) + list(xWPT.values())
        ft_sum = list(xFT.values()) + list(xWFT.values())
        if pt_sum and ft_sum:
            model.add(
                (100 - cap_pt) * sum(pt_sum) <= cap_pt * sum(ft_sum)
            )

    if (use_wft or use_wpt) and cap_wk < 100:
        # (100 - cap_wk) * (WFT + WPT) ≤ cap_wk * (FT + PT)
        wk_sum = list(xWFT.values()) + list(xWPT.values())
        wd_sum = list(xFT.values()) + list(xPT.values())
        if wk_sum and wd_sum:
            model.add(
                (100 - cap_wk) * sum(wk_sum) <= cap_wk * sum(wd_sum)
            )

    # ── Objective: minimise total paid hours ─────────────────────────────────
    # FT/WFT: 8 productive hours/day → weight 2
    # PT/WPT: 4 productive hours/day → weight 1
    obj = []
    for var in xFT.values():  obj.append(2 * var)
    for var in xWFT.values(): obj.append(2 * var)
    for var in xPT.values():  obj.append(var)
    for var in xWPT.values(): obj.append(var)
    model.minimize(sum(obj) if obj else 0)

    # ── Solve ─────────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0
    t0     = time.time()
    status = solver.solve(model)
    solve_ms = round((time.time() - t0) * 1000)

    ZERO_RESULT = {
        "workers": [], "totalWorkers": 0,
        "ftCount": 0, "ptCount": 0, "wftCount": 0, "wptCount": 0,
        "coverage": [[0] * 24 for _ in range(7)],
        "required": [[0] * 24 for _ in range(7)],
        "solveTimeMs": solve_ms,
    }

    if status == cp_model.INFEASIBLE:
        return {**ZERO_RESULT, "status": "infeasible",
                "errorMessage": "No feasible schedule exists with these constraints."}
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {**ZERO_RESULT, "status": "error",
                "errorMessage": f"CP-SAT status: {solver.status_name(status)}"}

    # ── Build roster from solution ────────────────────────────────────────────
    workers = []
    wid = 1
    ft_count = pt_count = wft_count = wpt_count = 0

    for (s, p, b), var in xFT.items():
        for _ in range(solver.value(var)):
            workers.append({
                "id": wid, "type": "FT",
                "shiftStart": s, "shiftEnd": s + 9,
                "dayOff": p,
                "productiveHours": [h % 24 for h in ft_hours_raw(s, b)],
            })
            wid += 1; ft_count += 1

    for (s, p), var in xPT.items():
        for _ in range(solver.value(var)):
            workers.append({
                "id": wid, "type": "PT",
                "shiftStart": s, "shiftEnd": s + 4,
                "dayOff": p,
                "productiveHours": pt_hours(s),
            })
            wid += 1; pt_count += 1

    for (s, b), var in xWFT.items():
        for _ in range(solver.value(var)):
            workers.append({
                "id": wid, "type": "WFT",
                "shiftStart": s, "shiftEnd": s + 9,
                "dayOff": None,
                "productiveHours": ft_hours(s, b),
            })
            wid += 1; wft_count += 1

    for s, var in xWPT.items():
        for _ in range(solver.value(var)):
            workers.append({
                "id": wid, "type": "WPT",
                "shiftStart": s, "shiftEnd": s + 4,
                "dayOff": None,
                "productiveHours": pt_hours(s),
            })
            wid += 1; wpt_count += 1

    # ── Coverage matrix ───────────────────────────────────────────────────────
    coverage = [[0] * 24 for _ in range(7)]
    for w in workers:
        active_days = (
            [5, 6] if w["type"] in ("WFT", "WPT")
            else [d for d in ALL_DAYS if d != w["dayOff"]]
        )
        for d in active_days:
            for h in w["productiveHours"]:
                if 0 <= h < 24:
                    if h < w["shiftStart"]:
                        # Overnight wrap — hour belongs to next calendar day
                        coverage[(d + 1) % 7][h] += 1
                    else:
                        coverage[d][h] += 1

    required = [
        [math.ceil(oph[d][h] / rate) if oph[d][h] > 0 else 0 for h in range(24)]
        for d in range(7)
    ]

    return {
        "status": "optimal",
        "workers": workers,
        "totalWorkers": len(workers),
        "ftCount": ft_count, "ptCount": pt_count,
        "wftCount": wft_count, "wptCount": wpt_count,
        "coverage": coverage,
        "required": required,
        "solveTimeMs": solve_ms,
    }


if __name__ == "__main__":
    inp    = json.loads(sys.stdin.read())
    result = solve(inp)
    print(json.dumps(result))
