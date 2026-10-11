# Ford Developer API – Dokumentation (FordConnect Query)

> Zusammengestellt am 12.10.2026 aus dem Ford Developer Marketplace (`developer.ford.com`) und der dort hinterlegten OpenAPI-Spezifikation.
> Ford weist darauf hin: *„APIs subject to change without notice.“*

---

## 1. Überblick: APIs im Ford Developer Marketplace

| API | Region | Zweck | Doku-Zugang |
|---|---|---|---|
| **FordConnect Query** | EU, UK, NA | Echtzeit-Fahrzeugdaten (Telemetrie, Laden, Akku, Wallbox, Health …) mit Kundeneinwilligung | OpenAPI-Spec nach Login |
| WLTP-Values | nur EU | WLTP-Verbrauch/CO2/E-Reichweite, Gewicht & Reifen für eine konkrete Neuwagen-Konfiguration (für autorisierte Systemanbieter) | „Learn more“ / auf Anfrage |
| Payment Estimator | NA | Finanzierungs-/Leasing-Raten für neue Ford/Lincoln (OAuth 2.0 Authorization Code) | nur über „Contact us“ |
| Feed Service | – | Bulk-Transfer von Telematikdaten für Ford UBI (TMC-Plattform), Java-SDK | „Learn more“ |

Für ein EV-Projekt ist ausschließlich **FordConnect Query** relevant – der Rest dieses Dokuments beschreibt diese API.

---

## 2. FordConnect Query – Grunddaten

| Eigenschaft | Wert |
|---|---|
| Interner Name | `FCON Query service` (API for FCON Query service) |
| Version | `1.0.0` (OpenAPI `3.0.1`) |
| Base-URL | `https://api.vehicle.ford.com/fcon-query` |
| Spezifikation (JSON, Login nötig) | `https://api.vehicle.ford.com/dmapiresource/v1/api-catalog/apis/fordconnect-query/specification` |
| Methoden | ausschließlich `GET` (nur lesend) |
| Antwortformat | `application/json` (Ausnahme: `departure-times` deklariert `*/*`) |
| Zielgruppe | Einzelentwickler, kleine & große Organisationen |

### Endpoints auf einen Blick

| Methode | Pfad | Tag | operationId | Beschreibung | Response-Schema |
|---|---|---|---|---|---|
| GET | `/v1/garage` | Garage | `getGarageInfoV1` | Fahrzeuge in der Garage des Nutzers | `GarageResponseDTO` |
| GET | `/v1/telemetry` | Telemetry | `getVehicleTelemetryDetailsV1` | Komplette Fahrzeug-Telemetrie | `TelemetryResponse` |
| GET | `/v1/electric/charge-schedules` | Electric | `getElectricChargeSchedulesV1` | Ladepläne (Standort, Ziel-SoC, Zeitfenster, Tarif) | `ChargeScheduleResponse` |
| GET | `/v1/electric/departure-times` | Electric | `getElectricDepartureTimesV1` | Abfahrtszeiten inkl. Vorkonditionierung | `DepartureTimeResponse` |
| GET | `/v1/fccs` | Charging Station | `getStationIdActivityV1` | Aktivitäten (OCPP-Events) einer Ford-Ladestation | `FccsResponse` |
| GET | `/v1/wallbox` | Wallbox | `getWallboxDetailsV1` | Zugeordnete Wallbox-/Ladestations-IDs | `WallboxResponse` |
| GET | `/v1/vehicle-health/alerts` | Vehicle Health | `getVehicleAlertsV1` | Aktive Fahrzeug-Warnmeldungen | `VehicleAlertResponse` |
| GET | `/v1/vehicle-image` | Vehicle Image | `getVehicleImageV1` | Fahrzeugbild | `VehicleImageResponse` |

> **Hinweis:** Bis auf `/v1/fccs` deklariert die Spezifikation **keine Parameter** (kein `vin`, keine Header). Das Fahrzeug ergibt sich offenbar aus dem OAuth-Token/der Kundeneinwilligung. Ob bei mehreren Fahrzeugen ein zusätzlicher Header (z. B. VIN) nötig ist, ist in der Spec nicht dokumentiert → beim ersten echten Call prüfen.

---

## 3. Authentifizierung & Onboarding

### 3.1 OAuth 2.0
- Laut Beschreibung: **OAuth 2.0 Authorization Code Flow** mit granularen Scopes; der Fahrzeughalter muss der App explizit zustimmen (Consent).
- Im Onboarding-Formular: *„FordConnect verwendet den OAuth-Autorisierungscode-Token-Flow“* – man hinterlegt erlaubte **Redirect-URIs** (kommagetrennt; eigene Domain/API oder `http://localhost`).
- Security-Scheme in der OpenAPI-Spec:

