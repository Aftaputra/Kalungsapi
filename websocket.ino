/*
 * FarmTech - ESP32 WebSocket Sensor Client
 * Kirim data sensor ke server via WebSocket
 * 
 * Library yang dibutuhkan:
 * - WiFi (built-in)
 * - WebSocketsClient by Markus Sattler
 * - ArduinoJson by Benoit Blanchon
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================
// KONFIGURASI
// ============================================================

// WiFi credentials
const char* ssid = "ata";           // Ganti dengan nama WiFi
const char* password = "atata123";   // Ganti dengan password WiFi

// Server WebSocket
const char* ws_host = "10.12.73.246";  // Ganti dengan IP server (laptop/PC)
const int ws_port = 8000;
const char* device_id = "DEV002";       // Device ID unik

// Sampling rate
const unsigned long SAMPLING_INTERVAL = 1000;  // Kirim data setiap 1 detik (1000ms)

// ============================================================
// OBJECTS
// ============================================================

WebSocketsClient webSocket;
unsigned long lastSampleTime = 0;
bool isConnected = false;

// ============================================================
// FUNGSI SENSOR (DUMMY - Ganti dengan sensor asli!)
// ============================================================

int16_t readIMU_X() {
  // TODO: Baca dari sensor IMU asli (MPU6050, etc)
  return random(-1000, 1000);  // Dummy: -10.00 to 10.00 m/s² (x100)
}

int16_t readIMU_Y() {
  return random(-1000, 1000);
}

int16_t readIMU_Z() {
  return random(-1000, 1000);
}

int16_t readSuhuKaki() {
  // TODO: Baca dari sensor suhu kaki (DS18B20, etc)
  return random(2500, 3500);  // Dummy: 25-35°C (x100)
}

uint16_t readBattKaki() {
  // TODO: Baca dari ADC untuk voltage kaki
  return random(3000, 4200);  // Dummy: 3.0-4.2V dalam mV
}

int16_t readSuhuLeher() {
  // TODO: Baca dari sensor suhu leher
  return random(2500, 3500);  // Dummy: 25-35°C (x100)
}

uint16_t readBattLeher() {
  // TODO: Baca dari ADC untuk voltage leher
  return random(3000, 4200);  // Dummy: 3.0-4.2V dalam mV
}

int32_t readLatitude() {
  // TODO: Baca dari GPS (NEO-6M, etc)
  return -77956000;  // Dummy: -7.7956° (x1e7)
}

int32_t readLongitude() {
  // TODO: Baca dari GPS
  return 1103695000;  // Dummy: 110.3695° (x1e7)
}

uint8_t readSpO2() {
  // TODO: Baca dari sensor MAX30102
  return random(95, 100);  // Dummy: 95-100%
}

uint8_t readHeartRate() {
  // TODO: Baca dari sensor MAX30102
  return random(60, 100);  // Dummy: 60-100 bpm
}

// ============================================================
// WEBSOCKET EVENT HANDLER
// ============================================================

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected!");
      isConnected = false;
      break;
      
    case WStype_CONNECTED:
      Serial. printf("[WS] Connected to: %s\n", payload);
      isConnected = true;
      break;
      
    case WStype_TEXT:
      {  // Scope untuk variable declarations
        Serial.printf("[WS] Received: %s\n", payload);
        
        // Parse response dari server
        DynamicJsonDocument doc(256);
        deserializeJson(doc, payload);
        
        const char* status = doc["status"];
        if (strcmp(status, "ok") == 0) {
          Serial.println("[WS] Data received by server ✓");
        }
      }
      break;
      
    case WStype_ERROR:
      Serial.println("[WS] Error!");
      break;
  }
}

// ============================================================
// KIRIM DATA SENSOR
// ============================================================

void sendSensorData() {
  if (!isConnected) {
    Serial.println("[WS] Not connected, skipping.. .");
    return;
  }
  
  // Buat JSON document
  DynamicJsonDocument doc(512);
  
  // Baca semua sensor
  doc["imu_x"] = readIMU_X();
  doc["imu_y"] = readIMU_Y();
  doc["imu_z"] = readIMU_Z();
  doc["suhu_kaki"] = readSuhuKaki();
  doc["vbatt_kaki"] = readBattKaki();
  doc["suhu_leher"] = readSuhuLeher();
  doc["vbatt_leher"] = readBattLeher();
  doc["latitude"] = readLatitude();
  doc["longitude"] = readLongitude();
  doc["spo2"] = readSpO2();
  doc["heart_rate"] = readHeartRate();
  
  // Convert ke JSON string
  String jsonString;
  serializeJson(doc, jsonString);
  
  // Kirim via WebSocket
  webSocket.sendTXT(jsonString);
  
  Serial.println("[DATA] Sent: " + jsonString);
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=================================");
  Serial.println("FarmTech ESP32 Sensor Client");
  Serial.printf("Device ID: %s\n", device_id);
  Serial.println("=================================\n");
  
  // Connect to WiFi
  Serial.printf("Connecting to WiFi: %s ", ssid);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n✓ WiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  
  // Setup WebSocket
  String ws_path = "/ws/esp32/" + String(device_id);
  Serial.printf("\nConnecting to WebSocket: ws://%s:%d%s\n", ws_host, ws_port, ws_path.c_str());
  
  webSocket.begin(ws_host, ws_port, ws_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);  // Reconnect setiap 5 detik jika terputus
  
  Serial.println("Setup complete!\n");
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  // Handle WebSocket
  webSocket.loop();
  
  // Kirim data setiap SAMPLING_INTERVAL
  unsigned long currentTime = millis();
  
  if (currentTime - lastSampleTime >= SAMPLING_INTERVAL) {
    lastSampleTime = currentTime;
    sendSensorData();
  }
}