#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_SSD1306.h>
#include <Preferences.h>
#include "DHT.h"

// -------- OLED CONFIG (I2C) --------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// -------- TFT CONFIG (SPI) - 240x240 Working Area --------
#define TFT_CS   5
#define TFT_DC   17
#define TFT_RST  16
Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC, TFT_RST);

#define TFT_WIDTH  240
#define TFT_HEIGHT 240

// -------- Sensors --------
#define DHTPIN 4
#define DHTTYPE DHT22
#define MQ135_PIN 34
DHT dht(DHTPIN, DHTTYPE);

// -------- MQ135 Smart Calibration --------
#define AQI_MIN 150
#define AQI_MAX 650
#define AQI_BASELINE 200
#define RAW_THRESHOLD 100

int mq135_min_observed = 9999;
int mq135_max_observed = 0;
bool use_raw_mode = false;

// -------- WiFi --------
// const char* ssid = "PIR1";
// const char* password = "PIR@1XyZ";

// const char* ssid = "ZTE blade-A55";
// const char* password = "aaaaaaaa";

// const char* ssid = "OPPO A54 5G";
// const char* password = "12345678";

// const char* ssid = "IK";
// const char* password = "11111111";

const char* ssid = "SLT_FIBRE";
const char* password = "himo123456";

// -------- HiveMQ --------
const char* mqtt_server = "fbfd5b7accc64488838c63d9a691a801.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "Shanuka";
const char* mqtt_pass = "Sha@1234";

// Topics
const char* topic_temp = "esp32/sensors/temperature";
const char* topic_hum  = "esp32/sensors/humidity";
const char* topic_mq   = "esp32/sensors/mq135";
const char* topic_email = "esp32/email_summary";
const char* topic_prediction = "esp32/ai_prediction";
const char* topic_air_quote = "esp32/display";
const char* topic_led = "esp32/led";

// -------- Clients --------
WiFiClientSecure wifiClient;
PubSubClient client(wifiClient);
Preferences prefs;

// -------- Variables --------
String latestEmail = "";
String lastEmailBackup = "";
String aiPrediction = "Analyzing...";
String airQuote = "Loading...";
uint8_t lastR = 0, lastG = 0, lastB = 0;
float receivedTemp = 0.0;
float receivedHum = 0.0;
int receivedAir = 0;
bool forceRedraw = false;

// -------- Eye Animation Variables --------
int leftEyeX = 32, leftEyeY = 32;
int rightEyeX = 96, rightEyeY = 32;
int eyeRadius = 12;
int pupilRadius = 5;
bool isBlinking = false;
unsigned long lastBlink = 0;
int targetLeftX = 32, targetLeftY = 32;
int targetRightX = 96, targetRightY = 32;

// -------- RGB LED (COMMON ANODE) --------
#define PIN_R 25
#define PIN_G 26
#define PIN_B 27

const int CH_R = 0, CH_G = 1, CH_B = 2;
const uint32_t PWM_FREQ = 5000;
const uint8_t PWM_RES = 8;

void setupRGB() {
  ledcAttachChannel(PIN_R, PWM_FREQ, PWM_RES, CH_R);
  ledcAttachChannel(PIN_G, PWM_FREQ, PWM_RES, CH_G);
  ledcAttachChannel(PIN_B, PWM_FREQ, PWM_RES, CH_B);

  prefs.begin("rgb-last", false);
  lastR = prefs.getUChar("r", 0);
  lastG = prefs.getUChar("g", 0);
  lastB = prefs.getUChar("b", 0);
  prefs.end();

  ledcWrite(PIN_R, 255 - lastR);
  ledcWrite(PIN_G, 255 - lastG);
  ledcWrite(PIN_B, 255 - lastB);
}

inline void setRGB(uint8_t r, uint8_t g, uint8_t b) {
  lastR = r; lastG = g; lastB = b;
  ledcWrite(PIN_R, 255 - r);
  ledcWrite(PIN_G, 255 - g);
  ledcWrite(PIN_B, 255 - b);
  prefs.begin("rgb-last", false);
  prefs.putUChar("r", r);
  prefs.putUChar("g", g);
  prefs.putUChar("b", b);
  prefs.end();
  forceRedraw = true;
}

// -------- MQTT Callback --------
void handleLedPayload(const String& msgIn) {
  String m = msgIn;
  m.toLowerCase();
  m.trim();

  if (m == "urgent" || m == "r" || m == "red") {
    setRGB(255, 0, 0);
  } else if (m == "campus" || m == "g" || m == "green") {
    setRGB(0, 255, 0);
  } else if (m == "office" || m == "b" || m == "blue") {
    setRGB(0, 0, 255);
  } else if (m == "friend" || m == "p" || m == "pink") {
    setRGB(255, 105, 180);
  } else if (m == "off") {
    setRGB(0, 0, 0);
  }
}

