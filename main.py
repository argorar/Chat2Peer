import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI()
DIRECTORY = "public"

# Create public directory if it doesn't exist
if not os.path.exists(DIRECTORY):
    os.makedirs(DIRECTORY)

# Store connected active WebSockets
connected_clients: set[WebSocket] = set()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    print(f"Client connected. Total clients: {len(connected_clients)}")

    # Notify other peers that a new peer joined
    for conn in connected_clients:
        if conn != websocket:
            try:
                await conn.send_json({"type": "peer_joined"})
            except Exception as e:
                print(f"Error sending to peer: {e}")

    try:
        while True:
            # Receive text data (signaling information)
            data = await websocket.receive_text()
            
            # Broadcast incoming signaling data to all *other* clients
            for conn in connected_clients:
                if conn != websocket:
                    await conn.send_text(data)
                    
    except WebSocketDisconnect:
        print("Client disconnected.")
    finally:
        connected_clients.remove(websocket)
        print(f"Clients remaining: {len(connected_clients)}")
        # Notify others of disconnection
        for conn in connected_clients:
            try:
                await conn.send_json({"type": "peer_left"})
            except Exception:
                pass

# Mount the static files directory, but we need to serve index.html explicitly
# if we just hit the root URL.
@app.get("/")
async def get_index():
    index_path = os.path.join(DIRECTORY, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Index file not found</h1>", status_code=404)

app.mount("/", StaticFiles(directory=DIRECTORY), name="static")

if __name__ == "__main__":
    # Get port from environment variables to make it cloud-ready, default to 8080
    port = int(os.environ.get("PORT", 8080))
    print(f"Starting unified server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
