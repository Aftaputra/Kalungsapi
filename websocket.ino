/*
 * FarmTech - ESP32 LoRa to WebSocket Bridge (DUAL ENDPOINT)
 * 1.  Sensor data → /ws/esp32/sensor/{device_id} @ ~0.7Hz (per batch)
 * 2. IMU data → /ws/esp32/imu/{device_id} @ 20Hz (29 samples)
 * 
 * Library yang dibutuhkan:  
 * - WiFi (built-in)
 * - WebSocketsClient by Markus Sattler
 * - ArduinoJson by Benoit Blanchon
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================
// KONFIGURASI WiFi & WebSocket
// ============================================================

const char* ssid = "ata";
const char* password = "atata123";

const char* ws_host = "10.12.73.44";
const int ws_port = 8000;
const char* device_id = "DEV003";

// ============================================================
// KONFIGURASI LORA
// ============================================================

#define LORA_RX     17
#define LORA_TX     16
#define LORA_AUX    4
#define BATCH_SIZE  29
#define JOINT_ID    0xAA

HardwareSerial loraSerial(2);

// IMU sampling rate:  20Hz = 50ms per sample
const unsigned long IMU_INTERVAL_MS = 50;

// ============================================================
// STRUKTUR DATA LORA
// ============================================================

typedef struct {
  int16_t ax;
  int16_t ay;
  int16_t az;
} imu_packet_t;

typedef struct __attribute__((packed)) {
  uint8_t  id;        
  uint16_t seq_start;
  int16_t  tempC;
  uint16_t vbat;
  uint8_t  count;
  imu_packet_t sample[BATCH_SIZE];
  int16_t  tempC2;
  uint16_t vbat2;
  uint8_t  spo2;
  uint8_t  hr;
  int32_t  lat;
  int32_t  lon;
} joint_packet_t;

joint_packet_t pkt;

// ============================================================
// WEBSOCKET (2 KONEKSI)
// ============================================================

WebSocketsClient wsSensor;   // Untuk sensor data
WebSocketsClient wsIMU;      // Untuk IMU data

bool sensorConnected = false;
bool imuConnected = false;

uint32_t batchCounter = 0;

// ============================================================
// WEBSOCKET EVENT HANDLERS
// ============================================================

void sensorEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED: 
      Serial.println("[SENSOR WS] Disconnected");
      sensorConnected = false;
      break;
      
    case WStype_CONNECTED:  
      Serial.printf("[SENSOR WS] ✓ Connected to:  %s\n", payload);
      sensorConnected = true;
      break;
      
    case WStype_TEXT:
      Serial.printf("[SENSOR WS] ← %s\n", payload);
      break;
      
    case WStype_ERROR:
      Serial.println("[SENSOR WS] Error!");
      break;
  }
}

void imuEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[IMU WS] Disconnected");
      imuConnected = false;
      break;
      
    case WStype_CONNECTED: 
      Serial.printf("[IMU WS] ✓ Connected to: %s\n", payload);
      imuConnected = true;
      break;
      
    case WStype_TEXT:
      // Silent untuk 20Hz (tidak print response)
      break;
      
    case WStype_ERROR: 
      Serial.println("[IMU WS] Error!");
      break;
  }
}

// ============================================================
// 1.  KIRIM SENSOR DATA (1x per batch) 
// ============================================================

void sendSensorData(const joint_packet_t &pkt, uint32_t batch_id) {
  if (!sensorConnected) {
    Serial.println("[SENSOR] Not connected, skipping.. .");
    return;
  }
  
  DynamicJsonDocument doc(512);
  
  doc["batch_id"] = batch_id;
  doc["suhu_kaki"] = pkt.tempC;
  doc["vbatt_kaki"] = pkt.vbat;
  doc["suhu_leher"] = pkt.tempC2;
  doc["vbatt_leher"] = pkt.vbat2;
  doc["latitude"] = pkt.lat;
  doc["longitude"] = pkt.lon;
  doc["spo2"] = pkt.spo2;
  doc["heart_rate"] = pkt.hr;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  wsSensor.sendTXT(jsonString);
  
  Serial.printf("[SENSOR] ✓ Sent batch %u (%u bytes)\n", batch_id, jsonString.length());
}

// ============================================================
// 2. KIRIM IMU DATA @ 20Hz (29x per batch)
// ============================================================

void sendIMUData(const joint_packet_t &pkt, uint32_t batch_id) {
  if (!imuConnected) {
    Serial.println("[IMU] Not connected, skipping...");
    return;
  }
  
  uint8_t validCount = (pkt.count > BATCH_SIZE) ? BATCH_SIZE : pkt.count;
  
  Serial.printf("[IMU] ⚡ Sending %u samples @ 20Hz.. .\n", validCount);
  
  unsigned long batchStart = millis();
  uint8_t successCount = 0;
  
  for (uint8_t i = 0; i < validCount; i++) {
    DynamicJsonDocument doc(256);
    
    doc["batch_id"] = batch_id;
    doc["sample_index"] = i;
    doc["imu_x"] = pkt.sample[i].ax;
    doc["imu_y"] = pkt.sample[i].ay;
    doc["imu_z"] = pkt.sample[i].az;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    if (wsIMU.sendTXT(jsonString)) {
      successCount++;
    }
    
    // Print progress setiap 10 sample
    if ((i + 1) % 10 == 0 || i == validCount - 1) {
      Serial.printf("  → Sent %u/%u samples\n", i + 1, validCount);
    }
    
    // Delay 50ms untuk 20Hz (kecuali sample terakhir)
    if (i < validCount - 1) {
      unsigned long startDelay = millis();
      
      // Delay sambil handle WebSocket
      while (millis() - startDelay < IMU_INTERVAL_MS) {
        wsIMU.loop();
        wsSensor.loop();
        delay(1);
      }
    }
  }
  
  unsigned long elapsed = millis() - batchStart;
  float rate = (successCount * 1000.0) / elapsed;
  
  Serial.printf("[IMU] ✓ Complete:  %u/%u in %lums (%. 1f Hz)\n", 
                successCount, validCount, elapsed, rate);
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n╔═══════════════════════════════════════════╗");
  Serial.println("║  FarmTech LoRa → WebSocket (Dual EP)    ║");
  Serial.println("║  Sensor:  ~0.7Hz | IMU: 20Hz             ║");
  Serial.println("╚═══════════════════════════════════════════╝\n");
  Serial.printf("Device ID: %s\n\n", device_id);
  
  // Setup LoRa
  pinMode(LORA_AUX, INPUT);
  loraSerial.begin(57600, SERIAL_8N1, LORA_RX, LORA_TX);
  Serial.println("✓ LoRa Serial initialized");
  
  // Connect to WiFi
  Serial.printf("📡 Connecting to WiFi:  %s ", ssid);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial. println("\n✓ WiFi connected!");
  Serial.printf("📍 IP:  %s\n\n", WiFi.localIP().toString().c_str());
  
  // Setup WebSocket SENSOR endpoint
  String sensor_path = "/ws/esp32/sensor/" + String(device_id);
  Serial.println("🔌 Connecting to SENSOR endpoint...");
  Serial.printf("   ws://%s:%d%s\n", ws_host, ws_port, sensor_path.c_str());
  
  wsSensor.begin(ws_host, ws_port, sensor_path);
  wsSensor.onEvent(sensorEvent);
  wsSensor.setReconnectInterval(5000);
  
  // Setup WebSocket IMU endpoint
  String imu_path = "/ws/esp32/imu/" + String(device_id);
  Serial.println("\n🔌 Connecting to IMU endpoint...");
  Serial.printf("   ws://%s:%d%s\n", ws_host, ws_port, imu_path.c_str());
  
  wsIMU. begin(ws_host, ws_port, imu_path);
  wsIMU.onEvent(imuEvent);
  wsIMU.setReconnectInterval(5000);
  
  // Wait for both connections
  Serial.println("\n⏳ Waiting for connections.. .");
  unsigned long waitStart = millis();
  while ((! sensorConnected || !imuConnected) && millis() - waitStart < 10000) {
    wsSensor.loop();
    wsIMU.loop();
    delay(100);
  }
  
  if (sensorConnected && imuConnected) {
    Serial.println("\n✅ Both endpoints connected!");
    Serial.println("🚀 Ready to receive LoRa data.. .\n");
  } else {
    Serial.println("\n⚠️  Connection incomplete:");
    Serial.printf("   Sensor: %s\n", sensorConnected ? "✓" : "✗");
    Serial.printf("   IMU:    %s\n", imuConnected ? "✓" : "✗");
  }
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  // Handle both WebSocket connections
  wsSensor. loop();
  wsIMU.loop();
  
  // Cek data dari LoRa
  if (loraSerial.available() >= sizeof(joint_packet_t)) {
    
    // Cari packet header (JOINT_ID)
    if (loraSerial.read() != JOINT_ID) {
      return;
    }
    
    // Baca sisa packet
    loraSerial. readBytes(
      ((uint8_t*)&pkt) + 1,
      sizeof(joint_packet_t) - 1
    );
    
    // Validasi count
    if (pkt.count > BATCH_SIZE) {
      pkt.count = BATCH_SIZE;
    }
    
    batchCounter++;
    
    Serial.println("\n═══════════════════════════════════════════");
    Serial.printf("BATCH #%u RECEIVED\n", batchCounter);
    Serial.println("═══════════════════════════════════════════");
    Serial.printf("  ID: 0x%02X | Seq:  %u | Samples: %u\n", 
                  pkt.id, pkt.seq_start, pkt.count);
    Serial.printf("  Temp Kaki: %d (%.1f°C) | Vbat: %u mV\n", 
                  pkt.tempC, pkt.tempC/100.0, pkt.vbat);
    Serial.printf("  Temp Leher: %d (%.1f°C) | Vbat: %u mV\n", 
                  pkt.tempC2, pkt.tempC2/100.0, pkt.vbat2);
    Serial.printf("  SpO2: %u%% | HR: %u bpm\n", pkt.spo2, pkt.hr);
    Serial.printf("  GPS:  %. 6f, %.6f\n", pkt.lat/1e7, pkt.lon/1e7);
    Serial.println("───────────────────────────────────────────");
    
    // 1. Kirim data SENSOR (1x)
    sendSensorData(pkt, batchCounter);
    
    delay(50);
    
    // 2. Kirim data IMU (29x @ 20Hz)
    sendIMUData(pkt, batchCounter);
    
    Serial.println("═══════════════════════════════════════════");
    Serial.printf("BATCH #%u COMPLETE\n", batchCounter);
    Serial.println("═══════════════════════════════════════════\n");
  }
}