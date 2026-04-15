// ============================================================
// BOVINCHECK - RAW DATA DASHBOARD
// Real-time monitoring sensor sapi
// ============================================================

// ============================================================
// STATE
// ============================================================
const state = {
    sensorReadings: [],    // semua raw data dari sensor (kaki & leher)
    imuReadings: [],       // data IMU (akselerometer)
    devices: [],           // daftar device yang terhubung
    ws: null,
    charts: { temp: null, imu: null },
    stats: {
        imuCount: 0,
        sensorCount: 0,
        lastUpdate: Date.now()
    },
    deviceFilter: 'all',
    timeFilter: '24h'
};

// ============================================================
// WEBSOCKET
// ============================================================
function initWebSocket() {
    state.ws = new FarmTechWebSocket();
    state.ws.onInitialData = (data) => {
        console.log('[BovinCheck] Initial data', data);
        if (data.devices) {
            state.devices = data.devices.map(d => ({ id: d.device_id, status: 'online', lastSeen: new Date() }));
        }
        if (data.sensor_data) {
            data.sensor_data.forEach(r => addSensorReading(r));
        }
        if (data.imu_data) {
            data.imu_data.forEach(r => addIMUReading(r));
        }
        updateUI();
        startTimers();
    };
    state.ws.onSensorData = (data) => {
        // IMU data memiliki sample_index, sensor data tidak
        if (data.sample_index !== undefined) {
            addIMUReading(data);
            state.stats.imuCount++;
        } else {
            addSensorReading(data);
            state.stats.sensorCount++;
            const dev = state.devices.find(d => d.id === data.device_id);
            if (dev) {
                dev.lastSeen = new Date();
                dev.status = 'online';
            }
        }
    };
    state.ws.onDeviceConnected = (id) => {
        if (!state.devices.find(d => d.id === id)) {
            state.devices.push({ id, status: 'online', lastSeen: new Date() });
        } else {
            state.devices.find(d => d.id === id).status = 'online';
        }
    };
    state.ws.onDeviceDisconnected = (id) => {
        const dev = state.devices.find(d => d.id === id);
        if (dev) dev.status = 'offline';
    };
    state.ws.connect();
}

function addSensorReading(data) {
    const reading = {
        timestamp: data.timestamp || new Date().toISOString(),
        deviceId: data.device_id,
        tempC: data.tempC ?? null,
        vbatt: data.vbatt ?? null,
        suhu_kaki: data.suhu_kaki ?? null,
        vbatt_kaki: data.vbatt_kaki ?? null,
        suhu_leher: data.suhu_leher ?? null,
        vbatt_leher: data.vbatt_leher ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        spo2: data.spo2 ?? null,
        heart_rate: data.heart_rate ?? null
    };
    state.sensorReadings.unshift(reading);
    if (state.sensorReadings.length > 1000) state.sensorReadings = state.sensorReadings.slice(0, 1000);
}

function addIMUReading(data) {
    state.imuReadings.unshift({
        timestamp: data.timestamp || new Date().toISOString(),
        deviceId: data.device_id,
        batchId: data.batch_id,
        sampleIndex: data.sample_index,
        imu_x: data.imu_x || 0,
        imu_y: data.imu_y || 0,
        imu_z: data.imu_z || 0
    });
    if (state.imuReadings.length > 500) state.imuReadings = state.imuReadings.slice(0, 500);
}

// ============================================================
// FILTER DATA BERDASARKAN JENIS (KAKI / LEHER / IMU)
// ============================================================
function getKakiData() {
    let filtered = state.sensorReadings.filter(r => 
        (r.suhu_kaki !== null || r.vbatt_kaki !== null || r.tempC !== null || r.vbatt !== null)
    );
    if (state.deviceFilter !== 'all') filtered = filtered.filter(r => r.deviceId === state.deviceFilter);
    return filtered;
}

function getLeherData() {
    let filtered = state.sensorReadings.filter(r => 
        (r.spo2 !== null || r.heart_rate !== null || r.suhu_leher !== null || r.vbatt_leher !== null || r.latitude !== null || r.longitude !== null)
    );
    if (state.deviceFilter !== 'all') filtered = filtered.filter(r => r.deviceId === state.deviceFilter);
    return filtered;
}

function getIMUData() {
    let filtered = state.imuReadings;
    if (state.deviceFilter !== 'all') filtered = filtered.filter(r => r.deviceId === state.deviceFilter);
    return filtered;
}