```json
"AzureAD": {
  "type": "oauth2",
  "flows": {
    "clientCredentials": {
      "tokenUrl": "https://dah2vb2cprod.b2clogin.com/dah2vb2cprod.onmicrosoft.com/B2C_1A_FCON_AUTHORIZE/discovery/v2.0/keys",
      "scopes": { "read": "for read operations", "write": "for write operations" }
    }
  }
}
```

- Identity Provider: **Azure AD B2C**, Tenant `dah2vb2cprod`, Policy `B2C_1A_FCON_AUTHORIZE`.
- ⚠️ Inkonsistenz in der Spec: deklariert ist `clientCredentials`, und die `tokenUrl` zeigt auf den **JWKS-Endpoint** (`/discovery/v2.0/keys`), nicht auf einen Token-Endpoint. Nach Azure-B2C-Konvention lauten die eigentlichen Endpoints vermutlich:
  - Authorize: `https://dah2vb2cprod.b2clogin.com/dah2vb2cprod.onmicrosoft.com/B2C_1A_FCON_AUTHORIZE/oauth2/v2.0/authorize`
  - Token: `https://dah2vb2cprod.b2clogin.com/dah2vb2cprod.onmicrosoft.com/B2C_1A_FCON_AUTHORIZE/oauth2/v2.0/token`
  - OpenID-Konfiguration: `…/B2C_1A_FCON_AUTHORIZE/v2.0/.well-known/openid-configuration`

  *(Abgeleitet, nicht explizit dokumentiert – verifizieren!)*
- Requests: `Authorization: Bearer <access_token>`.

### 3.2 App-Registrierung (Region EU / UK / NA)
1. **App-Details**: Name, Beschreibung, Nutzungszweck.
2. **Persönlicher Gebrauch?** (Ja/Nein) + USt-Länderauswahl (EU-Länder, `XI` Nordirland).
3. **Fahrzeugtypen** (mind. einer): Verbrenner (inkl. Hybrid), Plug-in-Hybrid, Elektrofahrzeug.
4. **Redirect-URIs** für den Authorization-Code-Flow.
5. **Datenkategorien (Scopes)** auswählen, auf die die App Zugriff braucht.
- EU: Authentifizierung erfolgt unter dem **EU Data Act** (Bestätigung, dass man sich in der EU befindet).

### 3.3 Client-Credentials (aus den FAQs)
- Client-ID & Secret sind **umgebungsspezifisch** (z. B. `foo-preprod`, `foo-prod`).
- **Client-Secret läuft nach 1 Jahr ab**; Ablaufdatum unter *My Developer Account → Client Credentials*; „Regenerate secret“ möglich.
- Nur **ein aktives Secret** pro Umgebung; Secret wird nicht gespeichert → bei Erzeugung sofort sichern.
- Freischaltung eines neuen Projekts für eine API kann ~1 Stunde dauern.
- Eine Projekt-/Client-ID kann für mehrere APIs genutzt werden.

---

## 4. Fehlerbehandlung

Alle Endpoints liefern im Fehlerfall `ErrorDTO` (bei 401/403 alternativ `text/html`).

| Code | Bedeutung |
|---|---|
| 200 | OK |
| 400 | Bad Request |
| 401 | Unauthorized (Token fehlt/ungültig) |
| 403 | Forbidden (fehlender Scope/Consent) |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 406 | Not Acceptable |
| 415 | Unsupported Media Type |
| 429 | Too Many Requests (Rate-Limit – konkrete Limits nicht dokumentiert) |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| default | Unexpected error |

```json
// ErrorDTO
{
  "timestamp": "2025-08-15T21:53:06.41924Z",   // date-time
  "error": 400,                                // int32
  "message": "Bad Request",
  "traceId": "123e4567-e89b-12d3-a456-426614174000",
  "path": "/api/my-path"
}
```

---

## 5. Endpoints im Detail

### 5.1 `GET /v1/garage` – Fahrzeuge des Nutzers

Response `GarageResponseDTO` (alle Felder außer `nickName` sind *required*):

| Feld | Typ | Beispiel |
|---|---|---|
| `vin` | string | `1FABP1329FW178914` |
| `nickName` | string | `TestVehicle` |
| `vehicleType` | string | `2018 Fusion` |
| `color` | string | `OXFORD WHITE SOLID C/C` |
| `modelName` | string | `Fusion` |
| `modelCode` | string | `VLC7` |
| `modelYear` | string | `2018` |
| `tcuEnabled` | int32 | `0` |
| `make` | string | `Ford` |
| `ngSdnManaged` | int32 | `0` |
| `vehicleAuthorizationIndicator` | int32 | `0` |
| `engineType` | string | `BEV` |