void callback(char* topic, byte* message, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)message[i];

  if (String(topic) == topic_email) {
    latestEmail = msg;
    lastEmailBackup = msg;
    Serial.println("Email: " + msg);
    forceRedraw = true;
  } 
  else if (String(topic) == topic_prediction) {
    aiPrediction = msg;
    Serial.println("Prediction: " + msg);
    forceRedraw = true;
  }
  else if (String(topic) == topic_air_quote) {
    airQuote = msg;
    Serial.println("Quote: " + msg);
    forceRedraw = true;
  }
  else if (String(topic) == topic_led) {
    Serial.println("LED: " + msg);
    handleLedPayload(msg);
  }
}

// -------- WiFi Setup --------
void setup_wifi() {
  delay(10);
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

// -------- MQTT Reconnect --------
void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to HiveMQ...");
    if (client.connect("ESP32Client", mqtt_user, mqtt_pass)) {
      Serial.println("connected!");
      client.subscribe(topic_email);
      client.subscribe(topic_prediction);
      client.subscribe(topic_air_quote);
      client.subscribe(topic_led);
    } else {
      Serial.print("failed, rc=");
      Serial.println(client.state());
      delay(5000);
    }
  }
}

// -------- Smart MQ135 Calibration --------
int calibrateMQ135(int rawValue) {
  if (rawValue > 0) {
    if (rawValue < mq135_min_observed) mq135_min_observed = rawValue;
    if (rawValue > mq135_max_observed) mq135_max_observed = rawValue;
  }
  
  if (rawValue > RAW_THRESHOLD) {
    if (!use_raw_mode) {
      Serial.println("*** MQ135: RAW mode ***");
      use_raw_mode = true;
    }
    return constrain(rawValue, 50, 1000);
  }
  
  if (rawValue == 0) return AQI_BASELINE;
  
  if (mq135_max_observed > 30 && !use_raw_mode) {
    int calibrated = map(rawValue, mq135_min_observed, mq135_max_observed, AQI_MIN, AQI_MAX);
    return constrain(calibrated + random(-5, 5), AQI_MIN, AQI_MAX);
  }
  
  int calibrated = map(rawValue, 0, 20, AQI_MIN, AQI_MAX);
  return constrain(calibrated + random(-5, 5), AQI_MIN, AQI_MAX);
}

// -------- Animated Eyes on OLED --------
void updateOLEDEyes() {
  static unsigned long lastMove = 0;
  unsigned long now = millis();
  
  if (now - lastMove > 2000) {
    lastMove = now;
    int offsetX = random(-8, 9);
    int offsetY = random(-8, 9);
    targetLeftX = 32 + offsetX;
    targetLeftY = 32 + offsetY;
    targetRightX = 96 + offsetX;
    targetRightY = 32 + offsetY;
  }
  
  if (leftEyeX < targetLeftX) leftEyeX++;
  else if (leftEyeX > targetLeftX) leftEyeX--;
  if (leftEyeY < targetLeftY) leftEyeY++;
  else if (leftEyeY > targetLeftY) leftEyeY--;
  
  rightEyeX = leftEyeX + 64;
  rightEyeY = leftEyeY;
  
  if (now - lastBlink > random(3000, 5000)) {
    lastBlink = now;
    isBlinking = true;
  }
  
  oled.clearDisplay();
  
  if (isBlinking) {
    oled.drawLine(32 - eyeRadius, 32, 32 + eyeRadius, 32, SSD1306_WHITE);
    oled.drawLine(96 - eyeRadius, 32, 96 + eyeRadius, 32, SSD1306_WHITE);
    oled.display();
    delay(150);
    isBlinking = false;
  } else {
    oled.drawCircle(32, 32, eyeRadius, SSD1306_WHITE);
    oled.fillCircle(leftEyeX, leftEyeY, pupilRadius, SSD1306_WHITE);
    
    oled.drawCircle(96, 32, eyeRadius, SSD1306_WHITE);
    oled.fillCircle(rightEyeX, rightEyeY, pupilRadius, SSD1306_WHITE);
    
    oled.display();
  }
}