// ============================================================
// RENDER TABEL
// ============================================================
function renderKakiTable() {
    const tbody = document.getElementById('kakiDataBody');
    const countSpan = document.getElementById('kakiRowCount');
    const data = getKakiData().slice(0, 100);
    if (countSpan) countSpan.textContent = data.length;
    if (!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-500">No data从\n</td></tr>';
        return;
    }
    const formatTemp = (v) => v !== null ? (v * 0.01).toFixed(1) : '-';
    const formatBatt = (v) => v !== null ? v : '-';
    tbody.innerHTML = data.map(r => {
        const time = new Date(r.timestamp).toLocaleTimeString('id-ID');
        const tempKaki = r.suhu_kaki !== null ? formatTemp(r.suhu_kaki) : formatTemp(r.tempC);
        const battKaki = r.vbatt_kaki !== null ? formatBatt(r.vbatt_kaki) : formatBatt(r.vbatt);
        return `<tr>
            <td class="font-mono text-xs">${time}</td>
            <td class="font-medium">${r.deviceId}</td>
            <td class="value-normal">${tempKaki}</td>
            <td>${battKaki}</td>
        </tr>`;
    }).join('');
    document.getElementById('kakiLastUpdate').innerText = new Date().toLocaleTimeString('id-ID');
}

function renderLeherTable() {
    const tbody = document.getElementById('leherDataBody');
    const countSpan = document.getElementById('leherRowCount');
    const data = getLeherData().slice(0, 100);
    if (countSpan) countSpan.textContent = data.length;
    if (!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No data</td></tr>';
        return;
    }
    const formatTemp = (v) => v !== null ? (v * 0.01).toFixed(1) : '-';
    const formatBatt = (v) => v !== null ? v : '-';
    const formatGPS = (v) => (v !== null && v !== 0) ? (v / 10000000).toFixed(6) : '-';
    tbody.innerHTML = data.map(r => {
        const time = new Date(r.timestamp).toLocaleTimeString('id-ID');
        return `<tr>
            <td class="font-mono text-xs">${time}</td>
            <td class="font-medium">${r.deviceId}</td>
            <td class="value-normal">${formatTemp(r.suhu_leher)}</td>
            <td>${formatBatt(r.vbatt_leher)}</td>
            <td class="value-normal">${r.spo2 !== null ? r.spo2 : '-'}</td>
            <td class="value-normal">${r.heart_rate !== null ? r.heart_rate : '-'}</td>
            <td class="font-mono">${formatGPS(r.latitude)}</td>
            <td class="font-mono">${formatGPS(r.longitude)}</td>
        </tr>`;
    }).join('');
    document.getElementById('leherLastUpdate').innerText = new Date().toLocaleTimeString('id-ID');
}

function renderIMUTable() {
    const tbody = document.getElementById('imuDataBody');
    const countSpan = document.getElementById('imuRowCount');
    const data = getIMUData().slice(0, 100);
    if (countSpan) countSpan.textContent = data.length;
    if (!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-500">No IMU data</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(r => {
        const time = new Date(r.timestamp).toLocaleTimeString('id-ID');
        const x = (r.imu_x * 0.01).toFixed(2);
        const y = (r.imu_y * 0.01).toFixed(2);
        const z = (r.imu_z * 0.01).toFixed(2);
        return `<tr>
            <td class="font-mono text-xs">${time}</td>
            <td class="font-medium">${r.deviceId}</td>
            <td>${r.batchId ?? '-'}</td>
            <td>${r.sampleIndex ?? '-'}</td>
            <td class="value-normal">${x}</td>
            <td class="value-normal">${y}</td>
            <td class="value-normal">${z}</td>
        </tr>`;
    }).join('');
    document.getElementById('imuLastUpdate').innerText = new Date().toLocaleTimeString('id-ID');
}

function renderDeviceStatus() {
    const tbody = document.getElementById('deviceStatusBody');
    if (!tbody) return;
    if (state.devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">No devices</td></tr>';
        return;
    }
    tbody.innerHTML = state.devices.map(d => {
        const statusIcon = d.status === 'online' ? '<span class="sensor-status sensor-online"></span>' : '<span class="sensor-status sensor-offline"></span>';
        const lastSeen = d.lastSeen ? Math.floor((Date.now() - new Date(d.lastSeen)) / 60000) + 'm ago' : '-';
        return `<tr class="border-b">
            <td class="py-2 font-medium">${d.id}</td>
            <td class="py-2">Sapi #${d.id.slice(-3)}</td>
            <td class="py-2">${statusIcon} ${d.status.toUpperCase()}</td>
            <td class="py-2">-</td>
            <td class="py-2">-</td>
            <td class="py-2">-</td>
            <td class="py-2">${lastSeen}</td>
        </tr>`;
    }).join('');
}

