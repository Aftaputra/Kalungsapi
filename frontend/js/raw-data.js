// ============================================================
// FARMTECH RAW DATA DASHBOARD - WebSocket Integrated
// Main JavaScript file untuk raw data monitoring
// ============================================================

// Global state
const state = {
    devices: [],
    sensorReadings: [],
    filteredData: [],
    currentPage: 1,
    rowsPerPage: 50,
    selectedDevice: 'all',
    selectedTimeRange: '24h',
    selectedSensorType: 'all',
    charts: {},
    ws: null
};

// ============================================================
// WebSocket Connection
// ============================================================

/**
 * Initialize WebSocket connection
 */
function initializeWebSocket() {
    state.ws = new FarmTechWebSocket();
    
    // Set up callbacks
    state.ws.onInitialData = handleInitialData;
    state. ws.onSensorData = handleNewSensorData;
    state. ws.onDeviceConnected = handleDeviceConnected;
    state.ws. onDeviceDisconnected = handleDeviceDisconnected;
    state.ws.onStatistics = handleStatistics;
    state. ws.onConnectionChange = handleConnectionChange;
    
    // Connect
    state.ws.connect();
}

/**
 * Handle initial data from server
 */
function handleInitialData(data) {
    console.log('📦 Received initial data from server');
    
    if (! data) {
        console.warn('No initial data');
        return;
    }
    
    // ✅ HANYA update devices dan connected status, JANGAN replace data yang sudah ada
    if (data.devices && Array.isArray(data.devices)) {
        // Update devices (tapi jangan hapus data sensor)
        const newDevices = data.devices.map(device => ({
            id: device.device_id,
            cowId: device.cow_id || device.device_id. replace('DEV', ''),
            status: determineDeviceStatus(device.last_seen),
            signal: 'strong',
            lastData: device.last_seen ?  new Date(device.last_seen) : new Date(),
            firmwareVersion: device.firmware_version || 'Unknown'
        }));
        
        // Merge dengan existing devices
        newDevices.forEach(newDev => {
            const existing = state.devices.find(d => d.id === newDev.id);
            if (existing) {
                Object.assign(existing, newDev);
            } else {
                state.devices.push(newDev);
            }
        });
    }
    
    // ✅ HANYA load data dari server jika state kosong
    if (state. sensorReadings.length === 0 && data.sensor_readings && data.sensor_readings.length > 0) {
        state.sensorReadings = data.sensor_readings. map(reading => ({
            timestamp: reading.timestamp,
            deviceId: reading.device_id,
            imu_x: reading.imu_x || 0,
            imu_y: reading.imu_y || 0,
            imu_z: reading.imu_z || 0,
            suhu_kaki: reading.suhu_kaki || 0,
            vbatt_kaki: reading.vbatt_kaki || 0,
            suhu_leher: reading.suhu_leher || 0,
            vbatt_leher: reading. vbatt_leher || 0,
            latitude: reading.latitude || 0,
            longitude: reading.longitude || 0,
            spo2: reading.spo2 || 0,
            heart_rate: reading.heart_rate || 0
        }));
        
        console.log(`✅ Loaded ${state.sensorReadings.length} initial readings`);
    }
    
    // Update connected devices
    if (data.connected_devices && Array.isArray(data.connected_devices)) {
        data.connected_devices.forEach(deviceId => {
            const device = state.devices.find(d => d.id === deviceId);
            if (device) device.status = 'online';
        });
    }
    
    // Update UI
    requestAnimationFrame(() => {
        populateFilters();
        applyFilters();
        updateQuickStats();
        renderDeviceStatus();
        initializeCharts();
    });
}

/**
 * Handle new sensor data (real-time)
 */
function handleNewSensorData(data) {
    console.log('📊 New sensor data:', data. device_id);
    
    // Convert to internal format
    const newReading = {
        timestamp: data.timestamp,
        deviceId: data.device_id,
        imu_x: data.imu_x || 0,
        imu_y: data. imu_y || 0,
        imu_z: data.imu_z || 0,
        suhu_kaki: data.suhu_kaki || 0,
        vbatt_kaki: data.vbatt_kaki || 0,
        suhu_leher: data.suhu_leher || 0,
        vbatt_leher: data.vbatt_leher || 0,
        latitude: data.latitude || 0,
        longitude:  data.longitude || 0,
        spo2: data.spo2 || 0,
        heart_rate: data.heart_rate || 0
    };
    
    // Add to beginning (newest first)
    state.sensorReadings.unshift(newReading);
    
    // Keep only last 1000 readings
    if (state.sensorReadings. length > 1000) {
        state.sensorReadings = state.sensorReadings.slice(0, 1000);
    }
    
    // ✅ SAVE to localStorage
    saveDataToLocalStorage();
    
    // Update device status
    const device = state. devices.find(d => d. id === data.device_id);
    if (device) {
        device.lastData = new Date(data.timestamp);
        device.status = 'online';
    }
    
    // Update UI (tanpa reload penuh)
    updateUIIncremental();
}