### 5.2 `GET /v1/telemetry` – Fahrzeug-Telemetrie

Response `TelemetryResponse`:

| Feld | Typ |
|---|---|
| `updateTime` | string (date-time) |
| `deviceId` | string |
| `vehicleId` | string |
| `vin` | string |
| `metrics` | `MetricsResponse` (siehe Abschnitt 6) |
| `geofenceEvents` | `GeofenceEvent[]` |
| `geofenceState` | `GeofenceState` |

### 5.3 `GET /v1/electric/charge-schedules` – Ladepläne

`ChargeScheduleResponse` → `chargeSchedules: ChargeSchedules[]`

```
ChargeSchedules
├─ vin: string
├─ location: Location
│   ├─ id: int32 (1)          ├─ name: string ("Location 1")
│   ├─ type: SAVED | UNSAVED  ├─ geoHash: string ("abcDe938")
│   ├─ tags: string[]         ├─ latitude / longitude: double (40.712728 / -74.006015)
│   ├─ timeZoneOffset: string ("UTC-04:00")
│   └─ network: string ("UNKNOWN")
└─ chargeProfile: ChargeProfile
    ├─ chargeMode: CHARGE_NOW | VALUE_CHARGE
    ├─ targetSoc: int32 (90)  → Ziel-Ladestand in %
    ├─ utilityProvider: UtilityProvider
    │   ├─ id, providerName, planId, planName, zipCode: string
    │   ├─ seasonStartDate / seasonEndDate: string ("08-01-2025", Format MM-DD-YYYY)
    │   ├─ price: double (123.45)
    │   └─ country: string (ISO-3166 alpha-3, z. B. "DEU")
    └─ schedules: Schedules[]
        ├─ days: WEEKDAY | WEEKEND
        └─ windows: Windows[] { startTime: "00:00", endTime: "02:00" }
```

### 5.4 `GET /v1/electric/departure-times` – Abfahrtszeiten

`DepartureTimeResponse` → `departureTimes: DepartureTimes`

| Feld | Typ | Beispiel |
|---|---|---|
| `vin` | string | `1FABP1329FW178914` |
| `isDepartureTimesEnabled` | boolean | `true` |
| `isSrsEnabled` | boolean | `true` |
| `timeZoneId` | string | `UTC` |
| `goTimesScheduleCloudData` | `TimesScheduleCloudData` | |

```
TimesScheduleCloudData.calendarDaysList: CalendarDays[]
  CalendarDays { calendarDay: int32 (15), scheduleFromCloudList: ScheduleFromCloud[] }
  ScheduleFromCloud { scheduleId: int32 (99), hr: int32 (0–23), min: int32 (0–59),
                      preConditioningTemp: High | Medium | Low | Off }
```

### 5.5 `GET /v1/fccs` – Aktivität einer Ford-Ladestation

| Parameter | In | Pflicht | Typ | Beschreibung |
|---|---|---|---|---|
| `chargingStationId` | **header** | ja | string | ID der Ladestation (UUID, z. B. aus `/v1/wallbox`) |
| `startDate` | query | nein | string | Startdatum (Format nicht spezifiziert) |
| `endDate` | query | nein | string | Enddatum |

`FccsResponse` → `result: FccsResult { activity: Activity[], totalActivities: int32 }`

`Activity`:

| Feld | Beispiel |
|---|---|
| `chargingStationId` | `00000000-1111-2222-3333-444444444444` |
| `chargingStationIdentity` | `WEBX002` |
| `error` / `errorDesc` | Fehlertext |
| `event` / `eventType` | `Connect` |
| `eventId` | UUID |
| `messageId` | `14291640568141234` |
| `ocppVersion` | `ocpp1.6` |
| `publishTime` | `2025-03-19 09:18:50.000 UTC` (kein ISO-8601!) |
| `requestPayload` / `responsePayload` | OCPP-Payload als String |
| `sessionId` | UUID |
| `status` | `Completed` |
| `vendorCode` | `WEB` |

### 5.6 `GET /v1/wallbox`

`WallboxResponse` → `result: { associatedChargingStationIds: string[] }` (UUIDs, nutzbar für `/v1/fccs`).

### 5.7 `GET /v1/vehicle-health/alerts`

