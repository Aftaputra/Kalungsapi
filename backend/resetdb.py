"""
Force reset database - Close all connections and recreate
"""

import os
import sys
import time
import sqlite3

DB_PATH = "farmtech_data.db"

def force_close_db():
    """Try to close any open connections"""
    try:
        # Connect and close immediately
        conn = sqlite3.connect(DB_PATH)
        conn.close()
        print("✓ Closed existing connections")
    except Exception as e:
        print(f"!  Error closing:  {e}")

def delete_database():
    """Delete database file"""
    max_attempts = 5
    
    for attempt in range(max_attempts):
        try:
            if os.path.exists(DB_PATH):
                os.remove(DB_PATH)
                print(f"✅ Database deleted:  {DB_PATH}")
                return True
            else:
                print("ℹ️  Database file not found")
                return True
        except PermissionError:
            print(f"⚠️  Attempt {attempt + 1}/{max_attempts}:  File is locked, retrying...")
            force_close_db()
            time.sleep(1)
        except Exception as e:
            print(f"❌ Error:  {e}")
            return False
    
    print("❌ Failed to delete database after multiple attempts")
    print("\n💡 Try these steps:")
    print("   1. Close all terminal windows")
    print("   2. Close DB Browser for SQLite")
    print("   3. Restart VS Code")
    print("   4. Run this script again")
    return False

def create_new_database():
    """Create new database with correct schema"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn. cursor()
        
        # Sensor data table
        cursor.execute("""
            CREATE TABLE sensor_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                batch_id INTEGER NOT NULL,
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
        
        # IMU data table
        cursor.execute("""
            CREATE TABLE imu_data (
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
        
        # Devices table
        cursor.execute("""
            CREATE TABLE devices (
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
        
        conn.commit()
        conn.close()
        
        print("✅ New database created with split schema")
        return True
        
    except Exception as e:
        print(f"❌ Error creating database: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("FORCE DATABASE RESET")
    print("=" * 60)
    print()
    
    # Step 1: Delete old database
    if delete_database():
        print()
        # Step 2: Create new database
        if create_new_database():
            print()
            print("🎉 Database reset successful!")
            print(f"📁 Location: {os.path.abspath(DB_PATH)}")
            print()
            print("You can now run:  python server.py")
        else:
            sys.exit(1)
    else:
        sys.exit(1)