// ============================================================
// CHARTS
// ============================================================
function updateIMUChart() {
    const ctx = document.getElementById('imuChart');
    if (!ctx) return;
    const data = state.imuReadings.slice(0, 100).reverse();
    if (!data.length) return;
    const labels = data.map((_, i) => i);
    const x = data.map(r => r.imu_x * 0.01);
    const y = data.map(r => r.imu_y * 0.01);
    const z = data.map(r => r.imu_z * 0.01);
    if (state.charts.imu) {
        state.charts.imu.data.labels = labels;
        state.charts.imu.data.datasets[0].data = x;
        state.charts.imu.data.datasets[1].data = y;
        state.charts.imu.data.datasets[2].data = z;
        state.charts.imu.update('none');
    } else {
        state.charts.imu = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'X', data: x, borderColor: '#ef4444', borderWidth: 1, fill: false, tension: 0.4, pointRadius: 0 },
                    { label: 'Y', data: y, borderColor: '#3b82f6', borderWidth: 1, fill: false, tension: 0.4, pointRadius: 0 },
                    { label: 'Z', data: z, borderColor: '#10b981', borderWidth: 1, fill: false, tension: 0.4, pointRadius: 0 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { position: 'top' } }
            }
        });
    }
}

function updateTempChart() {
    const ctx = document.getElementById('tempChart');
    if (!ctx) return;
    const last24h = state.sensorReadings.filter(r => new Date(r.timestamp) > Date.now() - 24 * 3600000);
    const labels = [], leher = [], kaki = [];
    for (let i = 23; i >= 0; i--) {
        const hourStart = new Date(Date.now() - i * 3600000);
        const hourEnd = new Date(hourStart.getTime() + 3600000);
        const hourData = last24h.filter(r => {
            const t = new Date(r.timestamp);
            return t >= hourStart && t < hourEnd;
        });
        labels.push(hourStart.getHours() + ':00');
        const validLeher = hourData.filter(r => r.suhu_leher !== null);
        const avgLeher = validLeher.length ? validLeher.reduce((a,b)=>a+b.suhu_leher,0) / validLeher.length : null;
        const validKaki = hourData.filter(r => r.suhu_kaki !== null);
        const avgKaki = validKaki.length ? validKaki.reduce((a,b)=>a+b.suhu_kaki,0) / validKaki.length : null;
        leher.push(avgLeher ? (avgLeher * 0.01).toFixed(1) : null);
        kaki.push(avgKaki ? (avgKaki * 0.01).toFixed(1) : null);
    }
    if (state.charts.temp) state.charts.temp.destroy();
    state.charts.temp = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Temp Leher (°C)', data: leher, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4 },
                { label: 'Temp Kaki (°C)', data: kaki, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.raw ? `${ctx.dataset.label}: ${ctx.raw}°C` : 'No data'
                    }
                }
            }
        }
    });
}

// ============================================================
// STATISTIK
// ============================================================
function updateStats() {
    document.getElementById('totalDevices').innerText = state.devices.length;
    const totalPoints = state.sensorReadings.length + state.imuReadings.length;
    document.getElementById('totalDataPoints').innerText = totalPoints;
    const online = state.devices.filter(d => d.status === 'online').length;
    document.getElementById('deviceStatus').innerHTML = `<span class="sensor-status sensor-online"></span> ${online} Online <span class="sensor-status sensor-warning ml-3"></span> 0 Warning`;
    const totalSize = (state.sensorReadings.length * 150 + state.imuReadings.length * 50) / 1024;
    document.getElementById('totalDataSize').innerText = totalSize.toFixed(1) + ' KB';
    document.getElementById('todayDataSize').innerText = `Hari ini: ${totalSize.toFixed(1)} KB`;
    
    const now = Date.now();
    const elapsed = (now - state.stats.lastUpdate) / 1000;
    if (elapsed >= 1) {
        const imuRate = (state.stats.imuCount / elapsed).toFixed(1);
        const sensorRate = (state.stats.sensorCount / elapsed).toFixed(1);
        document.getElementById('recentDataPoints').innerHTML = `IMU: ${imuRate}/s | Sensor: ${sensorRate}/s`;
        state.stats.imuCount = 0;
        state.stats.sensorCount = 0;
        state.stats.lastUpdate = now;
    }
}

