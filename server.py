"""
Dual HTTP & HTTPS Server Runner
- Port 8000: Plain HTTP for PC and local network (zero certificate warnings, instant loading)
- Port 8443: Secure HTTPS for Mobile (Safari / Chrome) to enable live WebRTC camera access
"""
import threading
import sys
import os
import uvicorn
from main import app

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(BASE_DIR, "key.pem")
CERT_FILE = os.path.join(BASE_DIR, "cert.pem")

def run_http():
    print(">>> [HTTP] Starting server on http://0.0.0.0:8000 ...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

def run_https():
    print(">>> [HTTPS] Starting server on https://0.0.0.0:8443 ...")
    if os.path.exists(KEY_FILE) and os.path.exists(CERT_FILE):
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8443,
            ssl_keyfile=KEY_FILE,
            ssl_certfile=CERT_FILE,
            log_level="warning"
        )
    else:
        print(">>> [WARN] SSL certificates not found for port 8443.")

if __name__ == "__main__":
    http_thread = threading.Thread(target=run_http, daemon=True)
    http_thread.start()

    # Run HTTPS on main thread
    run_https()
