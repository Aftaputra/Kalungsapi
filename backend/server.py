"""
FarmTech WebSocket Server
Real-time sensor data collection and broadcasting
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, List, Set
import uvicorn
import os

from database import Database
from config import Config

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(title="FarmTech Sensor API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# SERVE FRONTEND FILES
# ============================================================

# Path ke folder frontend
frontend_dir = os.path.join(os. path.dirname(__file__), "..", "frontend")

# Mount static JS files FIRST
if os.path.exists(frontend_dir):
    js_dir = os.path.join(frontend_dir, "js")
    if os.path.exists(js_dir):
        app.mount("/js", StaticFiles(directory=js_dir), name="js")
        logger.info(f"📁 Serving JS from:  {js_dir}")

# Initialize database
db = Database()


# ============================================================
# CONNECTION MANAGER
# ============================================================

class ConnectionManager:
    """Manage WebSocket connections"""
    
    def __init__(self):
        # ESP32 devices connections
        self.esp32_connections:  Dict[str, WebSocket] = {}
        
        # Web dashboard connections
        self.dashboard_connections: Set[WebSocket] = set()
        
        # Statistics
        self.stats = {
            "total_messages": 0,
            "total_esp32_connected": 0,
            "total_dashboard_connected": 0
        }
    
    async def connect_esp32(self, device_id: str, websocket: WebSocket):
        """Connect ESP32 device"""
        await websocket.accept()
        self.esp32_connections[device_id] = websocket
        self.stats["total_esp32_connected"] = len(self.esp32_connections)
        logger.info(f"ESP32 {device_id} connected.  Total ESP32: {len(self.esp32_connections)}")
        
        # Notify dashboards about new device
        await self.broadcast_to_dashboards({
            "type": "device_connected",
            "device_id": device_id,
            "timestamp": datetime.now().isoformat()
        })
    
    async def connect_dashboard(self, websocket:  WebSocket):
        """Connect web dashboard"""
        await websocket. accept()
        self.dashboard_connections.add(websocket)
        self.stats["total_dashboard_connected"] = len(self. dashboard_connections)
        logger.info(f"Dashboard connected. Total dashboards: {len(self.dashboard_connections)}")
        
        # Send initial data
        await self.send_initial_data(websocket)
    
    def disconnect_esp32(self, device_id: str):
        """Disconnect ESP32 device"""
        if device_id in self. esp32_connections:
            del self.esp32_connections[device_id]
            self.stats["total_esp32_connected"] = len(self.esp32_connections)
            logger.info(f"ESP32 {device_id} disconnected. Total ESP32: {len(self.esp32_connections)}")
    
    def disconnect_dashboard(self, websocket: WebSocket):
        """Disconnect web dashboard"""
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)
            self.stats["total_dashboard_connected"] = len(self.dashboard_connections)
            logger.info(f"Dashboard disconnected. Total dashboards: {len(self. dashboard_connections)}")
    
    async def broadcast_to_dashboards(self, message: dict):
        """Broadcast message to all connected dashboards"""
        disconnected = set()
        
        for connection in self.dashboard_connections:
            try:
                await connection. send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to dashboard:  {e}")
                disconnected. add(connection)
        
        # Remove disconnected clients
        for conn in disconnected:
            self. disconnect_dashboard(conn)
    
    async def send_to_esp32(self, device_id: str, message: dict):
        """Send message to specific ESP32 device"""
        if device_id in self.esp32_connections:
            try:
                await self.esp32_connections[device_id].send_json(message)
            except Exception as e:
                logger. error(f"Error sending to ESP32 {device_id}: {e}")
                self.disconnect_esp32(device_id)
    
    async def send_initial_data(self, websocket: WebSocket):
        """Send initial data to newly connected dashboard"""
        try:
            # Get recent sensor data
            recent_data = await db.get_recent_data(limit=100)
            
            # Get device list
            devices = await db.get_all_devices()
            
            # Get statistics
            stats = await db. get_statistics()
            
            await websocket.send_json({
                "type": "initial_data",
                "data": {
                    "sensor_readings": recent_data,
                    "devices": devices,
                    "statistics": stats,
                    "connected_devices": list(self.esp32_connections. keys())
                }
            })
        except Exception as e: 
            logger.error(f"Error sending initial data: {e}")


# Initialize connection manager
manager = ConnectionManager()


# ============================================================
# WEBSOCKET ENDPOINTS
# ============================================================

@app.websocket("/ws/esp32/{device_id}")
async def websocket_esp32_endpoint(websocket: WebSocket, device_id: str):
    """
    WebSocket endpoint for ESP32 devices
    ESP32 connects here to send sensor data
    """
    await manager.connect_esp32(device_id, websocket)
    
    try:
        while True:
            # Receive data from ESP32
            data = await websocket.receive_text()
            
            try:
                sensor_data = json.loads(data)
                sensor_data['device_id'] = device_id
                sensor_data['timestamp'] = datetime. now().isoformat()
                
                logger.info(f"Received data from {device_id}: {len(data)} bytes")
                
                # Save to database
                await db.save_sensor_data(sensor_data)
                
                # Broadcast to all dashboards
                await manager.broadcast_to_dashboards({
                    "type": "sensor_data",
                    "data": sensor_data
                })
                
                manager.stats["total_messages"] += 1
                
                # Send acknowledgment back to ESP32
                await websocket.send_json({
                    "status": "ok",
                    "message":  "Data received",
                    "timestamp": datetime.now().isoformat()
                })
                
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from {device_id}: {e}")
                await websocket.send_json({
                    "status":  "error",
                    "message": "Invalid JSON format"
                })
            
    except WebSocketDisconnect: 
        manager.disconnect_esp32(device_id)
        await manager.broadcast_to_dashboards({
            "type": "device_disconnected",
            "device_id":  device_id,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error in ESP32 WebSocket {device_id}: {e}")
        manager.disconnect_esp32(device_id)


@app.websocket("/ws/dashboard")
async def websocket_dashboard_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for web dashboards
    Dashboard connects here to receive real-time sensor data
    """
    await manager.connect_dashboard(websocket)
    
    try:
        while True:
            # Receive commands from dashboard
            data = await websocket.receive_text()
            
            try:
                command = json.loads(data)
                command_type = command.get("type")
                
                if command_type == "ping":
                    await websocket. send_json({
                        "type": "pong",
                        "timestamp": datetime. now().isoformat()
                    })
                
                elif command_type == "get_stats":
                    stats = await db.get_statistics()
                    await websocket.send_json({
                        "type": "statistics",
                        "data": stats
                    })
                
                elif command_type == "get_device_data":
                    device_id = command.get("device_id")
                    limit = command.get("limit", 100)
                    data = await db.get_device_data(device_id, limit)
                    await websocket. send_json({
                        "type": "device_data",
                        "device_id": device_id,
                        "data": data
                    })
                
                elif command_type == "send_command_to_device":
                    # Forward command to specific ESP32
                    device_id = command.get("device_id")
                    device_command = command.get("command")
                    await manager.send_to_esp32(device_id, device_command)
                
            except json. JSONDecodeError as e: 
                logger.error(f"Invalid JSON from dashboard: {e}")
            
    except WebSocketDisconnect:
        manager.disconnect_dashboard(websocket)
    except Exception as e:
        logger.error(f"Error in dashboard WebSocket: {e}")
        manager.disconnect_dashboard(websocket)