// ============================================================
// EKSPOR DATA (MULTI FILE, KOLOM SESUAI JENIS)
// ============================================================
async function exportData() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const exportKaki = document.getElementById('exportKaki').checked;
    const exportLeher = document.getElementById('exportLeher').checked;
    const exportIMU = document.getElementById('exportIMU').checked;

    let start, end;
    if (startDate && endDate) {
        start = new Date(startDate);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
    }

    // Kolom yang diekspor per tipe
    const columns = {
        kaki: ['timestamp', 'deviceId', 'suhu_kaki', 'vbatt_kaki', 'tempC', 'vbatt'],
        leher: ['timestamp', 'deviceId', 'suhu_leher', 'vbatt_leher', 'spo2', 'heart_rate', 'latitude', 'longitude'],
        imu: ['timestamp', 'deviceId', 'batchId', 'sampleIndex', 'imu_x', 'imu_y', 'imu_z']
    };

    function pickColumns(obj, cols) {
        const newObj = {};
        for (let col of cols) {
            if (obj.hasOwnProperty(col)) newObj[col] = obj[col];
        }
        return newObj;
    }

    const exportType = async (data, typeName, colDef) => {
        if (!data || data.length === 0) return false;
        let filtered = data;
        if (start && end) {
            filtered = data.filter(r => new Date(r.timestamp) >= start && new Date(r.timestamp) <= end);
        }
        if (filtered.length === 0) return false;
        const filteredData = filtered.map(row => pickColumns(row, colDef));
        let content, filename = `BovinCheck_${typeName}_${new Date().toISOString().slice(0,19)}`;
        if (format === 'csv') {
            const replacer = (key, value) => value === null ? '' : value;
            const header = colDef;
            const csvRows = [
                header.join(','),
                ...filteredData.map(row => header.map(field => JSON.stringify(row[field], replacer)).join(','))
            ];
            content = csvRows.join('\n');
            filename += '.csv';
        } else {
            content = JSON.stringify(filteredData, null, 2);
            filename += '.json';
        }
        downloadFile(content, format === 'csv' ? 'text/csv' : 'application/json', filename);
        return true;
    };

    let anyExported = false;
    if (exportKaki) {
        const kakiData = getKakiData(); // sudah tanpa field type
        if (await exportType(kakiData, 'kaki', columns.kaki)) anyExported = true;
    }
    if (exportLeher) {
        const leherData = getLeherData();
        if (await exportType(leherData, 'leher', columns.leher)) anyExported = true;
    }
    if (exportIMU) {
        const imuData = getIMUData();
        if (await exportType(imuData, 'imu', columns.imu)) anyExported = true;
    }
    if (!anyExported) {
        alert('Tidak ada data untuk diekspor.');
    } else {
        alert('Ekspor selesai.');
    }
}

function downloadFile(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// UI UPDATE & TIMERS
// ============================================================
function updateUI() {
    renderKakiTable();
    renderLeherTable();
    renderIMUTable();
    renderDeviceStatus();
    updateStats();
    updateIMUChart();
    updateTempChart();
    populateDeviceSelect();
}

function populateDeviceSelect() {
    const select = document.getElementById('deviceSelect');
    if (!select) return;
    const uniqueDevices = [...new Set(state.sensorReadings.map(r => r.deviceId).concat(state.imuReadings.map(r => r.deviceId)))];
    select.innerHTML = '<option value="all">Semua Device</option>' + uniqueDevices.map(d => `<option value="${d}">${d}</option>`).join('');
}

function startTimers() {
    setInterval(() => {
        updateIMUChart();
        renderIMUTable();
    }, 500);
    setInterval(() => {
        renderKakiTable();
        renderLeherTable();
        renderDeviceStatus();
        updateStats();
        updateTempChart();
    }, 2000);
}

function initControls() {
    document.getElementById('applyFilters')?.addEventListener('click', () => {
        state.deviceFilter = document.getElementById('deviceSelect').value;
        updateUI();
    });
    document.getElementById('refreshBtn')?.addEventListener('click', () => updateUI());
    const modal = document.getElementById('exportModal');
    document.getElementById('exportBtn')?.addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('closeModal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('cancelExport')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('confirmExport')?.addEventListener('click', () => {
        exportData();
        modal.classList.remove('active');
    });
}

function updateCurrentTime() {
    const el = document.getElementById('currentTime');
    if (el) el.innerText = new Date().toLocaleString('id-ID');
}

function init() {
    initWebSocket();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    initControls();
}

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => state.ws?.disconnect());