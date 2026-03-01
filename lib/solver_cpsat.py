#!/usr/bin/env python3
"""
CP-SAT rostering solver for Instamart.

Reads SolverInput JSON from stdin, writes SolverResult JSON to stdout.

Objective: minimise total paid hours.
  FT / WFT  = 8 productive hours/day  → coefficient 2
  PT / WPT  = 4 productive hours/day  → coefficient 1
(ratio is what matters; CP-SAT handles integer coefficients of any size)

Single-phase solve — no two-phase workaround needed (unlike HiGHS WASM).

Break model for FT / WFT:
  Each shift is 9 hours; workers take 1 hour of unpaid break split into
  TWO staggered 30-min breaks.  Breaks are specified as half-slot offsets
  within the shift (0 = first :00-:30, 1 = first :30-:00, …, 17 = last :30).
  Constraints:
    • Break 1 (bs1): half-slot ≥ 4  (after first 2 h = 4 half-slots)
    • Break 2 (bs2): half-slot ≤ 13 (before last 2 h; slot 14 starts at 7 h)
    • bs2 ≥ bs1 + 4  (at least 2 h = 4 half-slots apart)
  Coverage: the coverage constraint is scaled ×2.  A fully productive hour
  contributes 2; an hour that contains one break half-slot contributes 1
  (worker is still productive for the other 30 min of that hour).
  Net productive time: 7 × 60 + 2 × 30 = 480 min = 8 h  ✓
"""

import json
import math
import sys
import time
from ortools.sat.python import cp_model

# ── Shift definitions ─────────────────────────────────────────────────────────
FT_STARTS  = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23]
PT_STARTS  = list(range(5, 21))   # [5..20]
WFT_STARTS = list(range(5, 16))   # [5..15]  day-only for weekenders

# Half-slot offsets within a 9-hour shift (18 half-slots total, 0..17).
# Break 1 (bs1): ≥ 4 (after first 2 h), Break 2 (bs2): ≤ 13 (before last 2 h).
# Must be at least 4 half-slots (= 2 h) apart.
# 21 valid pairs: (4,8),(4,9),…,(9,13)
FT_BREAK_HALF_SLOTS = [
    (bs1, bs2)
    for bs1 in range(4, 14)
    for bs2 in range(bs1 + 4, 14)
]

