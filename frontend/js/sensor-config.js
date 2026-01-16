// ============================================================
// SENSOR CONFIGURATION
// Konfigurasi sensor berdasarkan spesifikasi payload
// ============================================================

const SENSOR_CONFIG = [
  {
    no: 1,
    field: "imu_x",
    type: "int16",
    scale: "value/100",
    unit: "m/s²",
    displayName: "IMU X",
    category: "imu",
    thresholds: { low: -20, high: 20 }
  },
  {
    no: 2,
    field:  "imu_y",
    type: "int16",
    scale: "value/100",
    unit: "m/s²",
    displayName: "IMU Y",
    category: "imu",
    thresholds: { low: -20, high: 20 }
  },
  {
    no: 3,
    field: "imu_z",
    type:  "int16",
    scale:  "value/100",
    unit: "m/s²",
    displayName: "IMU Z",
    category: "imu",
    thresholds: { low: -20, high: 20 }
  },
  {
    no: 4,
    field: "suhu_kaki",
    type: "int16",
    scale: "value/100",
    unit: "°C",
    displayName:  "Suhu Kaki",
    category: "temperature",
    thresholds: { low:  15, high: 40 }
  },
  {
    no: 5,
    field: "vbatt_kaki",
    type: "uint16",
    scale: "value",
    unit: "mV",
    displayName: "Baterai Kaki",
    category: "power",
    thresholds: { low: 3000, high: 4200 }
  },
  {
    no: 6,
    field: "suhu_leher",
    type: "int16",
    scale: "value/100",
    unit: "°C",
    displayName: "Suhu Leher",
    category: "temperature",
    thresholds:  { low: 15, high:  40 }
  },
  {
    no: 7,
    field: "vbatt_leher",
    type: "uint16",
    scale: "value",
    unit:  "mV",
    displayName: "Baterai Leher",
    category: "power",
    thresholds: { low: 3000, high:  4200 }
  },
  {
    no: 8,
    field: "latitude",
    type: "int32",
    scale: "value/1e7",
    unit: "deg",
    displayName: "Latitude",
    category: "gps",
    thresholds:  null
  },
  {
    no: 9,
    field: "longitude",
    type:  "int32",
    scale:  "value/1e7",
    unit: "deg",
    displayName: "Longitude",
    category: "gps",
    thresholds: null
  },
  {
    no:  10,
    field: "spo2",
    type: "uint8",
    scale: "value",
    unit: "%",
    displayName: "SpO2",
    category: "health",
    thresholds: { low: 90, high: 100 }
  },
  {
    no: 11,
    field:  "heart_rate",
    type: "uint8",
    scale: "value",
    unit: "bpm",
    displayName: "Heart Rate",
    category: "health",
    thresholds: { low: 60, high: 100 }
  }
];

// Category definitions untuk filtering
const SENSOR_CATEGORIES = {
  all: { name: "Semua Sensor", icon: "fa-list" },
  health: { name: "Health Sensors", icon: "fa-heart-pulse" },
  imu: { name: "IMU Sensors", icon: "fa-compass" },
  gps: { name: "GPS", icon: "fa-location-dot" },
  temperature: { name: "Temperature", icon: "fa-temperature-half" },
  power: { name: "Power/Battery", icon: "fa-battery-three-quarters" }
};

// Function untuk apply scale transformation
function applySensorScale(field, rawValue) {
  const sensor = SENSOR_CONFIG.find(s => s.field === field);
  if (!sensor) return rawValue;

  const scaleExpr = sensor.scale;
  
  // Parse scale expression
  if (scaleExpr === "value") {
    return rawValue;
  } else if (scaleExpr. includes("/")) {
    const divisor = eval(scaleExpr.split("/")[1]);
    return rawValue / divisor;
  }
  
  return rawValue;
}

// Function untuk format nilai dengan unit
function formatSensorValue(field, value) {
  const sensor = SENSOR_CONFIG.find(s => s.field === field);
  if (!sensor) return value;

  const scaledValue = applySensorScale(field, value);
  
  // Format berdasarkan tipe
  let formatted;
  if (sensor.type. includes("int16") || sensor.type === "int32") {
    formatted = scaledValue.toFixed(2);
  } else if (sensor.type === "uint8" || sensor.type === "uint16") {
    formatted = Math.round(scaledValue);
  } else {
    formatted = scaledValue;
  }

  return `${formatted} ${sensor.unit}`;
}

// Function untuk check apakah nilai dalam threshold
function checkThreshold(field, value) {
  const sensor = SENSOR_CONFIG. find(s => s.field === field);
  if (!sensor || !sensor.thresholds) return "normal";

  const scaledValue = applySensorScale(field, value);
  
  if (scaledValue < sensor.thresholds.low) return "low";
  if (scaledValue > sensor.thresholds.high) return "high";
  return "normal";
}

// Get sensors by category
function getSensorsByCategory(category) {
  if (category === "all") return SENSOR_CONFIG;
  return SENSOR_CONFIG.filter(s => s.category === category);
}