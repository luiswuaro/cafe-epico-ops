type RecordValue = Record<string, unknown>;

export type HiBeanCurvePoint = {
  tS: number;
  btC?: number;
  etC?: number;
  rorCMin?: number;
};

export type HiBeanEvent = {
  tS: number;
  btC?: number;
  sourceCode: number;
};

export type HiBeanImport = {
  points: HiBeanCurvePoint[];
  events: {
    charge?: HiBeanEvent;
    turningPoint?: HiBeanEvent;
    yellowing?: HiBeanEvent;
    firstCrack?: HiBeanEvent;
    drop?: HiBeanEvent;
  };
  metadata: {
    provider: "HIBEAN";
    externalRoastId?: string;
    localRoastId?: string;
    roastName?: string;
    roastedAt?: string;
    durationS?: number;
    temperatureUnit?: string;
    greenWeightG?: number;
    roastedWeightG?: number;
    bean?: {
      cloudId?: string;
      localId?: string;
      name?: string;
      origin?: string;
      regionCode?: string;
      harvestYear?: number;
      altitudeRange?: string;
      density?: number;
      moistureContent?: number;
      remainingInventoryG?: number;
      inventoryEnabled?: boolean;
      lowInventoryReminderG?: number;
      varietyCode?: string;
      processingMethodCode?: string;
    };
    environment?: {
      temperatureC?: number;
      humidityPct?: number;
      pressureRaw?: number;
    };
    device?: {
      cloudId?: string;
      name?: string;
      manufacturer?: string;
      model?: string;
    };
    phaseList?: unknown[];
    aiTelemetry?: RecordValue;
  };
};

function objectRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function str(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function weightG(value: unknown) {
  const row = objectRecord(value);
  if (!row) return undefined;
  const amount = num(row.value);
  const unit = str(row.unit)?.toLowerCase();
  if (amount == null) return undefined;
  if (!unit || unit === "g") return amount;
  if (unit === "kg") return amount * 1000;
  return undefined;
}

function eventByCode(
  rows: unknown[],
  code: number,
): HiBeanEvent | undefined {
  const event = rows
    .map(objectRecord)
    .find((row) => row && num(row.event) === code);
  if (!event) return undefined;
  const tS = num(event.time);
  if (tS == null) return undefined;
  const btC = num(event.temperature);
  return {
    tS,
    sourceCode: code,
    ...(btC != null ? { btC } : {}),
  };
}

export function parseHiBeanJsonRoot(root: RecordValue): HiBeanImport | null {
  const dataList = Array.isArray(root.dataList) ? root.dataList : null;
  const roastContext = objectRecord(root.roastContext);
  const deviceInfo = objectRecord(root.deviceInfo);

  if (!dataList || !roastContext || !deviceInfo) return null;

  const manufacturer = str(deviceInfo.manufacturer)?.toLowerCase();
  const deviceModel = str(deviceInfo.model)?.toLowerCase();
  const looksHiBean =
    manufacturer === "skywalker" ||
    deviceModel?.includes("skywalker") ||
    "eventList" in root ||
    "phaseList" in root;

  if (!looksHiBean) return null;

  const capability = objectRecord(deviceInfo.capability);
  const hasEt = capability?.hasEt === true;

  const points: HiBeanCurvePoint[] = dataList.flatMap((value) => {
    const row = objectRecord(value);
    if (!row) return [];
    const tS = num(row.duration);
    if (tS == null || tS < 0) return [];

    const btC = num(row.bt);
    const etRaw = num(row.et);
    const rorCMin = num(row.ror);

    return [{
      tS,
      ...(btC != null ? { btC } : {}),
      ...(hasEt && etRaw != null ? { etC: etRaw } : {}),
      ...(rorCMin != null ? { rorCMin } : {}),
    }];
  });

  if (points.length === 0) return null;

  const eventList = Array.isArray(root.eventList) ? root.eventList : [];
  const bean = objectRecord(roastContext.bean);
  const envTemp = objectRecord(roastContext.envTemp);
  const greenWeightG = weightG(roastContext.greenBeanWeight);
  const roastedWeightG = weightG(roastContext.roastedBeanWeight);

  const remainingInventoryG =
    bean?.remainingInventoryQty == null
      ? undefined
      : num(bean.remainingInventoryQty);

  return {
    points,
    events: {
      charge: eventByCode(eventList, 1),
      turningPoint: eventByCode(eventList, 2),
      yellowing: eventByCode(eventList, 3),
      firstCrack: eventByCode(eventList, 4),
      drop: eventByCode(eventList, 8),
    },
    metadata: {
      provider: "HIBEAN",
      externalRoastId: str(root.cloudId),
      localRoastId: str(root.id),
      roastName: str(root.name),
      roastedAt: str(root.dateTime),
      durationS: num(root.duration),
      temperatureUnit: str(root.temperatureUnit),
      greenWeightG,
      roastedWeightG,
      bean: bean
        ? {
            cloudId: str(bean.cloudId),
            localId: str(bean.localId),
            name: str(bean.name),
            origin: str(bean.origin),
            regionCode: str(bean.regionCode),
            harvestYear: num(bean.harvestYear),
            altitudeRange: str(bean.altitudeRange),
            density: num(bean.density),
            moistureContent: num(bean.moistureContent),
            remainingInventoryG,
            inventoryEnabled:
              typeof bean.inventoryEnabled === "boolean"
                ? bean.inventoryEnabled
                : undefined,
            lowInventoryReminderG: num(
              bean.lowInventoryReminderThresholdQty,
            ),
            varietyCode: str(bean.variety),
            processingMethodCode: str(bean.processingMethod),
          }
        : undefined,
      environment: {
        temperatureC:
          str(envTemp?.unit)?.toUpperCase() === "C"
            ? num(envTemp?.value)
            : undefined,
        humidityPct: num(roastContext.envHumidity),
        pressureRaw: num(roastContext.pressure),
      },
      device: {
        cloudId: str(deviceInfo.deviceCloudId),
        name: str(deviceInfo.name),
        manufacturer: str(deviceInfo.manufacturer),
        model: str(deviceInfo.model),
      },
      phaseList: Array.isArray(root.phaseList)
        ? root.phaseList
        : undefined,
      aiTelemetry: objectRecord(root.aiTelemetry) ?? undefined,
    },
  };
}
