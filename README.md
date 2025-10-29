# IoT Dashboard - React.js MQTT WebSocket Client

A real-time IoT dashboard built with React.js that connects to HiveMQ Cloud broker over WebSockets to monitor sensor data and control RGB LED devices.

## Features

- **Real-time Sensor Monitoring**: Displays Temperature, Humidity, and Air Quality (MQ135) data
- **RGB LED Control**: Interactive color picker to control ESP32 RGB LED
- **Live Connection Status**: Shows MQTT connection status with visual indicators
- **Responsive Design**: Mobile and desktop friendly interface using Tailwind CSS
- **Auto-refresh**: Real-time updates when new MQTT messages arrive
- **Manual Refresh**: Button to manually refresh sensor data

## MQTT Configuration

- **Broker**: `wss://5b4d2de50e5b4e87a4fa4a541b154044.s1.eu.hivemq.cloud:8884/mqtt`
- **Username**: `Shanuka`
- **Password**: `Sha@1234`

### Subscribed Topics
- `esp32/sensors/temperature` - Temperature readings
- `esp32/sensors/humidity` - Humidity readings  
- `esp32/sensors/mq135` - Air quality readings
- `esp32/sensors/led` - Current LED color status

### Published Topics
- `esp32/led` - RGB LED color control (HEX format)
- `esp32/control` - General control commands (e.g., refresh)

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Modern web browser with WebSocket support

## Installation & Setup

1. **Navigate to the project directory**
   ```bash
   cd iot-dashboard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Open in browser**
   - The app will automatically open at `http://localhost:3000`
   - Or manually navigate to the URL shown in the terminal

## Usage

### Connecting to MQTT Broker
The app automatically connects to the HiveMQ Cloud broker when it starts. Check the connection status indicator in the top-right corner:
- 🟢 **Green**: Connected
- 🟡 **Yellow**: Reconnecting
- 🔴 **Red**: Disconnected/Error

### Monitoring Sensor Data
The dashboard displays three main sensor readings:
- **Temperature**: Shows current temperature in Celsius
- **Humidity**: Shows current humidity percentage
- **Air Quality**: Shows MQ135 sensor reading with color-coded status
  - Green: Good (< 100)
  - Yellow: Moderate (100-200)
  - Orange: Poor (200-300)
  - Red: Dangerous (> 300)

### Controlling RGB LED
1. Use the color picker in the LED Control section
2. Select any color - the HEX value will be automatically published to `esp32/led` topic
3. The current LED color is displayed in real-time based on feedback from the device

### Manual Refresh
Click the "Refresh" button in the header to send a refresh command to your ESP32 device via the `esp32/control` topic.

## Available Scripts

### `npm start`
Runs the app in the development mode at [http://localhost:3000](http://localhost:3000)

### `npm run build`
Builds the app for production to the `build` folder

### `npm test`
Launches the test runner in interactive watch mode

## Dependencies

- **react**: UI framework
- **mqtt**: MQTT client for WebSocket connections
- **tailwindcss**: Utility-first CSS framework
- **postcss**: CSS processing
- **autoprefixer**: CSS vendor prefixing

## Troubleshooting

### Connection Issues
- Verify MQTT broker URL, username, and password
- Check if broker supports WebSocket connections
- Ensure firewall allows WebSocket connections on port 8884

### Build Issues
- Make sure all dependencies are installed: `npm install`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version compatibility

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
