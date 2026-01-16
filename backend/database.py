"""
Database handler for sensor data
Supports both SQLite (development) and PostgreSQL (production)
"""

import asyncio
import aiosqlite
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging

from config import Config

logger = logging. getLogger(__name__)


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
        logger.info(f"Database initialized:  {self.db_path}")
    
    async def create_tables(self):
        """Create necessary tables"""
        
        # Sensor data table
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS sensor_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                imu_x INTEGER,
                imu_y INTEGER,
                imu_z INTEGER,
                suhu_kaki INTEGER,
                vbatt_kaki INTEGER,
                suhu_leher INTEGER,
                vbatt_leher INTEGER,
                latitude INTEGER,
                longitude INTEGER,
                spo2 INTEGER,
                heart_rate INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Device registry table
        await self.db. execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT UNIQUE NOT NULL,
                cow_id TEXT,
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
            CREATE INDEX IF NOT EXISTS idx_sensor_timestamp 
            ON sensor_data(timestamp DESC)
        """)
        
        await self.db. commit()
        logger.info("Database tables created/verified")
    
    async def save_sensor_data(self, data: dict):
        """Save sensor data to database"""
        try: 
            device_id = data.get('device_id')
            timestamp = data.get('timestamp', datetime.now().isoformat())
            
            # Register device if not exists
            await self.register_device(device_id)
            
            # Insert sensor data
            await self.db. execute("""
                INSERT INTO sensor_data (
                    device_id, timestamp, imu_x, imu_y, imu_z,
                    suhu_kaki, vbatt_kaki, suhu_leher, vbatt_leher,
                    latitude, longitude, spo2, heart_rate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                device_id,
                timestamp,
                data.get('imu_x'),
                data.get('imu_y'),
                data.get('imu_z'),
                data.get('suhu_kaki'),
                data.get('vbatt_kaki'),
                data.get('suhu_leher'),
                data.get('vbatt_leher'),
                data.get('latitude'),
                data.get('longitude'),
                data.get('spo2'),
                data.get('heart_rate')
            ))
            
            await self.db.commit()
            
            # Update device last seen
            await self.update_device_last_seen(device_id, timestamp)
            
            logger.debug(f"Saved sensor data for device {device_id}")
            
        except Exception as e:
            logger.error(f"Error saving sensor data: {e}")
            raise
    
    async def register_device(self, device_id: str, cow_id: str = None):
        """Register or update device"""
        try:
            await self.db.execute("""
                INSERT OR IGNORE INTO devices (device_id, cow_id, status)
                VALUES (?, ?, 'active')
            """, (device_id, cow_id))
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
    
    async def get_recent_data(self, limit: int = 100) -> List[Dict]:
        """Get recent sensor data from all devices"""
        try:
            cursor = await self.db.execute("""
                SELECT * FROM sensor_data
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))
            
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting recent data:  {e}")
            return []
    
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
            # Total records
            cursor = await self.db.execute("SELECT COUNT(*) as count FROM sensor_data")
            row = await cursor.fetchone()
            total_records = row['count']
            
            # Total devices
            cursor = await self. db.execute("SELECT COUNT(*) as count FROM devices")
            row = await cursor.fetchone()
            total_devices = row['count']
            
            # Records today
            today = datetime.now().date().isoformat()
            cursor = await self.db.execute("""
                SELECT COUNT(*) as count FROM sensor_data
                WHERE DATE(timestamp) = ?
            """, (today,))
            row = await cursor.fetchone()
            records_today = row['count']
            
            # Records last hour
            one_hour_ago = (datetime.now() - timedelta(hours=1)).isoformat()
            cursor = await self.db.execute("""
                SELECT COUNT(*) as count FROM sensor_data
                WHERE timestamp >= ?
            """, (one_hour_ago,))
            row = await cursor.fetchone()
            records_last_hour = row['count']
            
            return {
                "total_records":  total_records,
                "total_devices": total_devices,
                "records_today": records_today,
                "records_last_hour": records_last_hour,
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