```
VehicleAlertResponse
├─ message: "Success"   ├─ status: int32 (2000)   ├─ version: "1.0"
└─ VehicleAlertList: VehicleAlert[]
    ├─ Vin, ActivityId (UUID), EventTimeStamp: string
    ├─ StatusCode: int32 (z. B. 4040)  ├─ StatusDesc: "No Data"
    └─ ActiveAlerts: ActiveAlert[]
        ├─ Headline, FormattedBody: string
        ├─ Body { whatIsHappening, whatShouldIdo }
        └─ Metadata
            ├─ categoryId: int32, categoryName: string, displaySequence: int32
            ├─ dtcCode, failureCode, wilCode: string, severity: int32
            └─ components { version, headline{enable}, icon{assetLocation, default},
                            actions{roadsideAssistance: int32, scheduleService: int32} }
```

⚠️ Achtung: Feldnamen hier in **PascalCase** (`VehicleAlertList`, `Vin`, …), sonst überall camelCase.

### 5.8 `GET /v1/vehicle-image`

`VehicleImageResponse` → `vehicleImage: string` (Format nicht spezifiziert – vermutlich Base64 oder URL).

---

## 6. Telemetrie-Datenmodell (`MetricsResponse`)

### 6.1 Gemeinsames Muster aller Metriken

Nahezu jede Metrik ist ein Objekt dieser Form:

```json
{
  "updateTime": "2025-08-15T21:53:06.41924Z",  // ISO-8601, UTC
  "oemCorrelationId": "9999",
  "tags": { "KEY": "VALUE" },
  "value": 12.2                                 // double, Enum-String, Objekt oder Array
}
```

Basistypen:

| Typ | `value` | Zusatzfelder |
|---|---|---|
| `StandardDouble` | double | – |
| `StandardBrakeXevBattery` | double | – |
| `StandardAmbientAccelerator` | double | `duration` (int64) |
| `StandardStatusResponse` | `UNKNOWN, OFF, ON` | – |
| `StandardWarningStatus` | `UNDEFINED, ACTIVE, INACTIVE` | – |
| `StandardPlugChargerStatus` | `UNKNOWN, DISCONNECTED, CONNECTED` | – |
| `StandardTrip` | double | `tripProgress`: `TRIP_IN_PROGRESS, TRIP_END` |
| `StandardGearPosition` | `PARK, REVERSE, NEUTRAL, DRIVE, SPORT, LOW, GEAR_1…GEAR_24, NOT_GEAR_1…6` | – |
| `StandardUpfitter` | `OFF, ON` | `upfitterPortId` |
| `StandardSetting` | double | `error: ErrorConfigurationValue` |
| `StandardSoftwareUpdate` | `OFF, ON` | `error` |

Alle Enums enthalten zusätzlich `UNKNOWN`/`UNDEFINED` und `UNRECOGNIZED` (Protobuf-Herkunft) – Clients sollten unbekannte Werte tolerieren.

GPS-nahe Metriken (`Position`, `Speed`, `Heading`, `CompassDirection`, `Acceleration`, `YawRate`) haben zusätzlich `sampleRate` (`UP_TO_1_SECOND`, `UP_TO_5_SECONDS`) und/oder `gpsModuleTimestamp`.

> **Einheiten** sind in der Spec **nicht angegeben**. Vermutlich metrisch (km, km/h, °C, kPa, %) – Beispiel `TirePressure.value = 35.5` deutet aber auf psi hin. `displaySystemOfMeasure` (`METRIC`/`IMPERIAL`) gibt die Fahrzeuganzeige an. Unbedingt mit echten Daten verifizieren.

### 6.2 EV-/Akku-relevante Metriken ⚡