/**
 * Handle device connected event
 */
function handleDeviceConnected(deviceId) {
    console.log('🔌 Device connected:', deviceId);
    
    let device = state.devices.find(d => d.id === deviceId);
    
    if (!device) {
        // New device, add to list
        device = {
            id: deviceId,
            cowId: deviceId.replace('DEV', ''),
            status: 'online',
            signal: 'strong',
            lastData:  new Date(),
            firmwareVersion: 'Unknown'
        };
        state.devices.push(device);
        populateFilters();
    } else {
        device.status = 'online';
    }
    
    renderDeviceStatus();
    updateQuickStats();
}

/**
 * Save data to localStorage
 */
function saveDataToLocalStorage() {
    try {
        const dataToSave = {
            sensorReadings: state.sensorReadings. slice(0, 500), // Save last 500
            devices: state.devices,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('farmtech_data', JSON.stringify(dataToSave));
    } catch (e) {
        console.warn('Failed to save to localStorage:', e);
    }
}

/**
 * Load data from localStorage
 */
function loadDataFromLocalStorage() {
    try {
        const saved = localStorage.getItem('farmtech_data');
        if (saved) {
            const data = JSON.parse(saved);
            state.sensorReadings = data. sensorReadings || [];
            state.devices = data.devices || [];
            console.log(`📦 Loaded ${state. sensorReadings.length} readings from localStorage`);
            return true;
        }
    } catch (e) {
        console.warn('Failed to load from localStorage:', e);
    }
    return false;
}

/**
 * Update UI incrementally (tanpa reload penuh)
 */
function updateUIIncremental() {
    // Update stats
    updateQuickStats();
    
    // Update table HANYA jika di halaman 1
    if (state.currentPage === 1) {
        renderSensorDataTable();
    }
    
    // Update device status
    renderDeviceStatus();
    
    // Update chart setiap 10 data
    if (state.sensorReadings.length % 10 === 0) {
        updateCharts();
    }
}

/**
 * Handle device disconnected event
 */
function handleDeviceDisconnected(deviceId) {
    console.log('🔌 Device disconnected:', deviceId);
    
    const device = state.devices.find(d => d.id === deviceId);
    if (device) {
        device.status = 'offline';
    }
    
    renderDeviceStatus();
    updateQuickStats();
}

/**
 * Handle statistics update
 */
function handleStatistics(stats) {
    console.log('📈 Statistics updated:', stats);
}

/**
 * Handle connection status change
 */
function handleConnectionChange(connected) {
    console.log('🌐 Connection status:', connected ? 'Connected' : 'Disconnected');
}

/**
 * Determine device status based on last seen time
 */
function determineDeviceStatus(lastSeen) {
    if (!lastSeen) return 'offline';
    
    const lastSeenTime = new Date(lastSeen).getTime();
    const now = Date.now();
    const diffMinutes = (now - lastSeenTime) / 60000;
    
    if (diffMinutes < 5) return 'online';
    if (diffMinutes < 15) return 'warning';
    return 'offline';
}

// ============================================================
// UI RENDERING FUNCTIONS
// ============================================================

/**
 * Render table header dynamically based on SENSOR_CONFIG
 */
function renderTableHeader() {
    const thead = document.getElementById('tableHeader');
    const headers = ['Timestamp', 'Device ID'];
    
    // Add sensor columns based on filter
    const sensors = getSensorsByCategory(state.selectedSensorType);
    sensors.forEach(sensor => {
        headers.push(`${sensor.displayName}<br><span class="text-xs font-normal">(${sensor.unit})</span>`);
    });

    thead.innerHTML = `
        <tr>
            ${headers.map(h => `<th>${h}</th>`).join('')}
        </tr>
    `;
}

/**
 * Render sensor data table
 */
function renderSensorDataTable() {
    const tableBody = document.getElementById('sensorDataBody');
    const rowCount = document.getElementById('rowCount');
    const totalRows = document.getElementById('totalRows');
    
    tableBody.innerHTML = '';
    
    const startIdx = (state.currentPage - 1) * state.rowsPerPage;
    const endIdx = startIdx + state.rowsPerPage;
    const pageData = state.filteredData.slice(startIdx, endIdx);
    
    rowCount.textContent = pageData.length;
    totalRows.textContent = state.filteredData.length;

    if (pageData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="100" class="text-center py-8 text-gray-500">No data available</td></tr>';
        return;
    }

    const sensors = getSensorsByCategory(state. selectedSensorType);

    pageData.forEach(reading => {
        const row = document.createElement('tr');
        
        // Format timestamp
        const timestamp = new Date(reading.timestamp);
        const timeStr = timestamp.toLocaleString('id-ID', {
            year: 'numeric',
            month: '2-digit',
            day:  '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let cells = [
            `<td class="font-mono text-xs">${timeStr}</td>`,
            `<td class="font-medium">${reading.deviceId}</td>`
        ];

        // Add sensor value cells
        sensors.forEach(sensor => {
            const rawValue = reading[sensor.field];
            if (rawValue === null || rawValue === undefined) {
                cells.push(`<td class="text-gray-400">-</td>`);
                return;
            }
            
            const scaledValue = applySensorScale(sensor.field, rawValue);
            const threshold = checkThreshold(sensor.field, rawValue);
            
            let cellClass = 'value-normal';
            if (threshold === 'high') cellClass = 'value-high';
            else if (threshold === 'low') cellClass = 'value-low';

            let formattedValue;
            if (sensor.type. includes('int16') || sensor.type === 'int32') {
                formattedValue = scaledValue.toFixed(2);
            } else {
                formattedValue = Math.round(scaledValue);
            }

            cells.push(`<td class="${cellClass}">${formattedValue}</td>`);
        });

        row.innerHTML = cells.join('');
        tableBody.appendChild(row);
    });

    // Update last update time
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('id-ID');
}

/**
 * Render device status table
 */
function renderDeviceStatus() {
    const tableBody = document.getElementById('deviceStatusBody');
    tableBody.innerHTML = '';

    if (state.devices.length === 0) {
        tableBody. innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">No devices registered</td></tr>';
        return;
    }

    state.devices.forEach(device => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50';
        
        // Get latest battery values from sensor data
        const latestData = state.sensorReadings. find(r => r.deviceId === device. id);
        const battLeher = latestData ? Math.round(applySensorScale('vbatt_leher', latestData.vbatt_leher)) : 0;
        const battKaki = latestData ? Math.round(applySensorScale('vbatt_kaki', latestData. vbatt_kaki)) : 0;

        // Status indicator
        let statusIndicator, statusClass;
        if (device.status === 'online') {
            statusIndicator = '<span class="sensor-status sensor-online"></span>';
            statusClass = 'text-green-600';
        } else if (device. status === 'warning') {
            statusIndicator = '<span class="sensor-status sensor-warning"></span>';
            statusClass = 'text-amber-600';
        } else {
            statusIndicator = '<span class="sensor-status sensor-offline"></span>';
            statusClass = 'text-gray-500';
        }

        // Battery indicators
        let battLeherClass = battLeher > 3700 ? 'text-green-600' : battLeher > 3300 ? 'text-amber-600' : 'text-red-600';
        let battKakiClass = battKaki > 3700 ? 'text-green-600' : battKaki > 3300 ? 'text-amber-600' : 'text-red-600';

        // Signal indicator
        let signalClass = device.signal === 'strong' ? 'text-green-600' : 
                         device.signal === 'medium' ? 'text-amber-600' : 
                         device.signal === 'weak' ?  'text-red-600' : 'text-gray-500';

        // Time since last data
        const timeDiff = Date.now() - device.lastData.getTime();
        const minutes = Math.floor(timeDiff / 60000);
        const lastDataStr = minutes < 1 ? 'Just now' : 
                           minutes < 60 ? `${minutes} min ago` :
                           `${Math.floor(minutes / 60)}h ago`;

        row.innerHTML = `
            <td class="py-3 font-medium">${device.id}</td>
            <td class="py-3">Sapi #${device.cowId}</td>
            <td class="py-3">
                ${statusIndicator}
                <span class="${statusClass}">${device.status. toUpperCase()}</span>
            </td>
            <td class="py-3 ${battLeherClass} font-medium">${battLeher} mV</td>
            <td class="py-3 ${battKakiClass} font-medium">${battKaki} mV</td>
            <td class="py-3 ${signalClass}">
                <i class="fa-solid fa-wifi mr-1"></i> ${device.signal}
            </td>
            <td class="py-3">${lastDataStr}</td>
        `;

        row.addEventListener('click', () => selectDevice(device.id));
        tableBody.appendChild(row);
    });
}

/**
 * Select device and update UI
 */
function selectDevice(deviceId) {
    document.getElementById('selectedDevice').textContent = deviceId;
    document.getElementById('deviceSelect').value = deviceId;
    state.selectedDevice = deviceId;
    applyFilters();
}

/**
 * Update quick stats
 */
function updateQuickStats() {
    const onlineDevices = state.devices.filter(d => d.status === 'online').length;
    const warningDevices = state.devices.filter(d => d.status === 'warning').length;
    
    document.getElementById('totalDevices').textContent = state. devices.length;
    document. getElementById('deviceStatus').innerHTML = `
        <span class="sensor-status sensor-online"></span> ${onlineDevices} Online
        <span class="sensor-status sensor-warning ml-3"></span> ${warningDevices} Warning
    `;
    
    document.getElementById('totalDataPoints').textContent = 
        state.sensorReadings.length > 1000 ? 
        `${(state.sensorReadings.length / 1000).toFixed(1)}K` : 
        state.sensorReadings.length;
    
    const recentCount = state.sensorReadings. filter(r => 
        new Date(r.timestamp) > new Date(Date.now() - 3600000)
    ).length;
    document.getElementById('recentDataPoints').textContent = `+${recentCount} dalam 1 jam terakhir`;
    
    // Estimate data size (rough calculation)
    const dataSize = (state.sensorReadings.length * 150) / (1024 * 1024);
    document.getElementById('totalDataSize').textContent = `${dataSize.toFixed(1)} MB`;
    
    const todayData = state.sensorReadings. filter(r => {
        const rDate = new Date(r.timestamp);
        const today = new Date();
        return rDate.toDateString() === today.toDateString();
    }).length;
    const todaySize = (todayData * 150) / (1024 * 1024);
    document.getElementById('todayDataSize').textContent = `Hari ini:  ${todaySize.toFixed(1)} MB`;
}

/**
 * Populate filters based on SENSOR_CONFIG
 */
function populateFilters() {
    // Populate device select
    const deviceSelect = document. getElementById('deviceSelect');
    deviceSelect.innerHTML = '<option value="all">Semua Device</option>';
    state.devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = `${device.id} - Sapi #${device.cowId}`;
        deviceSelect.appendChild(option);
    });

    // Populate sensor type select
    const sensorTypeSelect = document.getElementById('sensorType');
    sensorTypeSelect. innerHTML = '';
    Object.keys(SENSOR_CATEGORIES).forEach(key => {
        const category = SENSOR_CATEGORIES[key];
        const option = document.createElement('option');
        option.value = key;
        option.textContent = category.name;
        sensorTypeSelect.appendChild(option);
    });

    // Populate export columns
    const exportColumns = document.getElementById('exportColumns');
    exportColumns.innerHTML = `
        <div class="space-y-2">
            <label class="flex items-center">
                <input type="checkbox" checked class="mr-2" value="timestamp"> Timestamp
            </label>
            <label class="flex items-center">
                <input type="checkbox" checked class="mr-2" value="deviceId"> Device ID
            </label>
    `;
    SENSOR_CONFIG.forEach(sensor => {
        exportColumns.innerHTML += `
            <label class="flex items-center">
                <input type="checkbox" checked class="mr-2" value="${sensor.field}"> 
                ${sensor.displayName} (${sensor.unit})
            </label>
        `;
    });
    exportColumns.innerHTML += '</div>';
}