MON_FRI  = [0, 1, 2, 3, 4]
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def ft_coverage(s, bs1, bs2):
    """Return {raw_hour: contribution} for an FT/WFT shift starting at s.
    raw_hour may be ≥ 24 for overnight shifts.
    contribution = 2 for a fully productive hour, 1 if one 30-min break
    falls within that hour (scaled by 2 for integer coverage constraints)."""
    result = {}
    for shift_h in range(9):
        raw_h = s + shift_h
        hs0 = 2 * shift_h        # :00 half-slot offset within shift
        hs1 = 2 * shift_h + 1    # :30 half-slot offset within shift
        contrib = 2
        if bs1 in (hs0, hs1):
            contrib -= 1
        if bs2 in (hs0, hs1):
            contrib -= 1
        result[raw_h] = contrib  # always > 0 (each hour has ≤ 1 break half-slot)
    return result


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
    def is_active_ft(s, p, bs1, bs2):
        cov = ft_coverage(s, bs1, bs2)
        same = [h for h in cov if h < 24]
        nxt  = [h - 24 for h in cov if h >= 24]
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

    def is_active_wft(s, bs1, bs2):
        cov = ft_coverage(s, bs1, bs2)
        same = [h for h in cov if h < 24]
        return any(oph[d][h] > 0 for d in [5, 6] for h in same)

    def is_active_wpt(s):
        return any(oph[d][h] > 0 for d in [5, 6] for h in pt_hours(s))

    # ── Break-placement constraint for FT / WFT ───────────────────────────────
    # Neither break half-slot may fall within ±1 h of the peak demand hour in
    # the shift window on any of the worker's working days.
    # Comparison is done in half-slot units: ±1 h = ±2 half-slots.

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

    def is_break_valid_ft(s, p, bs1, bs2):
        """True iff neither break is within ±1 h of the peak on any working day.
        Break time (absolute half-slots) = 2*s + bs.
        Peak time (absolute half-slots) = 2*peak_h.
        ±1 h = ±2 half-slots."""
        for bs in (bs1, bs2):
            break_hs = 2 * s + bs
            for d in ALL_DAYS:
                if d == p:
                    continue
                for peak_h in shift_peak_hours(d, s):
                    if abs(break_hs - 2 * peak_h) <= 2:
                        return False
        return True

    def is_break_valid_wft(s, bs1, bs2):
        """Same rule for WFT (works Sat=5, Sun=6 only)."""
        for bs in (bs1, bs2):
            break_hs = 2 * s + bs
            for d in [5, 6]:
                for peak_h in shift_peak_hours(d, s):
                    if abs(break_hs - 2 * peak_h) <= 2:
                        return False
        return True

    ft_keys  = [(s, p, bs1, bs2) for s in FT_STARTS for p in day_off_days
                for (bs1, bs2) in FT_BREAK_HALF_SLOTS
                if is_active_ft(s, p, bs1, bs2) and is_break_valid_ft(s, p, bs1, bs2)]
    pt_keys  = [(s, p) for s in PT_STARTS for p in day_off_days
                if use_pt and is_active_pt(s, p)]
    wft_keys = [(s, bs1, bs2) for s in WFT_STARTS for (bs1, bs2) in FT_BREAK_HALF_SLOTS
                if use_wft and is_active_wft(s, bs1, bs2) and is_break_valid_wft(s, bs1, bs2)]
    wpt_keys = [s for s in PT_STARTS if use_wpt and is_active_wpt(s)]

    # Pre-compute coverage dicts (avoid recomputing in nested loops)
    ft_cov  = {k: ft_coverage(k[0], k[2], k[3]) for k in ft_keys}
    wft_cov = {k: ft_coverage(k[0], k[1], k[2]) for k in wft_keys}

    # ── Build CP-SAT model ────────────────────────────────────────────────────
    model   = cp_model.CpModel()
    MAX_CNT = 500   # upper bound on any single worker-group variable

    xFT  = {k: model.new_int_var(0, MAX_CNT, f"xFT_{k[0]}_{k[1]}_{k[2]}_{k[3]}") for k in ft_keys}
    xPT  = {k: model.new_int_var(0, MAX_CNT, f"xPT_{k[0]}_{k[1]}")               for k in pt_keys}
    xWFT = {k: model.new_int_var(0, MAX_CNT, f"xWFT_{k[0]}_{k[1]}_{k[2]}")       for k in wft_keys}
    xWPT = {s: model.new_int_var(0, MAX_CNT, f"xWPT_{s}")                         for s in wpt_keys}

    # ── Coverage constraints (scaled ×2) ──────────────────────────────────────
    # required_scaled = 2 × ceil(oph / rate)
    # FT/WFT fully productive hour   → contributes 2 × var
    # FT/WFT break-containing hour   → contributes 1 × var  (30 min of work)
    # PT/WPT (no breaks)             → contributes 2 × var
    for d in range(7):
        for h in range(24):
            demand = oph[d][h]
            if demand <= 0:
                continue
            required_scaled = 2 * math.ceil(demand / rate)
            terms = []

            # FT same-day
            for k, var in xFT.items():
                s, p, _, _ = k
                if d != p and h in ft_cov[k]:
                    terms.append(ft_cov[k][h] * var)

            # FT overnight: shift started on prev_day, hour wraps into day d
            prev_day = (d - 1) % 7
            for k, var in xFT.items():
                s, p, _, _ = k
                if s < 20 or p == prev_day:
                    continue
                if (h + 24) in ft_cov[k]:
                    terms.append(ft_cov[k][h + 24] * var)

            # PT (no overnight, no breaks → full contribution 2)
            for (s, p), var in xPT.items():
                if d != p and h in pt_hours(s):
                    terms.append(2 * var)

            # Weekenders (Sat=5, Sun=6 only)
            if d in (5, 6):
                for k, var in xWFT.items():
                    if h in wft_cov[k]:
                        terms.append(wft_cov[k][h] * var)
                for s, var in xWPT.items():
                    if h in pt_hours(s):
                        terms.append(2 * var)

            if terms:
                model.add(sum(terms) >= required_scaled)

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

    # ── Objective: minimise total paid hours ──────────────────────────────────
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

    for k, var in xFT.items():
        s, p, bs1, bs2 = k
        for _ in range(solver.value(var)):
            cov = ft_cov[k]
            workers.append({
                "id": wid, "type": "FT",
                "shiftStart": s, "shiftEnd": s + 9,
                "dayOff": p,
                # All 9 shift hours appear in productiveHours (each has ≥30 min worked)
                "productiveHours": sorted(h for h in cov if h < 24),
                "breakHalfSlots": [bs1, bs2],
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

    for k, var in xWFT.items():
        s, bs1, bs2 = k
        for _ in range(solver.value(var)):
            cov = wft_cov[k]
            workers.append({
                "id": wid, "type": "WFT",
                "shiftStart": s, "shiftEnd": s + 9,
                "dayOff": None,
                "productiveHours": sorted(h for h in cov if h < 24),
                "breakHalfSlots": [bs1, bs2],
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
