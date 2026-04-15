"""
FarmTech WebSocket Server
Real-time sensor data collection and broadcasting
UPDATED: Split IMU (20Hz) and Sensor data (0.7Hz) into separate endpoints
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
app = FastAPI(title="FarmTech Sensor API", version="2.0.0")

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

frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")

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
        # ESP32 devices connections (sensor endpoint)
        self.esp32_sensor_connections:  Dict[str, WebSocket] = {}
        
        # ESP32 devices connections (IMU endpoint)
        self.esp32_imu_connections: Dict[str, WebSocket] = {}
        
        # Web dashboard connections
        self.dashboard_connections: Set[WebSocket] = set()
        
        # Statistics
        self.stats = {
            "total_sensor_messages": 0,
            "total_imu_messages": 0,
            "total_esp32_sensor_connected": 0,
            "total_esp32_imu_connected": 0,
            "total_dashboard_connected": 0
        }
    
    async def connect_esp32_sensor(self, device_id: str, websocket: WebSocket):
        """Connect ESP32 device to SENSOR endpoint"""
        await websocket.accept()
        self.esp32_sensor_connections[device_id] = websocket
        self.stats["total_esp32_sensor_connected"] = len(self.esp32_sensor_connections)
        logger.info(f"[SENSOR] ESP32 {device_id} connected.  Total: {len(self.esp32_sensor_connections)}")
        
        await self.broadcast_to_dashboards({
            "type": "device_connected",
            "endpoint": "sensor",
            "device_id": device_id,
            "timestamp": datetime.now().isoformat()
        })
    
    async def connect_esp32_imu(self, device_id: str, websocket:  WebSocket):
        """Connect ESP32 device to IMU endpoint"""
        await websocket.accept()
        self.esp32_imu_connections[device_id] = websocket
        self.stats["total_esp32_imu_connected"] = len(self. esp32_imu_connections)
        logger.info(f"[IMU] ESP32 {device_id} connected. Total: {len(self.esp32_imu_connections)}")
        
        await self.broadcast_to_dashboards({
            "type": "device_connected",
            "endpoint": "imu",
            "device_id": device_id,
            "timestamp": datetime.now().isoformat()
        })
    
    async def connect_dashboard(self, websocket:  WebSocket):
        """Connect web dashboard"""
        await websocket.accept()
        self.dashboard_connections. add(websocket)
        self.stats["total_dashboard_connected"] = len(self.dashboard_connections)
        logger.info(f"Dashboard connected. Total dashboards: {len(self.dashboard_connections)}")
        
        await self.send_initial_data(websocket)
    
    def disconnect_esp32_sensor(self, device_id: str):
        """Disconnect ESP32 from SENSOR endpoint"""
        if device_id in self.esp32_sensor_connections:
            del self.esp32_sensor_connections[device_id]
            self.stats["total_esp32_sensor_connected"] = len(self.esp32_sensor_connections)
            logger.info(f"[SENSOR] ESP32 {device_id} disconnected")
    
    def disconnect_esp32_imu(self, device_id: str):
        """Disconnect ESP32 from IMU endpoint"""
        if device_id in self.esp32_imu_connections:
            del self. esp32_imu_connections[device_id]
            self. stats["total_esp32_imu_connected"] = len(self.esp32_imu_connections)
            logger.info(f"[IMU] ESP32 {device_id} disconnected")
    
    def disconnect_dashboard(self, websocket: WebSocket):
        """Disconnect web dashboard"""
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)
            self.stats["total_dashboard_connected"] = len(self.dashboard_connections)
            logger.info(f"Dashboard disconnected")
    
    async def broadcast_to_dashboards(self, message: dict):
        """Broadcast message to all connected dashboards"""
        disconnected = set()
        
        for connection in self.dashboard_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to dashboard: {e}")
                disconnected.add(connection)
        
        for conn in disconnected:
            self.disconnect_dashboard(conn)
    
    async def send_initial_data(self, websocket: WebSocket):
        """Send initial data to newly connected dashboard"""
        try:
            recent_sensor = await db.get_recent_sensor_data(limit=50)
            recent_imu = await db.get_recent_imu_data(limit=100)
            devices = await db.get_all_devices()
            stats = await db.get_statistics()
            
            await websocket.send_json({
                "type": "initial_data",
                "data": {
                    "sensor_data": recent_sensor,
                    "imu_data":  recent_imu,
                    "devices": devices,
                    "statistics": stats,
                    "connected_devices": {
                        "sensor": list(self.esp32_sensor_connections. keys()),
                        "imu": list(self.esp32_imu_connections.keys())
                    }
                }
            })
        except Exception as e: 
            logger.error(f"Error sending initial data: {e}")


# Initialize connection manager
manager = ConnectionManager()


# ============================================================
# WEBSOCKET ENDPOINTS - ESP32
# ============================================================

@app. websocket("/ws/esp32/sensor/{device_id}")
async def websocket_esp32_sensor_endpoint(websocket: WebSocket, device_id: str):
    """
    WebSocket endpoint for ESP32 devices - SENSOR DATA ONLY
    Rate: ~0.7Hz (1 message per 1. 45 seconds)
    Data: suhu, battery, GPS, SpO2, heart rate
    """
    await manager.connect_esp32_sensor(device_id, websocket)
    
    try:
        while True: 
            data = await websocket. receive_text()
            
            try:
                sensor_data = json.loads(data)
                sensor_data['device_id'] = device_id
                sensor_data['timestamp'] = datetime. now().isoformat()
                
                batch_id = sensor_data.get('batch_id')
                logger.info(f"[SENSOR] {device_id} | Batch {batch_id} | {len(data)} bytes")
                
                # Save to database
                await db.save_sensor_data(sensor_data)
                
                # Broadcast to dashboards
                await manager.broadcast_to_dashboards({
                    "type": "sensor_data",
                    "data": sensor_data
                })
                
                manager.stats["total_sensor_messages"] += 1
                
                # ACK
                await websocket.send_json({
                    "status": "ok",
                    "type": "sensor_ack",
                    "batch_id": batch_id
                })
                
            except json.JSONDecodeError as e:
                logger.error(f"[SENSOR] Invalid JSON from {device_id}: {e}")
                await websocket.send_json({
                    "status":  "error",
                    "message": "Invalid JSON format"
                })
            except Exception as e:
                logger.error(f"[SENSOR] Error processing data from {device_id}: {e}")
            
    except WebSocketDisconnect: 
        manager.disconnect_esp32_sensor(device_id)
        await manager.broadcast_to_dashboards({
            "type": "device_disconnected",
            "endpoint": "sensor",
            "device_id": device_id,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"[SENSOR] Error in WebSocket {device_id}: {e}")
        manager.disconnect_esp32_sensor(device_id)


@app.websocket("/ws/esp32/imu/{device_id}")
async def websocket_esp32_imu_endpoint(websocket: WebSocket, device_id: str):
    """
    WebSocket endpoint for ESP32 devices - IMU DATA ONLY
    """
    await manager.connect_esp32_imu(device_id, websocket)
    
    message_count = 0
    batch_start = datetime.now()
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:  
                imu_data = json.loads(data)
                imu_data['device_id'] = device_id
                imu_data['timestamp'] = datetime.now().isoformat()
                
                # Save to database
                await db.save_imu_data(imu_data)
                
                # ✅ BROADCAST to dashboards with proper structure
                await manager.broadcast_to_dashboards({
                    "type": "sensor_data",
                    "data": {
                        # IMU data
                        "imu_x": imu_data.get('imu_x'),
                        "imu_y": imu_data.get('imu_y'),
                        "imu_z": imu_data.get('imu_z'),
                        "sample_index": imu_data.get('sample_index'),
                        "batch_id": imu_data.get('batch_id'),
                        "seq_start": imu_data.get('seq_start'),
                        
                        # Device info
                        "device_id": device_id,
                        "timestamp": imu_data.get('timestamp'),
                        
                        # ESP32 specific (dari sensor data)
                        "tempC": imu_data.get('tempC'),      # device temp
                        "vbatt": imu_data.get('vbatt'),      # battery voltage
                        
                        # NULL untuk field yang belum ada
                        "suhu_kaki": None,
                        "vbatt_kaki": None,
                        "suhu_leher": None,
                        "vbatt_leher": None,
                        "latitude": None,
                        "longitude": None,
                        "spo2": None,
                        "heart_rate": None
                    }
                })
                
                manager.stats["total_imu_messages"] += 1
                message_count += 1
                
                # Log setiap batch selesai (29 samples)
                sample_index = imu_data.get('sample_index', 0)
                if sample_index == 0:
                    logger.info(f"[IMU] {device_id} | Batch {imu_data.get('batch_id')} | Starting...")
                elif sample_index == 28:  # Last sample
                    elapsed = (datetime.now() - batch_start).total_seconds()
                    logger.info(f"[IMU] {device_id} | Batch {imu_data.get('batch_id')} | 29 samples in {elapsed:.2f}s")
                    batch_start = datetime.now()
                
            except json.JSONDecodeError as e:  
                logger.error(f"[IMU] Invalid JSON from {device_id}: {e}")
            except Exception as e:
                logger.error(f"[IMU] Error processing data from {device_id}: {e}")
            
    except WebSocketDisconnect:  
        manager.disconnect_esp32_imu(device_id)
        logger.info(f"[IMU] {device_id} disconnected after {message_count} messages")
        await manager.broadcast_to_dashboards({
            "type": "device_disconnected",
            "endpoint": "imu",
            "device_id": device_id,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:  
        logger.error(f"[IMU] Error in WebSocket {device_id}: {e}")
        manager.disconnect_esp32_imu(device_id)
        
# ============================================================
# WEBSOCKET ENDPOINT - DASHBOARD
# ============================================================

@app.websocket("/ws/dashboard")
async def websocket_dashboard_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for web dashboards
    Dashboard connects here to receive real-time sensor data
    """
    await manager.connect_dashboard(websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                command = json.loads(data)
                command_type = command.get("type")
                
                if command_type == "ping":
                    await websocket. send_json({
                        "type": "pong",
                        "timestamp": datetime.now().isoformat()
                    })
                
                elif command_type == "get_stats":
                    stats = await db.get_statistics()
                    await websocket.send_json({
                        "type": "statistics",
                        "data": stats
                    })
                
                elif command_type == "get_batch":
                    batch_id = command.get("batch_id")
                    data = await db.get_batch_data(batch_id)
                    await websocket.send_json({
                        "type": "batch_data",
                        "batch_id": batch_id,
                        "data": data
                    })
                
            except json.JSONDecodeError as e:
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
        "version":  "2.0.0",
        "status": "running",
        "architecture": "Split IMU (20Hz) and Sensor (0.7Hz)",
        "websocket_endpoints": {
            "esp32_sensor": "/ws/esp32/sensor/{device_id}",
            "esp32_imu": "/ws/esp32/imu/{device_id}",
            "dashboard": "/ws/dashboard"
        }
    }