| Feld | Typ | Bedeutung / Werte |
|---|---|---|
| `xevBatteryStateOfCharge` | StandardDouble | Ladestand HV-Akku (angezeigt, %) |
| `xevBatteryActualStateOfCharge` | StandardDouble | tatsächlicher SoC |
| `xevBatteryRange` | StandardDouble | elektrische Restreichweite |
| `xevBatteryMaximumRange` | StandardDouble | max. Reichweite |
| `xevBatteryCapacity` | StandardDouble | Akkukapazität |
| `xevBatteryEnergyRemaining` | StandardDouble | Restenergie |
| `xevBatteryTemperature` | StandardDouble | Akkutemperatur |
| `xevBatteryVoltage` / `xevBatteryIoCurrent` | StandardDouble | Spannung / Strom HV-Akku |
| `xevBatteryTimeToFullCharge` | StandardDouble | Zeit bis voll |
| `xevBatteryChargerEnergyOutput` / `…CurrentOutput` / `…VoltageOutput` | StandardDouble | Ladegerät-Ausgang |
| `xevEvseBatteryDcVoltageOutput` / `…DcCurrentOutput` | StandardDouble | DC-Ladesäule Ausgang |
| `xevTractionMotorCurrent` / `…Voltage` | StandardDouble | Traktionsmotor |
| `xevPlugChargerStatus` | StandardPlugChargerStatus | Stecker verbunden? |
| `xevBatteryChargeDisplayStatus` | XevBatteryChargeDisplayStatus | `NOT_PLUGGED_IN, FAULT, STATION_NOT_COMPATIBLE, STATION_NOT_DETECTED, IN_PROGRESS, SCHEDULED, PAUSED, STOPPED, COMPLETED, DISCHARGING, NOT_READY` + `xevChargerPowerType` (`AC, DC, WIRELESS`), `xevBatteryType` (`HIGH_VOLTAGE, LOW_VOLTAGE`), `xevChargeStatusOrigin` (`STATION, IN_VEHICLE, REMOTE`), `xevVehicleConditioningType` (`CABIN_CONDITIONING, BATTERY_CONDITIONING`), `xevChargeOriginatorType` (`USER, GRID`) |
| `xevBatteryPerformanceStatus` | XevBatteryPerformanceStatus | `NORMAL, CAUTION, REDUCED, SEVERLY_REDUCED` + `batteryPerformanceCause` (`LOW_TEMPERATURE, HIGH_TEMPERATURE`) |
| `xevChargeStationPowerType` | XevChargeStationPowerType | `AC_BASIC, AC_SMART, DC_FAST, WIRELESS` |
| `xevChargeStationCommunicationStatus` | XevChargeStationCommunicationStatus | `FAULT, NOT_COMPATIBLE, NOT_DETECTED, DIGITAL_COMMUNICATION_ESTABLISHED, DIGITAL_COMMUNICATION_ENDED, STATION_READY, CHARGING, CHARGING_PAUSED` |
| `xevBatteryChargeTransferReason` | object | nicht weiter spezifiziert |
| `tripXevBatteryDistanceAccumulated` | StandardTrip | elektr. gefahrene Strecke (Trip) |
| `tripXevBatteryRangeRegenerated` / `tripXevBatteryChargeRegenerated` | StandardTrip | Rekuperation (Reichweite/Ladung) |
| `evBatteryLevel` | StandardDouble | Akkustand (ältere EV-Variante) |
| `evBatteryRange` | StandardDouble | Reichweite (ältere EV-Variante) |
| `evBatteryTimeToTargetCharge` | StandardDouble | Zeit bis Ziel-SoC |
| `evBatteryTotalCurrent` | StandardDouble | Gesamtstrom |
| `evBatteryTotalVoltage` | EvBatteryTotalVoltage | Gesamtspannung (double) |
| `evBatteryInsulatingResistance` | StandardDouble | Isolationswiderstand |
| `evBatteryChargeStatus` | EvBatteryChargeStatus | `CHARGING_IN_PARKING, CHARGING_IN_DRIVING_STATE, NOT_CHARGING, CHARGING_COMPLETE` |
| `evBatteryChargeDisplayStatus` | EvBatteryChargeDisplayStatus | `NOT_READY, FAULT_UNKNOWN_LOCATION, FAULT_INSIDE_CAR, FAULT_OUTSIDE_CAR, IN_PROGRESS, SCHEDULED, COMPLETE, FAST_CHARGING` |
| `evPlugChargerStatus` | StandardPlugChargerStatus | `DISCONNECTED, CONNECTED` |
| `evBatteryCellStatus` | EvBatteryCellStatus | `value { minTemp, maxTemp: {id, temperature}, minVoltage, maxVoltage: {id, voltage} }` |
| `evBatteryPackageStatus` | EvBatteryPackageStatus | `value { packageCount, packageMin/MaxVoltage, packageMin/MaxTemp: EvBatteryPackage{packageId, current, voltage, temp, cellCount, probeCount} }` |
| `evDcPowerSourceStatus` | EvDcPowerSourceStatus | `NOT_OPERATING, OPERATING` |
| `evOperationMode` | EvOperationMode | `ALL_ELECTRIC, HYBRID_ELECTRIC, FUEL` |
| `hybridVehicleModeStatus` | HybridVehicleModeStatus | `AUTO_CHARGE_DEPLETE, AUTO_CHARGE_SUSTAIN, FORCED_CHARGE_SUSTAIN, FORCED_ELECTRIC, FORCED_NON_ELECTRIC, TEMPORARY_CHARGE_SUSTAIN, PRIORITIZE_CHARGE_GENERATION` |
| `electricMachineState` | ElectricMachineState | `value[]: { id, controllerTemp, current, voltage, speed, temp, torque, status: POWER_CONSUMPTION / POWER_GENERATION / DEACTIVATION_STATE / READINESS_STATE / NO_DATA_EXISTS }` |