// ============================================================
// CHART FUNCTIONS
// ============================================================

/**
 * Initialize temperature chart
 */
function initTemperatureChart() {
    const ctx = document.getElementById('tempChart');
    if (!ctx) return;

    const labels = [];
    const suhuLeherData = [];
    const suhuKakiData = [];

    // Get last 24 hours of data
    const last24h = state.sensorReadings. filter(r => 
        new Date(r.timestamp) > new Date(Date.now() - 24 * 3600000)
    );

    // Group by hour
    for (let i = 23; i >= 0; i--) {
        const hourStart = new Date(Date.now() - i * 3600000);
        const hourEnd = new Date(hourStart.getTime() + 3600000);
        
        const hourData = last24h.filter(r => {
            const t = new Date(r.timestamp);
            return t >= hourStart && t < hourEnd;
        });

        labels.push(hourStart.getHours() + ':00');

        if (hourData.length > 0) {
            const avgLeher = hourData.reduce((sum, r) => 
                sum + applySensorScale('suhu_leher', r.suhu_leher), 0) / hourData.length;
            const avgKaki = hourData.reduce((sum, r) => 
                sum + applySensorScale('suhu_kaki', r. suhu_kaki), 0) / hourData.length;
            
            suhuLeherData.push(avgLeher);
            suhuKakiData.push(avgKaki);
        } else {
            suhuLeherData.push(null);
            suhuKakiData.push(null);
        }
    }

    if (state.charts.tempChart) {
        state.charts.tempChart.destroy();
    }

    state.charts.tempChart = new Chart(ctx, {
        type:  'line',
        data:  {
            labels: labels,
            datasets: [
                {
                    label: 'Suhu Leher (°C)',
                    data:  suhuLeherData,
                    borderColor: '#ef4444',
                    backgroundColor:  'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Suhu Kaki (°C)',
                    data: suhuKakiData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend:  {
                    position: 'top',
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display:  false
                    }
                }
            }
        }
    });
}