@app. get("/api/status", tags=["default"])
async def get_status():
    """Get server status"""
    return {
        "status": "running",
        "connections": {
            "esp32_sensor": len(manager. esp32_sensor_connections),
            "esp32_imu":  len(manager.esp32_imu_connections),
            "dashboards": len(manager.dashboard_connections),
            "connected_devices": {
                "sensor": list(manager.esp32_sensor_connections.keys()),
                "imu": list(manager.esp32_imu_connections.keys())
            }
        },
        "statistics": manager.stats,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/devices", tags=["devices"])
async def get_devices():
    """Get all registered devices"""
    devices = await db.get_all_devices()
    return {
        "devices":  devices,
        "count": len(devices)
    }


@app.get("/api/devices/{device_id}/sensor", tags=["devices"])
async def get_device_sensor_data(device_id: str, limit: int = 100):
    """Get sensor data for specific device"""
    data = await db.get_device_data(device_id, limit)
    return {
        "device_id": device_id,
        "data": data,
        "count": len(data)
    }


@app.get("/api/devices/{device_id}/imu", tags=["devices"])
async def get_device_imu_data(device_id: str, limit: int = 1000):
    """Get IMU data for specific device"""
    data = await db.get_device_imu_data(device_id, limit)
    return {
        "device_id": device_id,
        "data": data,
        "count": len(data)
    }


@app.get("/api/data/sensor/recent", tags=["data"])
async def get_recent_sensor_data(limit: int = 100):
    """Get recent sensor data from all devices"""
    data = await db.get_recent_sensor_data(limit)
    return {
        "data": data,
        "count": len(data)
    }


@app.get("/api/data/imu/recent", tags=["data"])
async def get_recent_imu_data(limit: int = 1000):
    """Get recent IMU data from all devices"""
    data = await db.get_recent_imu_data(limit)
    return {
        "data": data,
        "count":  len(data)
    }


@app.get("/api/batch/{batch_id}", tags=["data"])
async def get_batch_data(batch_id: int):
    """Get complete data for a batch (sensor + all 29 IMU samples)"""
    data = await db.get_batch_data(batch_id)
    return {
        "batch_id":  batch_id,
        "data": data
    }


@app.get("/api/statistics", tags=["data"])
async def get_statistics():
    """Get system statistics"""
    stats = await db.get_statistics()
    return stats


# ============================================================
# SERVE DASHBOARD HTML
# ============================================================

@app.get("/", include_in_schema=False)
async def serve_dashboard():
    """Serve main dashboard HTML"""
    html_path = os.path.join(frontend_dir, "raw-data.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    return {
        "error": "Dashboard not found",
        "message": "Frontend files not found"
    }


# ============================================================
# STARTUP & SHUTDOWN EVENTS
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Initialize on startup"""
    logger.info("🚀 FarmTech Server v2.0 starting...")
    logger.info("📊 Architecture: Split IMU (20Hz) + Sensor (0.7Hz)")
    await db.initialize()
    logger.info("✅ Database initialized with split schema")
    logger.info("🌐 WebSocket server ready")
    logger.info(f"🔗 Server:  http://{Config.HOST}:{Config.PORT}")


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