**12-V-Batterie:** `batteryStateOfCharge`, `batteryVoltage` (jeweils double + `vehicleBattery`: `PRIMARY_BATTERY, ACCESSORY_BATTERY, BACKUP_BATTERY`), `batteryStatus` (`SUFFICIENT, LOW_VOLTAGE, WARNING, DISCHARGED, UNAVAILABLE`), `batteryLoadStatus` (`ACCESSORY_MODE, NORMAL_OPERATION, LOW_BATTERY, BATTERY_FAULT, ERROR_STATE, OVERLOAD_SHEDDING_IN_PROGRESS` + `batteryLoadFault`), `batteryPowerSource` (`MAIN_BATTERY, BACKUP_BATTERY`).

### 6.3 Position, Bewegung & Fahrt

| Feld | Typ | Inhalt |
|---|---|---|
| `position` | Position | `value { location {lat, lon, alt}, gpsDimension (NONE/DIM_2D/DIM_3D), gpsCoordinateMethod (ACTUAL/INFERRED), gpsClock, pdop, hdop, vdop (int32), gdop (float) }` |
| `speed` | Speed | double |
| `heading` | Heading | `value { heading, uncertainty (float), detectionType: HEADING_RAW_GNSS / HEADING_MAGNETIC_SENSOR / HEADING_MULTI_SENSOR_FUSION / HEADING_BY_MAP }` |
| `compassDirection` | CompassDirection | `NORTH … NORTHWEST` |
| `acceleration` | Acceleration | `value {x, y, z, sensorType}`, `duration` |
| `yawRate` | YawRate | double |
| `odometer` | StandardDouble | Kilometerstand |
| `tripDistanceAccumulated`, `tripMaximumSpeed`, `tripFuelConsumed`, `tripFuelConsumedIdle`, `tripFuelEconomy` | StandardTrip | Trip-Werte |
| `harshCorneringMaximumAcceleration`, `harshMaximumLongitudinalAcceleration` | StandardDouble | Fahrverhalten |
| `wheelRotationSpeed[]` | WheelRotationSpeed | double + `wheelPosition` |
| `gearLeverPosition`, `transmissionGearPosition` | StandardGearPosition | |
| `ignitionStatus` | IgnitionStatus | `OFF, ACCESSORY, ON` |
| `engineStatus` | EngineStatus | `OFF, ON, AUTO_STOP` + `engineType` (`DIESEL, GASOLINE, ELECTRIC, HYBRID`) |
| `engineSpeed` | EngineSpeed | int64 (U/min) |
| `parkingBrakeStatus` | ParkingBrakeStatus | `OFF/ON` + `parkingBrakeType` (`ELECTRIC, MECHANICAL`) |
| `remoteStartCountdownTimer` | StandardDouble | |
| `remoteStartDeviceStatus` | RemoteStartDeviceStatus | `ACKNOWLEDGE, STARTING, RUNNING, SHUTDOWN` |
| `vehicleLifeCycleMode` | VehicleLifeCycleMode | `NORMAL, TRANSPORT, FACTORY` |

### 6.4 Karosserie, Komfort & Sicherheit

| Feld | Typ | Werte |
|---|---|---|
| `doorLockStatus[]` | DoorLockStatus | `LOCKED, UNLOCKED, DOUBLE_LOCKED, NO_LOCKABLE_DEVICE` + `vehicleDoor`, `vehicleSide`, `vehicleOccupantRole`, `determinationMethod` |
| `doorStatus[]` | DoorStatus | `CLOSED, AJAR` |
| `doorPresenceStatus[]` | DoorPresenceStatus | `PRESENT, NOT_PRESENT` |
| `hoodStatus` | HoodStatus | `CLOSED, AJAR` |
| `windowStatus[]` | WindowStatus | `value: Range { doubleRange{lowerBound, upperBound}, intRange{…} }` + `vehicleWindow` |
| `alarmStatus` | AlarmStatus | `DISARMED, PREARMED, ARMED, ACTIVATED` |
| `panicAlarmStatus` | StandardWarningStatus | |
| `seatBeltStatus[]` / `seatOccupancyStatus[]` | | `BUCKLED/UNBUCKLED`, `OCCUPIED/UNOCCUPIED` + `positionRow`, `positionSeat` |
| `climateControl[]` | ClimateControl | `value { airFlow {fanSpeed, airVentDistributions[], airCirculationStatus}, cabinTemperatureSetting {measuredTemperature, relativeTemperature}, airConditionerStatus, systemControlMode }` |
| `ambientTemp`, `outsideTemperature` | | Temperaturen |
| `tirePressure[]` | TirePressure | double + `vehicleWheel`, `wheelPlacardFront`, `wheelPlacardRear` (Soll-Druck) |
| `tirePressureStatus[]` | TirePressureStatus | `NORMAL, LOW, ALERT, UNSUPPORTED` |
| `tirePressureSystemStatus[]` | TirePressureSystemStatus | `NORMAL_OPERATION, NOT_TRAINED, SYSTEM_FAULT, SENSOR_FAULT, LOW_TIRE_PRESSURE, UNSUPPORTED` |
| `impactStatus` | ImpactStatus | `NORMAL, IMPACT, RESTRAINTS_ENGAGED, AIRBAG_TRIGGERED` |
| `oilLifeRemaining` | StandardDouble | |
| `displaySystemOfMeasure` | DisplaySystemOfMeasure | `METRIC, IMPERIAL` |
| `antennaSource` | AntennaSource | `PRIMARY_ANTENNA, BACKUP_ANTENNA` + `antennaType` (`CELLULAR, GPS`) |
| `vehicleAudioSource`, `inVehicleAudioSystemVolumeLevel`, `bluetoothPhoneSystemStatus` | | Infotainment |