/**
 * Initialize IMU chart
 */
function initIMUChart() {
    const ctx = document.getElementById('imuChart');
    if (!ctx) return;

    // Get latest 50 readings
    const latest = state.sensorReadings.slice(0, 50).reverse();
    
    const labels = latest.map((_, idx) => idx);
    const imuXData = latest.map(r => applySensorScale('imu_x', r.imu_x));
    const imuYData = latest.map(r => applySensorScale('imu_y', r.imu_y));
    const imuZData = latest.map(r => applySensorScale('imu_z', r.imu_z));

    if (state.charts.imuChart) {
        state.charts. imuChart.destroy();
    }

    state.charts.imuChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets:  [
                {
                    label: 'IMU X (m/s²)',
                    data: imuXData,
                    borderColor: '#ef4444',
                    backgroundColor:  'rgba(239, 68, 68, 0.1)',
                    borderWidth: 1,
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'IMU Y (m/s²)',
                    data: imuYData,
                    borderColor: '#3b82f6',
                    backgroundColor:  'rgba(59, 130, 246, 0.1)',
                    borderWidth: 1,
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'IMU Z (m/s²)',
                    data: imuZData,
                    borderColor:  '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 1,
                    fill: false,
                    tension:  0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins:  {
                legend: {
                    position: 'top',
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    title: {
                        display: true,
                        text: 'Acceleration (m/s²)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Sample Index'
                    }
                }
            }
        }
    });
}

