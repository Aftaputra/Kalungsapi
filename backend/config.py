"""
Configuration for FarmTech Server
"""

import os
from pathlib import Path


class Config:
    """Server configuration"""
    
    # Server settings
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 8000))
    DEBUG = os.getenv("DEBUG", "True").lower() == "true"
    
    # Database settings
    DATABASE_PATH = os.getenv("DATABASE_PATH", "farmtech_data.db")
    
    # WebSocket settings
    WS_HEARTBEAT_INTERVAL = 30  # seconds
    WS_TIMEOUT = 60  # seconds
    
    # Data retention
    DATA_RETENTION_DAYS = int(os.getenv("DATA_RETENTION_DAYS", 30))
    
    # Logging
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    
    # CORS
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")