# ============================================================
# HTTP REST API ENDPOINTS
# ============================================================

@app.get("/api", tags=["default"])
async def api_info():
    """API information"""
    return {
        "service": "FarmTech Sensor API",
        "version":  "1.0.0",
        "status": "running",
        "websocket_endpoints": {
            "esp32": "/ws/esp32/{device_id}",
            "dashboard": "/ws/dashboard"
        },
        "dashboard":  "http://localhost:8000/"
    }


@app.get("/api/status", tags=["default"])
async def get_status():
    """Get server status"""
    return {
        "status": "running",
        "connections": {
            "esp32_devices": len(manager.esp32_connections),
            "dashboards": len(manager.dashboard_connections),
            "connected_devices": list(manager.esp32_connections. keys())
        },
        "statistics": manager.stats,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/devices", tags=["devices"])
async def get_devices():
    """Get all registered devices"""
    devices = await db.get_all_devices()
    return {
        "devices": devices,
        "count": len(devices)
    }


@app.get("/api/devices/{device_id}/data", tags=["devices"])
async def get_device_data(device_id: str, limit: int = 100):
    """Get sensor data for specific device"""
    data = await db.get_device_data(device_id, limit)
    return {
        "device_id": device_id,
        "data": data,
        "count": len(data)
    }


@app.get("/api/data/recent", tags=["data"])
async def get_recent_data(limit: int = 100):
    """Get recent sensor data from all devices"""
    data = await db.get_recent_data(limit)
    return {
        "data": data,
        "count": len(data)
    }


@app.get("/api/statistics", tags=["data"])
async def get_statistics():
    """Get system statistics"""
    stats = await db.get_statistics()
    return stats


@app.post("/api/data", tags=["data"])
async def post_sensor_data(data: dict):
    """
    HTTP POST endpoint (fallback for devices that can't use WebSocket)
    """
    try:
        device_id = data.get('device_id')
        data['timestamp'] = datetime.now().isoformat()
        
        # Save to database
        await db. save_sensor_data(data)
        
        # Broadcast to dashboards
        await manager.broadcast_to_dashboards({
            "type": "sensor_data",
            "data": data
        })
        
        return {
            "status": "ok",
            "message": "Data received",
            "device_id": device_id
        }
    except Exception as e:
        logger.error(f"Error saving data: {e}")
        return {
            "status": "error",
            "message": str(e)
        }


@app.get("/api/test/generate", tags=["testing"])
async def generate_test_data():
    """Generate dummy sensor data for testing"""
    import random
    
    devices = ['DEV001', 'DEV002', 'DEV003']
    count = 0
    
    for device_id in devices:
        for _ in range(5):
            data = {
                'device_id': device_id,
                'timestamp': datetime.now().isoformat(),
                'imu_x': random.randint(-1000, 1000),
                'imu_y': random.randint(-1000, 1000),
                'imu_z': random.randint(-1000, 1000),
                'suhu_kaki': random.randint(2500, 3500),
                'vbatt_kaki': random.randint(3000, 4200),
                'suhu_leher': random.randint(2500, 3500),
                'vbatt_leher':  random.randint(3000, 4200),
                'latitude': int(-7.7956 * 1e7),
                'longitude': int(110.3695 * 1e7),
                'spo2': random.randint(95, 100),
                'heart_rate': random.randint(60, 100)
            }
            
            await db.save_sensor_data(data)
            await manager.broadcast_to_dashboards({
                "type": "sensor_data",
                "data":  data
            })
            count += 1
    
    return {
        "status": "ok",
        "generated": count,
        "devices": devices
    }


# ============================================================
# SERVE DASHBOARD HTML (MUST BE LAST!)
# ============================================================

@app.get("/", include_in_schema=False)
async def serve_dashboard():
    """Serve main dashboard HTML"""
    html_path = os.path.join(frontend_dir, "raw-data.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    return {
        "error": "Dashboard not found",
        "path": html_path,
        "frontend_dir": frontend_dir
    }


# ============================================================
# STARTUP & SHUTDOWN EVENTS
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Initialize on startup"""
    logger.info("🚀 FarmTech Server starting...")
    await db.initialize()
    logger.info("✅ Database initialized")
    logger.info("🌐 WebSocket server ready")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("🛑 FarmTech Server shutting down...")
    await db.close()
    logger.info("✅ Cleanup completed")


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=Config.HOST,
        port=Config.PORT,
        reload=False,
        log_level="info"
    )