**Fahrerassistenz** (meist `StandardWarningStatus`/`StandardStatusResponse`): `absStatus`, `electronicStabilityControlStatus`, `electronicStabilityControlSystemStatus`, `tractionControlStatus` (+ `tractionControlBrake`, `tractionControlPowertrain`), `blindSpotWarningSystemStatus` (+ `monitorCoverage` REGULAR/TRAILER), `laneKeepingAssistSystemStatus`, `forwardCollisionWarningSystemStatus`, `forwardCollisionAudioWarningStatus`, `collisionMitigationBrakeStatus`, `lowSpeedCollisionMitigationStatus/-SystemStatus`, `rearCrossWarningSystemStatus`, `driverAlertnessWarningStatus`, `driverAssistSystemStatus`, `handsOffWheelWarningStatus`, `trailerSwayStatus`, `trailerLightCheckStatus`, `stopStartModeStatus`, `wheelTorqueStatus`, `brakeLightStatus`, `brakePedalStatus`, `brakeTorque`, `acceleratorPedalPosition`, `acceleratorPedalStatus`.

**Verbrenner/Diesel** (für EVs irrelevant): `fuelLevel`, `fuelRange`, `fuelVolume`, `fuelEconomy`, `engineCoolantTemp`, `engineOilTemp`, `totalEngineTime(Idle)`, `engineAutomaticShutdownStatus`, `engineExhaustOverheat`, `waterInFuelStatus`, `powerTakeOffStatus`, `dieselExhaustFluid*`, `dieselExhaustFilter*`, `dieselParticulateFilterSootLevel`, `torqueAtTransmission`, `transmissionOilTemperature`.

**Upfitter (Nutzfahrzeuge):** `upfitterDigitalLowOutputStatus[]`, `upfitterDigitalHighOutputStatus[]`, `upfitterDigitalInputStatus[]`, `upfitterAnalogInputVoltages[]`, `upfitterPwm*DutyCycleTarget`.

**Sonstiges:** `customMetrics` (object), `anonymityStatus`, `indicatorLight` (object).

### 6.5 Fehlercodes & Warnleuchten

- `diagnosticTroubleCodes[]`: `value { system: BODY/CHASSIS/POWERTRAIN/NETWORK, sae: bool, intFault, subfaultFailureInt: int32, rawValue, oemData: [{key, value}], oemValues }`
- `indicators` (`IndicatorsResponse`): je Warnleuchte ein `Indicator { updateTime, value: boolean, diagnosticTroubleCodes[], additionalInfo }`. EV-relevant u. a.:
  `chargeSystemFault`, `evBattCellMaxVoltWarning`, `evBattCellMinVoltWarning`, `evBattChargeEnergyStorageWarning`, `evBattHighLevelWarning`, `evBattHighTempWarning`, `evBattInsulationResistWarning`, `evBattJumpLevelWarning`, `evBattLowLevelWarning`, `evBattMaxVoltVehEnergyWarning`, `evBattMinVoltVehEnergyWarning`, `evBattOverChargeWarning`, `evBattPoorCellWarning`, `evBattTempDiffWarning`, `hvInterlockingStatusWarning`, `hevHazard`, `motorControllerTempWarning`, `tractionMotorTempWarning`, `dcTempWarning`, `dcWarningStatus`.
  Weitere: `adaptiveCruiseControl`, `airFilterMinder`, `antiTheft`, `antilockBrake`, `brakeWarning`, `tirePressureMonitorSystemWarning`, `lowWasherFluid`, `malfunctionIndicator`, `powertrainMalfunction`, `serviceSteering`, `lightingSystemFailure`, `laneKeepingAid`, … (insg. 66 Indikatoren).

### 6.6 Konfiguration (`metrics.configurations` → `ConfigurationResponse`)