/**
 * Initialize all charts
 */
function initializeCharts() {
    initTemperatureChart();
    initIMUChart();
}

/**
 * Update charts with new data
 */
function updateCharts() {
    initTemperatureChart();
    initIMUChart();
}

// ============================================================
// FILTER & EXPORT FUNCTIONS
// ============================================================

/**
 * Apply filters to data
 */
function applyFilters() {
    state.filteredData = state.sensorReadings;

    // Filter by device
    if (state.selectedDevice !== 'all') {
        state.filteredData = state.filteredData.filter(r => 
            r.deviceId === state.selectedDevice
        );
    }

    // Filter by time range
    const now = Date.now();
    let timeThreshold;
    switch(state.selectedTimeRange) {
        case '1h':  timeThreshold = now - 3600000; break;
        case '6h':  timeThreshold = now - 6 * 3600000; break;
        case '24h':  timeThreshold = now - 24 * 3600000; break;
        case '7d': timeThreshold = now - 7 * 24 * 3600000; break;
        case '30d': timeThreshold = now - 30 * 24 * 3600000; break;
        default: timeThreshold = 0;
    }
    
    state.filteredData = state.filteredData.filter(r => 
        new Date(r.timestamp).getTime() >= timeThreshold
    );

    // Reset to page 1
    state.currentPage = 1;

    // Re-render
    renderTableHeader();
    renderSensorDataTable();
}

/**
 * Export data
 */
