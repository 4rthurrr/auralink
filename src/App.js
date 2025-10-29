import React, { useState, useEffect, useCallback, useRef } from 'react';
import mqtt from 'mqtt';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend
);

function App() {
  // State for MQTT connection
  const [client, setClient] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [isStableConnection, setIsStableConnection] = useState(false);
  const connectionAttemptRef = useRef(false);
  const clientRef = useRef(null);
  
  // Session management - prevent multiple tabs
  const SESSION_KEY = 'auralink_mqtt_session';
  const HEARTBEAT_KEY = 'auralink_heartbeat';
  
  // State for sensor data
  const [sensorData, setSensorData] = useState({
    temperature: '--',
    humidity: '--',
    mq135: '--',
    led: '#000000'
  });

  // State for additional ESP32 data
  const [displayMessage, setDisplayMessage] = useState('Waiting for display message...');
  const [emailSummary, setEmailSummary] = useState('No email summary received yet.');

  // State for historical data (for charts) - keep last 20 data points
  const [historicalData, setHistoricalData] = useState({
    labels: [],
    temperature: [],
    humidity: [],
    mq135: []
  });
  const MAX_DATA_POINTS = 20;

  // MQTT connection configuration
  const mqttConfig = {
    broker: 'wss://fbfd5b7accc64488838c63d9a691a801.s1.eu.hivemq.cloud:8884/mqtt',
    username: 'Shanuka',
    password: 'Sha@1234',
    subscribeTopics: [
      'esp32/sensors/temperature',
      'esp32/sensors/humidity', 
      'esp32/sensors/mq135',
      'esp32/sensors/led',
      'esp32/display',
      'esp32/email_summary'
    ],
    publishTopics: {
      led: 'esp32/led',
      control: 'esp32/control'
    }
  };

  // Check if another tab has an active session
  const checkActiveSession = () => {
    const lastHeartbeat = localStorage.getItem(HEARTBEAT_KEY);
    const sessionActive = localStorage.getItem(SESSION_KEY);
    
    if (sessionActive && lastHeartbeat) {
      const timeDiff = Date.now() - parseInt(lastHeartbeat);
      return timeDiff < 15000; // Session is active if heartbeat within 15 seconds
    }
    return false;
  };

  // Claim session for this tab
  const claimSession = () => {
    localStorage.setItem(SESSION_KEY, 'active');
    localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());
  };

  // Release session
  const releaseSession = () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(HEARTBEAT_KEY);
  };

  // Clear retained messages to prevent stale data
  const clearRetainedMessages = (client) => {
    if (!client || client.disconnected) return;
    
    const topicsToClear = [
      'auralink/dashboard/status',
      'esp32/sensors/temperature',
      'esp32/sensors/humidity', 
      'esp32/sensors/mq135',
      'esp32/sensors/led',
      'esp32/display',
      'esp32/email_summary'
    ];
    
    console.log('🧹 Clearing retained messages...');
    topicsToClear.forEach(topic => {
      try {
        client.publish(topic, '', { retain: true, qos: 0 });
      } catch (e) {
        console.warn(`Failed to clear retained message for ${topic}:`, e);
      }
    });
  };

  // Connect to MQTT broker (stable reference)
  const connectToMqtt = useCallback(() => {
    // Check if another tab already has an active MQTT session
    if (checkActiveSession()) {
      console.log('🚫 Another tab already has an active MQTT session');
      setConnectionStatus('Another Tab Active');
      return;
    }

    // Prevent multiple concurrent connections
    if (connectionAttemptRef.current || (clientRef.current && !clientRef.current.disconnected)) {
      console.log('🔄 MQTT connection already in progress or active');
      return;
    }

    // Claim this session
    claimSession();
    connectionAttemptRef.current = true;
    console.log('🚀 Initiating MQTT connection...');

    try {
      console.log('Attempting to connect to MQTT broker...');
      const mqttClient = mqtt.connect(mqttConfig.broker, {
        username: mqttConfig.username,
        password: mqttConfig.password,
        clientId: 'auralink_dashboard_single', // Fixed client ID to prevent session accumulation
        clean: false, // Persistent session - reuse existing session instead of creating new ones
        reconnectPeriod: 10000, // Longer reconnect period to reduce sessions
        connectTimeout: 10000, // Shorter timeout
        keepalive: 30, // Shorter keepalive to detect disconnects faster
        protocolVersion: 4,
        resubscribe: false, // Disable auto-resubscribe to prevent duplicates
        reschedulePings: true,
        will: {
          topic: 'auralink/dashboard/status',
          payload: 'offline',
          qos: 0,
          retain: true // Retain will message
        }
      });

      mqttClient.on('connect', () => {
        console.log('✅ Successfully connected to MQTT broker');
        setConnectionStatus('Connected');
        setClient(mqttClient);
        clientRef.current = mqttClient;
        connectionAttemptRef.current = false;
        
        // Maintain session heartbeat
        const heartbeatInterval = setInterval(() => {
          if (clientRef.current && !clientRef.current.disconnected) {
            localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());
          } else {
            clearInterval(heartbeatInterval);
          }
        }, 10000); // Update heartbeat every 10 seconds
        
        // Store interval reference for cleanup
        mqttClient.heartbeatInterval = heartbeatInterval;
        
        // Publish online status
        mqttClient.publish('auralink/dashboard/status', 'online', { qos: 0, retain: true });
        
        // Set stable connection after subscription completion
        setTimeout(() => {
          setIsStableConnection(true);
        }, 3000);
        
        // Subscribe to all sensor topics with proper error handling
        let subscriptionCount = 0;
        const totalSubscriptions = mqttConfig.subscribeTopics.length;
        
        // Delay subscriptions slightly to ensure connection is stable
        setTimeout(() => {
          if (mqttClient.connected) {
            mqttConfig.subscribeTopics.forEach(topic => {
              if (mqttClient.connected) { // Double-check before each subscription
                mqttClient.subscribe(topic, { qos: 0 }, (err) => {
                  subscriptionCount++;
                  if (err) {
                    console.error(`❌ Failed to subscribe to ${topic}:`, err);
                  } else {
                    console.log(`📡 Subscribed to ${topic}`);
                  }
                  
                  if (subscriptionCount === totalSubscriptions) {
                    console.log('🎯 All subscriptions completed');
                  }
                });
              }
            });
          } else {
            console.warn('⚠️ Client disconnected before subscriptions could be made');
          }
        }, 1000); // 1 second delay
      });

      mqttClient.on('message', (topic, message) => {
        const payload = message.toString();
        console.log(`Received message from ${topic}: ${payload}`);
        
        // Update sensor data and historical data for charts
        setSensorData(prevData => {
          const newData = { ...prevData };
          
          switch (topic) {
            case 'esp32/sensors/temperature':
              newData.temperature = payload;
              updateHistoricalData('temperature', parseFloat(payload));
              break;
            case 'esp32/sensors/humidity':
              newData.humidity = payload;
              updateHistoricalData('humidity', parseFloat(payload));
              break;
            case 'esp32/sensors/mq135':
              newData.mq135 = payload;
              updateHistoricalData('mq135', parseInt(payload));
              break;
            case 'esp32/sensors/led':
              newData.led = payload;
              break;
            default:
              break;
          }
          
          return newData;
        });

        // Handle additional ESP32 topics
        switch (topic) {
          case 'esp32/display':
            setDisplayMessage(payload);
            break;
          case 'esp32/email_summary':
            setEmailSummary(payload);
            break;
          default:
            break;
        }
      });

      mqttClient.on('error', (error) => {
        console.error('❌ MQTT connection error:', error.message || error);
        connectionAttemptRef.current = false;
        
        // Handle specific error types
        if (error.message && error.message.includes('Not authorized')) {
          console.error('🔒 Authentication failed - check username/password');
          setConnectionStatus('Auth Error');
        } else if (error.message && error.message.includes('Insufficient resources')) {
          console.error('⚠️ Server overloaded - will retry with backoff');
          setConnectionStatus('Server Busy');
        } else {
          setConnectionStatus('Error');
        }
        setIsStableConnection(false);
      });

      mqttClient.on('offline', () => {
        console.log('📴 MQTT client offline');
        setConnectionStatus('Offline');
        setIsStableConnection(false);
      });

      mqttClient.on('reconnect', () => {
        console.log('🔄 MQTT client reconnecting...');
        setConnectionStatus('Reconnecting...');
        setIsStableConnection(false);
      });

      mqttClient.on('close', () => {
        console.log('🔌 MQTT connection closed');
        setConnectionStatus('Disconnected');
        setIsStableConnection(false);
        connectionAttemptRef.current = false;
        
        // Clean up heartbeat and session
        if (mqttClient.heartbeatInterval) {
          clearInterval(mqttClient.heartbeatInterval);
        }
        releaseSession();
        clientRef.current = null;
      });

      mqttClient.on('disconnect', (packet) => {
        console.log('🚪 MQTT client disconnected:', packet);
        setConnectionStatus('Disconnected');
        setIsStableConnection(false);
        connectionAttemptRef.current = false;
        
        // Clean up heartbeat and session
        if (mqttClient.heartbeatInterval) {
          clearInterval(mqttClient.heartbeatInterval);
        }
        releaseSession();
        clientRef.current = null;
      });

    } catch (error) {
      console.error('💥 Failed to initialize MQTT connection:', error);
      setConnectionStatus('Init Error');
      setIsStableConnection(false);
      connectionAttemptRef.current = false;
      releaseSession();
    }
  }, []); // No dependencies to prevent re-creation

  // Update historical data for charts
  const updateHistoricalData = (sensorType, value) => {
    if (isNaN(value)) return;
    
    setHistoricalData(prevData => {
      const newData = { ...prevData };
      const now = new Date();
      const timeLabel = now.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      // Only add new data if this is the first sensor or if we have a new timestamp
      const shouldAddNewPoint = newData.labels.length === 0 || 
                               newData.labels[newData.labels.length - 1] !== timeLabel;
      
      if (shouldAddNewPoint) {
        // Add new data point with placeholder values
        newData.labels.push(timeLabel);
        newData.temperature.push(newData.temperature.length > 0 ? newData.temperature[newData.temperature.length - 1] : null);
        newData.humidity.push(newData.humidity.length > 0 ? newData.humidity[newData.humidity.length - 1] : null);
        newData.mq135.push(newData.mq135.length > 0 ? newData.mq135[newData.mq135.length - 1] : null);
      }
      
      // Update the specific sensor value
      if (newData[sensorType].length > 0) {
        newData[sensorType][newData[sensorType].length - 1] = value;
      }
      
      // Keep only the last MAX_DATA_POINTS entries
      if (newData.labels.length > MAX_DATA_POINTS) {
        newData.labels.shift();
        newData.temperature.shift();
        newData.humidity.shift();
        newData.mq135.shift();
      }
      
      return newData;
    });
  };

  // Refresh data manually
  const refreshData = () => {
    if (client && connectionStatus === 'Connected') {
      // Publish a refresh command to control topic
      client.publish(mqttConfig.publishTopics.control, 'refresh', (error) => {
        if (error) {
          console.error('Failed to publish refresh command:', error);
        } else {
          console.log('Published refresh command');
        }
      });
    }
  };

  // Connect on component mount
  useEffect(() => {
    let mounted = true;
    let connectionTimer = null;
    
    const initConnection = () => {
      if (mounted && !clientRef.current && !connectionAttemptRef.current) {
        console.log('🔧 Initializing MQTT connection from useEffect');
        connectToMqtt();
      } else {
        console.log('🔄 Skipping connection - already exists or in progress');
      }
    };
    
    // Handle page unload to clean up session
    const handleBeforeUnload = () => {
      releaseSession();
      const currentClient = clientRef.current;
      if (currentClient && !currentClient.disconnected) {
        try {
          // Clear retained messages first
          clearRetainedMessages(currentClient);
          
          currentClient.publish('auralink/dashboard/status', 'offline', { qos: 0, retain: true });
          currentClient.end(true);
        } catch (e) {
          console.warn('Error during unload cleanup:', e);
        }
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleBeforeUnload);
    
    // Only connect if no existing connection
    connectionTimer = setTimeout(initConnection, 500); // Increased delay
    
    // Cleanup on unmount
    return () => {
      console.log('🧽 useEffect cleanup triggered');
      mounted = false;
      
      if (connectionTimer) {
        clearTimeout(connectionTimer);
      }
      
      // Remove event listeners
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleBeforeUnload);
      
      // Only cleanup if this effect created the connection
      const currentClient = clientRef.current;
      if (currentClient && !currentClient.disconnected) {
        console.log('🧹 Cleaning up MQTT connection from useEffect...');
        try {
          // Clean up heartbeat
          if (currentClient.heartbeatInterval) {
            clearInterval(currentClient.heartbeatInterval);
          }
          
          // Clear retained messages before disconnecting
          clearRetainedMessages(currentClient);
          
          // Publish final offline status
          currentClient.publish('auralink/dashboard/status', 'offline', { qos: 0, retain: true });
          
          // Small delay to ensure messages are sent
          setTimeout(() => {
            currentClient.end(true); // Force disconnect
          }, 100);
        } catch (e) {
          console.warn('Error during cleanup:', e);
        }
        
        // Always release session on cleanup
        releaseSession();
        clientRef.current = null;
        setClient(null);
      }
      
      connectionAttemptRef.current = false;
    };
  }, []); // Remove connectToMqtt dependency to prevent re-runs

  // Get air quality status based on MQ135 value
  const getAirQualityStatus = (value) => {
    if (value === '--') return 'Unknown';
    const numValue = parseFloat(value);
    if (numValue < 100) return 'Good';
    if (numValue < 200) return 'Moderate';
    if (numValue < 300) return 'Poor';
    return 'Dangerous';
  };

  // Get air quality color
  const getAirQualityColor = (value) => {
    if (value === '--') return 'bg-gray-100 text-gray-800';
    const numValue = parseFloat(value);
    if (numValue < 100) return 'bg-green-100 text-green-800';
    if (numValue < 200) return 'bg-yellow-100 text-yellow-800';
    if (numValue < 300) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  };

  // Enhanced chart data configurations
  const temperatureChartData = {
    labels: historicalData.labels,
    datasets: [
      {
        label: 'Temperature (°C)',
        data: historicalData.temperature,
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: (ctx) => {
          const gradient = ctx.chart.canvas.getContext('2d').createLinearGradient(0, 0, 0, ctx.chart.height);
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.3)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0.05)');
          return gradient;
        },
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgb(239, 68, 68)',
        pointHoverBorderWidth: 2,
      },
    ],
  };

  const humidityChartData = {
    labels: historicalData.labels,
    datasets: [
      {
        label: 'Humidity (%)',
        data: historicalData.humidity,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: (ctx) => {
          const gradient = ctx.chart.canvas.getContext('2d').createLinearGradient(0, 0, 0, ctx.chart.height);
          gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');
          return gradient;
        },
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgb(59, 130, 246)',
        pointHoverBorderWidth: 2,
      },
    ],
  };

  const airQualityChartData = {
    labels: historicalData.labels,
    datasets: [
      {
        label: 'Air Quality (MQ135)',
        data: historicalData.mq135,
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: (ctx) => {
          const gradient = ctx.chart.canvas.getContext('2d').createLinearGradient(0, 0, 0, ctx.chart.height);
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
          gradient.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
          return gradient;
        },
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(16, 185, 129)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgb(16, 185, 129)',
        pointHoverBorderWidth: 2,
        segment: {
          borderColor: (ctx) => {
            const value = ctx.p1.parsed.y;
            if (value < 100) return 'rgb(34, 197, 94)';
            if (value < 200) return 'rgb(234, 179, 8)';
            if (value < 300) return 'rgb(249, 115, 22)';
            return 'rgb(239, 68, 68)';
          },
        },
      },
    ],
  };

  // Enhanced chart configurations
  const temperatureChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          maxTicksLimit: 6,
        },
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          callback: function(value) {
            return value + '°C';
          },
        },
      },
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
  };

  const humidityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          maxTicksLimit: 6,
        },
      },
      y: {
        display: true,
        min: 0,
        max: 100,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          callback: function(value) {
            return value + '%';
          },
        },
      },
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
  };

  const airQualityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          maxTicksLimit: 6,
        },
      },
      y: {
        display: true,
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          callback: function(value) {
            return value + ' AQI';
          },
        },
      },
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">AuraLink Monitor</h1>
            <div className="flex items-center space-x-4">
              <div className={`flex items-center rounded-full px-4 py-2 transition-all duration-300 ${
                connectionStatus === 'Connected' && isStableConnection ? 'bg-green-50 border border-green-200' : 
                connectionStatus === 'Connected' ? 'bg-yellow-50 border border-yellow-200' :
                connectionStatus === 'Reconnecting...' ? 'bg-yellow-50 border border-yellow-200' :
                connectionStatus === 'Offline' ? 'bg-orange-50 border border-orange-200' :
                connectionStatus === 'Auth Error' ? 'bg-purple-50 border border-purple-200' :
                connectionStatus === 'Server Busy' ? 'bg-indigo-50 border border-indigo-200' :
                connectionStatus === 'Another Tab Active' ? 'bg-blue-50 border border-blue-200' :
                'bg-red-50 border border-red-200'
              }`}>
                <div className={`relative w-3 h-3 rounded-full mr-3 transition-colors duration-300 ${
                  connectionStatus === 'Connected' && isStableConnection ? 'bg-green-500' : 
                  connectionStatus === 'Connected' ? 'bg-yellow-500' :
                  connectionStatus === 'Reconnecting...' ? 'bg-yellow-500' :
                  connectionStatus === 'Offline' ? 'bg-orange-500' :
                  connectionStatus === 'Auth Error' ? 'bg-purple-500' :
                  connectionStatus === 'Server Busy' ? 'bg-indigo-500' :
                  connectionStatus === 'Another Tab Active' ? 'bg-blue-500' :
                  'bg-red-500'
                }`}>
                  {connectionStatus === 'Connected' && isStableConnection && (
                    <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-60"></div>
                  )}
                  {(connectionStatus === 'Reconnecting...' || (connectionStatus === 'Connected' && !isStableConnection)) && (
                    <div className="absolute inset-0 rounded-full bg-yellow-400 animate-pulse opacity-60"></div>
                  )}
                </div>
                <span className={`text-sm font-bold tracking-wide transition-colors duration-300 ${
                  connectionStatus === 'Connected' && isStableConnection ? 'text-green-700' :
                  connectionStatus === 'Connected' ? 'text-yellow-700' :
                  connectionStatus === 'Reconnecting...' ? 'text-yellow-700' :
                  connectionStatus === 'Offline' ? 'text-orange-700' :
                  connectionStatus === 'Auth Error' ? 'text-purple-700' :
                  connectionStatus === 'Server Busy' ? 'text-indigo-700' :
                  connectionStatus === 'Another Tab Active' ? 'text-blue-700' :
                  'text-red-700'
                }`}>
                  {connectionStatus === 'Connected' && isStableConnection ? 'CONNECTED' : 
                   connectionStatus === 'Connected' ? 'CONNECTING...' :
                   connectionStatus === 'Reconnecting...' ? 'RECONNECTING' :
                   connectionStatus === 'Offline' ? 'OFFLINE' :
                   connectionStatus === 'Auth Error' ? 'AUTH ERROR' :
                   connectionStatus === 'Server Busy' ? 'SERVER BUSY' :
                   connectionStatus === 'Another Tab Active' ? 'OTHER TAB ACTIVE' :
                   'DISCONNECTED'}
                </span>
                {connectionStatus === 'Connected' && isStableConnection && (
                  <svg className="w-4 h-4 ml-2 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <button
                onClick={refreshData}
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Enhanced Sensor Data Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Temperature Card */}
          <div className="bg-gradient-to-r from-red-50 to-red-100 overflow-hidden shadow-lg rounded-xl border border-red-200">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-r from-red-400 to-red-600 rounded-full flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <dt className="text-sm font-medium text-red-600 uppercase tracking-wide">Temperature</dt>
                    <dd className="text-3xl font-bold text-red-900">{sensorData.temperature}°C</dd>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-red-500">Live</div>
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Humidity Card */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 overflow-hidden shadow-lg rounded-xl border border-blue-200">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <dt className="text-sm font-medium text-blue-600 uppercase tracking-wide">Humidity</dt>
                    <dd className="text-3xl font-bold text-blue-900">{sensorData.humidity}%</dd>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-blue-500">Live</div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Air Quality Card */}
          <div className="bg-gradient-to-r from-emerald-50 to-emerald-100 overflow-hidden shadow-lg rounded-xl border border-emerald-200">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <dt className="text-sm font-medium text-emerald-600 uppercase tracking-wide">Air Quality</dt>
                    <dd className="flex items-center">
                      <span className="text-3xl font-bold text-emerald-900 mr-3">{sensorData.mq135}</span>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getAirQualityColor(sensorData.mq135)}`}>
                        {getAirQualityStatus(sensorData.mq135)}
                      </span>
                    </dd>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-emerald-500">MQ135</div>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Temperature Chart */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">Temperature Trend</h3>
                <div className="flex items-center text-sm text-gray-500">
                  <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                  Live Data
                </div>
              </div>
              <div className="h-72">
                <Line data={temperatureChartData} options={temperatureChartOptions} />
              </div>
            </div>
          </div>

          {/* Humidity Chart */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">Humidity Trend</h3>
                <div className="flex items-center text-sm text-gray-500">
                  <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                  Live Data
                </div>
              </div>
              <div className="h-72">
                <Line data={humidityChartData} options={humidityChartOptions} />
              </div>
            </div>
          </div>
        </div>

        {/* Air Quality Chart - Full Width */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Air Quality Trend</h3>
              <div className="flex items-center text-sm text-gray-500">
                <div className="w-3 h-3 bg-emerald-500 rounded-full mr-2"></div>
                MQ135 Sensor
              </div>
            </div>
            <div className="h-80">
              <Line data={airQualityChartData} options={airQualityChartOptions} />
            </div>
          </div>
        </div>

        {/* ESP32 Information Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Display Message */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                <svg className="w-5 h-5 inline mr-2 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
                ESP32 Display Message
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {displayMessage}
                </p>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Topic: esp32/display
              </div>
            </div>
          </div>

          {/* Email Summary */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                <svg className="w-5 h-5 inline mr-2 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
                </svg>
                Latest Email Summary
              </h3>
              <div className="bg-gray-50 rounded-lg p-4 max-h-32 overflow-y-auto">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {emailSummary}
                </p>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Topic: esp32/email_summary
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Section */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Statistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {historicalData.temperature.length > 0 
                    ? Math.max(...historicalData.temperature).toFixed(1) 
                    : '--'}°C
                </div>
                <div className="text-sm text-gray-500">Max Temperature</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {historicalData.humidity.length > 0 
                    ? Math.max(...historicalData.humidity).toFixed(1) 
                    : '--'}%
                </div>
                <div className="text-sm text-gray-500">Max Humidity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {historicalData.labels.length}
                </div>
                <div className="text-sm text-gray-500">Data Points</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>AuraLink IoT Dashboard - Real-time sensor monitoring, charts, and ESP32 integration</p>
          <p className="mt-1">Connected to HiveMQ Cloud via WebSocket | Displaying last {MAX_DATA_POINTS} data points</p>
          <p className="mt-1">Topics: Temperature • Humidity • Air Quality • Display Messages • Email Summaries</p>
        </div>
      </div>
    </div>
  );
}

export default App;
