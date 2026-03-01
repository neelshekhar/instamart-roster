"""
Vercel Python serverless function — GET /api/ping

Lightweight keep-alive endpoint. Importing ortools here warms the Python
runtime so the first real /api/solve call skips the cold-start penalty.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

# Warm the ortools import — this is the expensive part of cold starts
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from ortools.sat.python import cp_model as _cp_model  # noqa: F401, E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # silence default access log
