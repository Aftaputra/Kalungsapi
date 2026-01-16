// ============================================================
// FARMTECH WEBSOCKET CLIENT
// Real-time data connection to server
// ============================================================

class FarmTechWebSocket {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectInterval = 5000; // 5 seconds
        this.heartbeatInterval = null;
        this.reconnectTimeout = null;
        
        // Callbacks
        this.onSensorData = null;
        this.onDeviceConnected = null;
        this. onDeviceDisconnected = null;
        this.onInitialData = null;
        this. onStatistics = null;
        this. onConnectionChange = null;
        
        // Get WebSocket URL from config or window location
        this.wsUrl = this.getWebSocketURL();
    }
    
    /**
     * Get WebSocket URL based on current page location
     */
    getWebSocketURL() {
        // Untuk development - GANTI SESUAI SERVER ANDA
        return 'ws://localhost:8000/ws/dashboard';
        
        // Untuk production (auto-detect), uncomment ini:
        /*
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const port = '8000';
        return `${protocol}//${host}:${port}/ws/dashboard`;
        */
    }
    
    /**
     * Connect to WebSocket server
     */
    connect() {
        if (this.ws && this.isConnected) {
            console.log('WebSocket already connected');
            return;
        }
        
        console.log(`Connecting to WebSocket:  ${this.wsUrl}`);
        
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws. onopen = () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;
                this.updateConnectionStatus(true);
                
                // Start heartbeat
                this.startHeartbeat();
                
                // Clear reconnect timeout
                if (this.reconnectTimeout) {
                    clearTimeout(this. reconnectTimeout);
                    this.reconnectTimeout = null;
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };
            
            this.ws.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.isConnected = false;
                this.updateConnectionStatus(false);
                
                // Stop heartbeat
                this.stopHeartbeat();
                
                // Attempt to reconnect
                this.scheduleReconnect();
            };
            
        } catch (error) {
            console.error('Error creating WebSocket:', error);
            this.scheduleReconnect();
        }
    }
    
    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        if (this.ws) {
            this.stopHeartbeat();
            this.ws.close();
            this.ws = null;
            this. isConnected = false;
        }
    }
    
    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimeout) return;
        
        console.log(`Reconnecting in ${this.reconnectInterval/1000} seconds...`);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, this.reconnectInterval);
    }
    
    /**
     * Start heartbeat ping
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this. send({ type: 'ping' });
            }
        }, 30000); // 30 seconds
    }
    
    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this. heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    /**
     * Send message to server
     */
    send(message) {
        if (!this.isConnected || !this.ws) {
            console.warn('Cannot send message:  WebSocket not connected');
            return false;
        }
        
        try {
            this.ws. send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Error sending WebSocket message:', error);
            return false;
        }
    }
    
    /**
     * Handle incoming messages
     */
    handleMessage(message) {
        const { type, data } = message;
        
        switch (type) {
            case 'initial_data':
                console.log('📦 Received initial data');
                if (this.onInitialData) {
                    this.onInitialData(data);
                }
                break;
            
            case 'sensor_data': 
                console.log('📊 Received sensor data:', data. device_id);
                if (this. onSensorData) {
                    this.onSensorData(data);
                }
                break;
            
            case 'device_connected':
                console. log('🔌 Device connected:', message.device_id);
                if (this.onDeviceConnected) {
                    this.onDeviceConnected(message.device_id);
                }
                break;
            
            case 'device_disconnected':
                console.log('🔌 Device disconnected:', message.device_id);
                if (this.onDeviceDisconnected) {
                    this. onDeviceDisconnected(message.device_id);
                }
                break;
            
            case 'statistics':
                console.log('📈 Received statistics');
                if (this.onStatistics) {
                    this. onStatistics(data);
                }
                break;
            
            case 'pong':
                // Heartbeat response
                console.log('💓 Heartbeat');
                break;
            
            default:
                console.log('Unknown message type:', type);
        }
    }
    
    /**
     * Update connection status in UI
     */
    updateConnectionStatus(connected) {
        if (this.onConnectionChange) {
            this.onConnectionChange(connected);
        }
        
        // Update UI indicator
        const indicator = document.getElementById('wsConnectionStatus');
        if (indicator) {
            if (connected) {
                indicator. innerHTML = '<span class="sensor-status sensor-online"></span> Connected';
                indicator.className = 'text-sm text-green-600';
            } else {
                indicator.innerHTML = '<span class="sensor-status sensor-offline"></span> Disconnected';
                indicator.className = 'text-sm text-red-600';
            }
        }
    }
    
    /**
     * Request device data
     */
    requestDeviceData(deviceId, limit = 100) {
        return this.send({
            type: 'get_device_data',
            device_id: deviceId,
            limit: limit
        });
    }
    
    /**
     * Request statistics
     */
    requestStatistics() {
        return this.send({
            type: 'get_stats'
        });
    }
    
    /**
     * Send command to device
     */
    sendCommandToDevice(deviceId, command) {
        return this.send({
            type: 'send_command_to_device',
            device_id: deviceId,
            command: command
        });
    }
}

// Export for use in other files
window.FarmTechWebSocket = FarmTechWebSocket;