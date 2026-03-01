"""
Vercel Python serverless function — POST /api/solve

Receives SolverInput JSON in the request body,
runs the CP-SAT solver, returns SolverResult JSON.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Make lib/ importable (project root is the working dir on Vercel)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from solver_cpsat import solve  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            inp = json.loads(body)
            result = solve(inp)
            self._respond(200, result)
        except Exception as exc:
            self._respond(500, {
                "status": "error",
                "errorMessage": str(exc),
                "workers": [], "totalWorkers": 0,
                "ftCount": 0, "ptCount": 0, "wftCount": 0, "wptCount": 0,
                "coverage": [[0] * 24 for _ in range(7)],
                "required": [[0] * 24 for _ in range(7)],
            })

    def _respond(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # silence default access log