| Feld | Typ | Inhalt |
|---|---|---|
| `xevBatteryTargetStateOfChargeSetting` | StandardSetting | Ziel-Ladestand |
| `xevBatteryTargetRangeSetting` | StandardSetting | Ziel-Reichweite |
| `xevDepartureSchedulesSetting` | XevDepartureSchedulesSetting | `value: { departureSchedules[], departureScheduleFeatureStatus (ON/OFF), departureLocations[ {locationId, departureSchedules[]} ] }` |
| `remoteStartRunDurationSetting` | StandardSetting | |
| `forwardCollisionWarningSensitivitySetting` | | `LOW, MEDIUM, HIGH` |
| `vehicleControlPolicy` | VehicleControlPolicy | `policyScope` (FACTORY_RESET/SELECTIVE_RESET), `policyPermission` (ALLOWED/PROHIBITED/REMOTE_ACCESS_ONLY), `remainingDurationSeconds` |
| `automaticSoftwareUpdateOptInSetting`, `automaticSoftwareUpdateNotificationOptInSetting` | StandardSoftwareUpdate | `ON/OFF` |
| `automaticSoftwareUpdateScheduleSetting` | | `value: Schedule` |

`XevDepartureSchedule`: `scheduleId`, `scheduleStatus` (ON/OFF), `schedule: Schedule`, `desiredCabinTemperatureSetting`, `oemData`.

`Schedule`: `scheduleType` (`NONE, ONE_TIME, IMMEDIATE, RECURRING`), `oneTimeSchedule {dateAndTime, dayOfWeekAndTime}`, `dailySchedule` (`"01:00:00"`), `weeklySchedule {dayOfWeek: MONDAY…SUNDAY, timeOfDay: "01:00"}`, `multipleWeeklySchedules`, `timeZone` (`UTC, LOCAL_TIME`), `scheduleExecutor` (`DEVICE, CLOUD`).

`ErrorConfigurationValue`: `errorName` (`FAULT, INVALID, OUT_OF_RANGE, FAILURE`), `message`, `errorSource` (`DEVICE`).

### 6.7 Geofences

- `geofenceState`: `{ updateTime, geofences: [{ name, id (uuid), tags }] }`
- `geofenceEvents[]`: `{ updateTime, name, id, metric: { position: { value: PositionValue } }, tags, value: { type, triggerType } }`

---

## 7. Beispiel-Requests

```bash
BASE=https://api.vehicle.ford.com/fcon-query
TOKEN=...   # Access-Token aus dem OAuth Authorization Code Flow

curl -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" $BASE/v1/garage
curl -H "Authorization: Bearer $TOKEN" $BASE/v1/telemetry
curl -H "Authorization: Bearer $TOKEN" $BASE/v1/electric/charge-schedules
curl -H "Authorization: Bearer $TOKEN" $BASE/v1/electric/departure-times
curl -H "Authorization: Bearer $TOKEN" $BASE/v1/wallbox
curl -H "Authorization: Bearer $TOKEN" -H "chargingStationId: <uuid>" \
     "$BASE/v1/fccs?startDate=<start>&endDate=<end>"
```

Minimalbeispiel: Ladestand & Reichweite aus `/v1/telemetry` lesen (Python):

```python
import requests

r = requests.get(
    "https://api.vehicle.ford.com/fcon-query/v1/telemetry",
    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    timeout=30,
)
r.raise_for_status()
m = r.json()["metrics"]

soc   = (m.get("xevBatteryStateOfCharge") or {}).get("value")
rng   = (m.get("xevBatteryRange") or {}).get("value")
plug  = (m.get("xevPlugChargerStatus") or {}).get("value")
state = (m.get("xevBatteryChargeDisplayStatus") or {}).get("value")
print(f"SoC={soc}%  Reichweite={rng}  Stecker={plug}  Laden={state}")
```

---

## 8. Offene Punkte / zu verifizieren

- [ ] Echte OAuth-Endpoints (authorize/token) und tatsächliche Scope-Namen (Spec nennt nur `read`/`write`).
- [ ] Wie wird bei mehreren Fahrzeugen eines Accounts das Zielfahrzeug gewählt (Header? Consent pro Fahrzeug?).
- [ ] Einheiten der Messwerte (km vs. mi, kPa vs. psi, °C vs. °F).
- [ ] Datumsformat für `startDate`/`endDate` bei `/v1/fccs`.
- [ ] Format von `vehicleImage` (Base64/URL).
- [ ] Rate-Limits (nur 429 dokumentiert) und Aktualisierungsfrequenz der Telemetrie.
- [ ] Spec enthält nur lesende Endpoints – keine Fahrzeugbefehle (Laden starten, Entriegeln …).
