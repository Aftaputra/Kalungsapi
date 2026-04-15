"""
Database handler for sensor data
Supports both SQLite (development) and PostgreSQL (production)
UPDATED: Accept NULL values for missing fields from ESP32 device
"""

import asyncio
import aiosqlite
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging

from config import Config

logger = logging.getLogger(__name__)


class Database:
    """Async database handler"""
    
    def __init__(self):
        self.db_path = Config.DATABASE_PATH
        self.db = None
    
    async def initialize(self):
        """Initialize database and create tables"""
        self.db = await aiosqlite.connect(self.db_path)
        self.db.row_factory = aiosqlite.Row
        
        await self.create_tables()
        logger.info(f"Database initialized: {self.db_path}")
    
    async def create_tables(self):
        """Create necessary tables (allowing NULLs)"""
        
        # ===== SENSOR DATA TABLE (ALLOW NULLS) =====
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS sensor_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                batch_id INTEGER,
                suhu_kaki INTEGER,
                vbatt_kaki INTEGER,
                suhu_leher INTEGER,
                vbatt_leher INTEGER,
                latitude INTEGER,
                longitude INTEGER,
                spo2 INTEGER,
                heart_rate INTEGER,
                tempC INTEGER,           -- ESP32 device temperature
                vbatt INTEGER,           -- ESP32 battery voltage (mV)
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # ===== IMU DATA TABLE (from ESP32) =====
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS imu_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                batch_id INTEGER NOT NULL,
                sample_index INTEGER,
                imu_x INTEGER,
                imu_y INTEGER,
                imu_z INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Device registry table
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT UNIQUE NOT NULL,
                cow_id TEXT,
                device_type TEXT DEFAULT 'esp32',  -- 'esp32' or 'full_sensor'
                status TEXT DEFAULT 'active',
                last_seen TEXT,
                firmware_version TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create indexes for faster queries
        await self.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_sensor_device_timestamp 
            ON sensor_data(device_id, timestamp DESC)
        """)
        
        await self.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_sensor_batch 
            ON sensor_data(batch_id)
        """)
        
        await self.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_imu_device_timestamp 
            ON imu_data(device_id, timestamp DESC)
        """)
        
        await self.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_imu_batch 
            ON imu_data(batch_id)
        """)
        
        await self.db.commit()
        logger.info("Database tables created/verified (NULL values allowed)")
    
    async def save_sensor_data(self, data: dict):
        """Save sensor data - accepts NULL for missing fields"""
        try:
            device_id = data.get('device_id')
            timestamp = data.get('timestamp', datetime.now().isoformat())
            batch_id = data.get('batch_id')
            
            # Register device if not exists
            await self.register_device(device_id)
            
            # Insert sensor data (all fields optional except device_id & timestamp)
            await self.db.execute("""
                INSERT INTO sensor_data (
                    device_id, timestamp, batch_id,
                    suhu_kaki, vbatt_kaki, suhu_leher, vbatt_leher,
                    latitude, longitude, spo2, heart_rate,
                    tempC, vbatt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                device_id,
                timestamp,
                batch_id,
                data.get('suhu_kaki'),
                data.get('vbatt_kaki'),
                data.get('suhu_leher'),
                data.get('vbatt_leher'),
                data.get('latitude'),
                data.get('longitude'),
                data.get('spo2'),
                data.get('heart_rate'),
                data.get('tempC'),      # ESP32 device temp
                data.get('vbatt')       # ESP32 battery
            ))
            
            await self.db.commit()
            
            # Update device last seen
            await self.update_device_last_seen(device_id, timestamp)
            
            logger.debug(f"Saved sensor data for device {device_id}, batch {batch_id}")
            
        except Exception as e:
            logger.error(f"Error saving sensor data: {e}")
            raise
    
    async def save_imu_data(self, data: dict):
        """Save IMU data to database"""
        try:
            device_id = data.get('device_id')
            timestamp = data.get('timestamp', datetime.now().isoformat())
            batch_id = data.get('batch_id')
            sample_index = data.get('sample_index')
            
            # Insert IMU data
            await self.db.execute("""
                INSERT INTO imu_data (
                    device_id, timestamp, batch_id, sample_index,
                    imu_x, imu_y, imu_z
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                device_id,
                timestamp,
                batch_id,
                sample_index,
                data.get('imu_x'),
                data.get('imu_y'),
                data.get('imu_z')
            ))
            
            await self.db.commit()
            
            logger.debug(f"Saved IMU data for device {device_id}, batch {batch_id}, sample {sample_index}")
            
        except Exception as e: 
            logger.error(f"Error saving IMU data: {e}")
            raise
    
    async def register_device(self, device_id: str, cow_id: str = None):
        """Register or update device"""
        try:
            # Determine device type based on ID prefix or existing record
            device_type = 'full_sensor'  # default
            if device_id.startswith('ESP32') or device_id.startswith('DEV'):
                device_type = 'esp32'
            
            await self.db.execute("""
                INSERT OR IGNORE INTO devices (device_id, cow_id, device_type, status)
                VALUES (?, ?, ?, 'active')
            """, (device_id, cow_id, device_type))
            
            # Update device type if already exists but type is different
            await self.db.execute("""
                UPDATE devices 
                SET device_type = COALESCE(device_type, ?)
                WHERE device_id = ? AND device_type IS NULL
            """, (device_type, device_id))
            
            await self.db.commit()
        except Exception as e:
            logger.error(f"Error registering device: {e}")
    
    async def update_device_last_seen(self, device_id: str, timestamp: str):
        """Update device last seen timestamp"""
        try:
            await self.db.execute("""
                UPDATE devices 
                SET last_seen = ?, updated_at = CURRENT_TIMESTAMP
                WHERE device_id = ?
            """, (timestamp, device_id))
            await self.db.commit()
        except Exception as e:
            logger.error(f"Error updating device last seen: {e}")
    
    async def get_recent_sensor_data(self, limit: int = 100) -> List[Dict]:
        """Get recent sensor data (non-IMU)"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM sensor_data
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting recent sensor data: {e}")
            return []
    
    async def get_recent_imu_data(self, limit: int = 100) -> List[Dict]:
        """Get recent IMU data"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM imu_data
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting recent IMU data: {e}")
            return []
    
    async def get_batch_data(self, batch_id: int) -> Dict:
        """Get complete data for a batch (sensor + all IMU samples)"""
        try:
            # Get sensor data
            cursor = await self.db.execute("""
                SELECT * FROM sensor_data WHERE batch_id = ?
            """, (batch_id,))
            sensor_row = await cursor.fetchone()
            
            # Get IMU data
            cursor = await self.db.execute("""
                SELECT * FROM imu_data 
                WHERE batch_id = ?  
                ORDER BY sample_index
            """, (batch_id,))
            imu_rows = await cursor.fetchall()
            
            return {
                "sensor": dict(sensor_row) if sensor_row else None,
                "imu_samples": [dict(row) for row in imu_rows]
            }
        except Exception as e: 
            logger.error(f"Error getting batch data: {e}")
            return {}
    
    async def get_device_data(self, device_id: str, limit: int = 100) -> List[Dict]:
        """Get sensor data for specific device"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM sensor_data
                WHERE device_id = ? 
                ORDER BY timestamp DESC
                LIMIT ?
            """, (device_id, limit))
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting device data: {e}")
            return []
    
    async def get_device_imu_data(self, device_id: str, limit: int = 1000) -> List[Dict]:
        """Get IMU data for specific device"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM imu_data
                WHERE device_id = ? 
                ORDER BY timestamp DESC
                LIMIT ?
            """, (device_id, limit))
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting device IMU data: {e}")
            return []
    
    async def get_all_devices(self) -> List[Dict]:
        """Get all registered devices"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM devices
                ORDER BY device_id
            """)
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting devices: {e}")
            return []
    
    async def get_statistics(self) -> Dict:
        """Get system statistics"""
        try:
            # Total sensor records
            cursor = await self.db.execute("SELECT COUNT(*) as count FROM sensor_data")
            row = await cursor.fetchone()
            total_sensor_records = row['count']
            
            # Total IMU records
            cursor = await self.db.execute("SELECT COUNT(*) as count FROM imu_data")
            row = await cursor.fetchone()
            total_imu_records = row['count']
            
            # Total devices
            cursor = await self.db.execute("SELECT COUNT(*) as count FROM devices")
            row = await cursor.fetchone()
            total_devices = row['count']
            
            # Records today
            today = datetime.now().date().isoformat()
            cursor = await self.db.execute("""
                SELECT COUNT(*) as count FROM sensor_data
                WHERE DATE(timestamp) = ?
            """, (today,))
            row = await cursor.fetchone()
            sensor_records_today = row['count']
            
            cursor = await self.db.execute("""
                SELECT COUNT(*) as count FROM imu_data
                WHERE DATE(timestamp) = ?
            """, (today,))
            row = await cursor.fetchone()
            imu_records_today = row['count']
            
            return {
                "total_sensor_records": total_sensor_records,
                "total_imu_records": total_imu_records,
                "total_devices": total_devices,
                "sensor_records_today": sensor_records_today,
                "imu_records_today": imu_records_today,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error getting statistics: {e}")
            return {}
    
    async def close(self):
        """Close database connection"""
        if self.db:
            await self.db.close()
            logger.info("Database connection closed")