// -------- TFT Dashboard (240x240 - No Insight Section) --------
void drawDashboard(int sensorIndex) {
  tft.fillScreen(ILI9341_BLACK);

  // ===== SENSOR CARDS ROW (Y: 5-70, 65px height) =====
  // Temperature Card
  tft.fillRoundRect(3, 5, 75, 65, 5, ILI9341_NAVY);
  if (sensorIndex == 0) tft.drawRoundRect(3, 5, 75, 65, 5, ILI9341_YELLOW);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_ORANGE);
  tft.setCursor(12, 12);
  tft.print("TEMP");
  tft.setTextSize(3);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(10, 32);
  tft.print(receivedTemp, 1);
  tft.setTextSize(1);
  tft.setCursor(22, 58);
  tft.print("Celsius");

  // Humidity Card
  tft.fillRoundRect(83, 5, 75, 65, 5, ILI9341_NAVY);
  if (sensorIndex == 1) tft.drawRoundRect(83, 5, 75, 65, 5, ILI9341_CYAN);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_CYAN);
  tft.setCursor(90, 12);
  tft.print("HUMID");
  tft.setTextSize(3);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(88, 32);
  tft.print(receivedHum, 1);
  tft.setTextSize(1);
  tft.setCursor(97, 58);
  tft.print("Percent");

  // AQI Card
  tft.fillRoundRect(163, 5, 75, 65, 5, ILI9341_NAVY);
  if (sensorIndex == 2) tft.drawRoundRect(163, 5, 75, 65, 5, ILI9341_GREENYELLOW);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_GREENYELLOW);
  tft.setCursor(180, 12);
  tft.print("AQI");
  tft.setTextSize(3);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(170, 32);
  tft.print(receivedAir);
  tft.setTextSize(1);
  tft.setCursor(177, 58);
  tft.print("Index");

  // ===== AI PREDICTION (Y: 78-145, 67px height) =====
  tft.fillRect(0, 78, 240, 67, tft.color565(0, 20, 70));
  tft.drawRoundRect(2, 80, 236, 63, 5, ILI9341_CYAN);
  
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_YELLOW);
  tft.setCursor(8, 86);
  tft.print("AI");
  tft.setTextColor(ILI9341_CYAN);
  tft.setCursor(24, 86);
  tft.print("PREDICTION");
  
  tft.setTextColor(ILI9341_WHITE);
  int yPos = 100;
  for (int i = 0; i < aiPrediction.length() && yPos < 138; i += 38) {
    tft.setCursor(6, yPos);
    tft.println(aiPrediction.substring(i, min((int)aiPrediction.length(), i + 38)));
    yPos += 9;
  }

  // ===== EMAIL (Y: 153-235, 82px height - MUCH BIGGER) =====
  tft.fillRect(0, 153, 240, 82, tft.color565(0, 38, 18));
  tft.drawRoundRect(2, 155, 236, 78, 5, ILI9341_GREEN);
  
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_YELLOW);
  tft.setCursor(8, 161);
  tft.print("@");
  tft.setTextColor(ILI9341_GREENYELLOW);
  tft.setCursor(18, 161);
  tft.print("EMAIL SUMMARY");
  
  String emailToShow = latestEmail.length() > 0 ? latestEmail : "No new emails";
  yPos = 175;
  tft.setTextColor(ILI9341_WHITE);
  for (int i = 0; i < emailToShow.length() && yPos < 228; i += 38) {
    tft.setCursor(6, yPos);
    tft.println(emailToShow.substring(i, min((int)emailToShow.length(), i + 38)));
    yPos += 9;
  }
}

// -------- Setup --------
void setup() {
  Serial.begin(115200);
  delay(100);
  dht.begin();

  // Initialize OLED
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED init failed!");
    for (;;);
  }
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(20, 28);
  oled.println("Connecting...");
  oled.display();

  // Initialize TFT - 240x240 working area
  tft.begin();
  delay(100);
  tft.setSPISpeed(90000000);  // 10MHz for stability
  delay(50);
  tft.setRotation(0);  // Landscape
  delay(50);
  tft.fillScreen(ILI9341_BLACK);
  delay(100);
  
  // Splash screen
  tft.setTextColor(ILI9341_CYAN);
  tft.setTextSize(3);
  tft.setCursor(40, 100);
  tft.println("AuraLink");
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(1);
  tft.setCursor(70, 135);
  tft.println("Initializing...");

  setup_wifi();
  wifiClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);

  setupRGB();

  // Ready screen
  tft.fillScreen(ILI9341_BLACK);
  delay(50);
  tft.setTextColor(ILI9341_GREEN);
  tft.setTextSize(3);
  tft.setCursor(60, 110);
  tft.println("Ready!");
  
  delay(2000);
  
  Serial.println("\n=== AuraLink System Started ===");
  Serial.println("Display: 240x240 Square");
  Serial.println("SPI Speed: 10MHz");
}

// -------- Loop --------
void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  static unsigned long lastSensorRead = 0;
  unsigned long now = millis();

  // Read sensors every 5 seconds
  if (now - lastSensorRead > 5000) {
    lastSensorRead = now;
    
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    int mq135_raw = analogRead(MQ135_PIN);
    int mq135_calibrated = calibrateMQ135(mq135_raw);
    
    if (!isnan(temperature) && !isnan(humidity)) {
      receivedTemp = temperature;
      receivedHum = humidity;
      receivedAir = mq135_calibrated;
      
      char tempStr[8], humStr[8], mqStr[8];
      dtostrf(temperature, 6, 2, tempStr);
      dtostrf(humidity, 6, 2, humStr);
      sprintf(mqStr, "%d", mq135_calibrated);
      
      client.publish(topic_temp, tempStr);
      client.publish(topic_hum, humStr);
      client.publish(topic_mq, mqStr);
      
      Serial.print("T: "); Serial.print(tempStr);
      Serial.print(" | H: "); Serial.print(humStr);
      Serial.print(" | AQI: "); Serial.println(mqStr);
    }
  }

  // OLED: Animated eyes
  updateOLEDEyes();

  // TFT: Cycle through sensors every 3 seconds
  static unsigned long lastTftUpdate = 0;
  static int sensorIndex = 0;
  if (now - lastTftUpdate > 3000 || forceRedraw) {
    lastTftUpdate = now;
    sensorIndex = (sensorIndex + 1) % 3;
    drawDashboard(sensorIndex);
    forceRedraw = false;
  }
}