function exportData() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    // Get selected columns
    const selectedColumns = Array.from(
        document.querySelectorAll('#exportColumns input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    // Filter data by date range
    let dataToExport = state.filteredData;
    
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        
        dataToExport = dataToExport.filter(reading => {
            const date = new Date(reading.timestamp);
            return date >= start && date <= end;
        });
    }

    // Prepare export data
    const exportDataArray = dataToExport.map(reading => {
        const row = {};
        selectedColumns.forEach(col => {
            if (col === 'timestamp' || col === 'deviceId') {
                row[col] = reading[col];
            } else {
                const sensor = SENSOR_CONFIG.find(s => s.field === col);
                if (sensor) {
                    row[col] = applySensorScale(col, reading[col]);
                }
            }
        });
        return row;
    });

    // Export based on format
    if (format === 'csv') {
        const headers = selectedColumns.map(col => {
            if (col === 'timestamp' || col === 'deviceId') return col;
            const sensor = SENSOR_CONFIG.find(s => s.field === col);
            return sensor ? `${sensor.displayName} (${sensor.unit})` : col;
        });
        
        const csvRows = [
            headers.join(','),
            ...exportDataArray.map(row => 
                selectedColumns.map(col => {
                    const value = row[col];
                    return typeof value === 'string' ? `"${value}"` : value;
                }).join(',')
            )
        ];
        
        const csvString = csvRows.join('\n');
        downloadFile(csvString, 'text/csv', 'csv');
        
    } else if (format === 'json') {
        const jsonString = JSON.stringify(exportDataArray, null, 2);
        downloadFile(jsonString, 'application/json', 'json');
    }

    // Close modal
    document.getElementById('exportModal').classList.remove('active');
    console.log(`✅ Data exported:  ${exportDataArray.length} records`);
}

/**
 * Download file helper
 */
function downloadFile(content, mimeType, extension) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `farmtech_sensor_data_${new Date().toISOString().split('T')[0]}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Update current time display
 */
function updateCurrentTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const dateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    document.getElementById('currentTime').textContent = `${dateStr} ${timeStr}`;
}

/**
 * Refresh all data
 */
function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Refreshing...';
    btn.disabled = true;

    // Request fresh data from server
    if (state.ws && state.ws.isConnected) {
        state.ws.requestStatistics();
    }

    setTimeout(() => {
        applyFilters();
        updateQuickStats();
        renderDeviceStatus();
        updateCharts();
        
        btn.innerHTML = '<i class="fa-solid fa-rotate-right mr-1"></i> Refresh';
        btn.disabled = false;
        console.log('✅ Data refreshed');
    }, 1000);
}

/**
 * Handle pagination
 */
function changePage(direction) {
    const maxPage = Math.ceil(state.filteredData.length / state.rowsPerPage);
    
    if (direction === 'next' && state. currentPage < maxPage) {
        state.currentPage++;
    } else if (direction === 'prev' && state.currentPage > 1) {
        state.currentPage--;
    }
    
    document.getElementById('currentPage').textContent = state.currentPage;
    renderSensorDataTable();
}

// ============================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================

/**
 * Initialize application
 */
function initializeApp() {
    console.log('🚀 Initializing FarmTech Dashboard.. .');
    
    // ✅ LOAD from localStorage FIRST
    const hasLocalData = loadDataFromLocalStorage();
    
    if (hasLocalData) {
        // Render data yang ada
        populateFilters();
        applyFilters();
        updateQuickStats();
        renderDeviceStatus();
        initializeCharts();
        console.log('✅ UI rendered from localStorage');
    }
    
    // Initialize WebSocket (akan merge dengan data lokal)
    initializeWebSocket();
    
    // Set current time
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // Set default export dates
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    document.getElementById('startDate').value = yesterday;
    document.getElementById('endDate').value = today;
    
    // Event listeners
    document.getElementById('applyFilters').addEventListener('click', () => {
        state.selectedDevice = document.getElementById('deviceSelect').value;
        state.selectedTimeRange = document.getElementById('timeRange').value;
        state.selectedSensorType = document.getElementById('sensorType').value;
        applyFilters();
        updateCharts();
    });
    
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    
    // Export modal
    const exportModal = document.getElementById('exportModal');
    document.getElementById('exportBtn').addEventListener('click', () => {
        exportModal.classList.add('active');
    });
    
    document.getElementById('closeModal').addEventListener('click', () => {
        exportModal.classList.remove('active');
    });
    
    document.getElementById('cancelExport').addEventListener('click', () => {
        exportModal.classList.remove('active');
    });
    
    document.getElementById('confirmExport').addEventListener('click', exportData);
    
    exportModal.addEventListener('click', (e) => {
        if (e.target === exportModal) {
            exportModal.classList.remove('active');
        }
    });
    
    // Pagination
    document.getElementById('prevPage').addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage').addEventListener('click', () => changePage('next'));
    
    console.log('✅ FarmTech Dashboard initialized');
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);