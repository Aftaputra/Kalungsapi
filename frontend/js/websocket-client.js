// ============================================================
// FARMTECH WEBSOCKET CLIENT (FIXED)
// Real-time data connection to server
// ============================================================

class FarmTechWebSocket {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectInterval = 5000;
        this.heartbeatInterval = null;
        this.reconnectTimeout = null;
        this.isReconnecting = false;  // ← NEW:  Prevent multiple reconnects
        
        // Callbacks
        this.onSensorData = null;
        this.onDeviceConnected = null;
        this. onDeviceDisconnected = null;
        this.onInitialData = null;
        this.onStatistics = null;
        this. onConnectionChange = null;
        
        this.wsUrl = this.getWebSocketURL();
    }
    
    getWebSocketURL() {
        return 'ws://localhost:8000/ws/dashboard';
    }
    
    connect() {
        // ✅ FIX: Prevent multiple connections
        if (this.isConnected || this.isReconnecting) {
            console.log('Already connected or reconnecting.. .');
            return;
        }
        
        if (this.ws) {
            const state = this.ws.readyState;
            if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
                console.log('WebSocket already active');
                return;
            }
        }
        
        this.isReconnecting = true;
        console.log(`🔌 Connecting to WebSocket: ${this.wsUrl}`);
        
        try {
            this. ws = new WebSocket(this. wsUrl);
            
            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;
                this.isReconnecting = false;
                this.updateConnectionStatus(true);
                this.startHeartbeat();
                
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Error parsing message:', error);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isReconnecting = false;
            };
            
            this.ws.onclose = (event) => {
                console. log('🔌 WebSocket closed:', event.code, event.reason);
                this.isConnected = false;
                this.isReconnecting = false;
                this.updateConnectionStatus(false);
                this.stopHeartbeat();
                
                // ✅ FIX:  Only reconnect if not a normal closure
                if (event.code !== 1000) {
                    this.scheduleReconnect();
                }
            };
            
        } catch (error) {
            console.error('❌ Error creating WebSocket:', error);
            this.isReconnecting = false;
            this.scheduleReconnect();
        }
    }
    
    disconnect() {
        if (this. ws) {
            this.stopHeartbeat();
            
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
            
            // ✅ FIX:  Normal closure (code 1000)
            this.ws.close(1000, 'User disconnect');
            this.ws = null;
            this.isConnected = false;
            this.isReconnecting = false;
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectTimeout || this.isReconnecting) return;
        
        console.log(`⏳ Reconnecting in ${this.reconnectInterval/1000} seconds...`);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this. connect();
        }, this.reconnectInterval);
    }
    
    startHeartbeat() {
        this.stopHeartbeat();  // Clear existing first
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, 30000);
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    send(message) {
        if (!this. isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ Cannot send:  WebSocket not connected');
            return false;
        }
        
        try {
            this.ws. send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('❌ Error sending message:', error);
            return false;
        }
    }
    
    handleMessage(message) {
        const { type, data } = message;
        
        switch (type) {
            case 'initial_data':
                console.log('📦 Received initial data');
                if (this.onInitialData) {
                    // ✅ FIX:  Use setTimeout to prevent blocking
                    setTimeout(() => {
                        this.onInitialData(data);
                    }, 0);
                }
                break;
            
            case 'sensor_data': 
                if (this.onSensorData) {
                    this.onSensorData(data);
                }
                break;
            
            case 'device_connected': 
                console.log('🔌 Device connected:', message.device_id);
                if (this.onDeviceConnected) {
                    this.onDeviceConnected(message.device_id);
                }
                break;
            
            case 'device_disconnected':
                console. log('🔌 Device disconnected:', message.device_id);
                if (this.onDeviceDisconnected) {
                    this. onDeviceDisconnected(message.device_id);
                }
                break;
            
            case 'statistics':
                if (this.onStatistics) {
                    this.onStatistics(data);
                }
                break;
            
            case 'pong':
                // Heartbeat response
                break;
            
            default:
                console. log('Unknown message type:', type);
        }
    }
    
    updateConnectionStatus(connected) {
        if (this.onConnectionChange) {
            this.onConnectionChange(connected);
        }
        
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
    
    requestDeviceData(deviceId, limit = 100) {
        return this.send({
            type: 'get_device_data',
            device_id: deviceId,
            limit: limit
        });
    }
    
    requestStatistics() {
        return this.send({
            type: 'get_stats'
        });
    }
    
    sendCommandToDevice(deviceId, command) {
        return this.send({
            type: 'send_command_to_device',
            device_id: deviceId,
            command: command
        });
    }
}

// Export
window.FarmTechWebSocket = FarmTechWebSocket;