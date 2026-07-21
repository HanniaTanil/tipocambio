const SERIES_ID = "SF43718";
const SERIES_NAME = "Tipo de cambio FIX";
const SERIES_UNIT = "Pesos mexicanos por dólar estadounidense";
const API_BASE_URL = "https://www.banxico.org.mx/SieAPIRest/service/v1/series";
const DISPLAY_RECORDS = 30;
const LOOKBACK_WINDOWS = [120, 180, 365, 730];

class ApiError extends Error {
  constructor(type, message, statusCode) {
    super(message);
    this.name = "ApiError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

class RuntimeConfigService {
  async ensureConfigured() {
    let response;

    try {
      response = await fetch("/api/config", {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });
    } catch {
      throw new ApiError(
        "CONFIG_ERROR",
        `No fue posible leer la configuracion de entorno. ${getEnvironmentSetupHint()}`,
        0
      );
    }

    if (!response.ok) {
      throw new ApiError(
        "CONFIG_ERROR",
        `No fue posible leer la configuracion de entorno. ${getEnvironmentSetupHint()}`,
        response.status
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw new ApiError("CONFIG_ERROR", "Respuesta invalida del endpoint /api/config.", response.status);
    }

    if (!payload?.hasToken) {
      throw new ApiError(
        "TOKEN_NOT_CONFIGURED",
        `Token de Banxico no configurado. ${getTokenSetupHint()}`,
        0
      );
    }
  }
}

class BanxicoApiClient {
  async getLatest() {
    const endpoint = `${API_BASE_URL}/${SERIES_ID}/datos/oportuno`;
    return this.fetchSeries(endpoint);
  }

  async getRange(startDate, endDate) {
    const endpoint = `${API_BASE_URL}/${SERIES_ID}/datos/${startDate}/${endDate}`;
    return this.fetchSeries(endpoint);
  }

  async fetchSeries(endpoint) {
    let response;

    try {
      response = await this.fetchThroughProxy(endpoint);
    } catch {
      throw new ApiError(
        "NETWORK_ERROR",
        `No fue posible conectar con el backend de proxy. ${getEnvironmentSetupHint()}`,
        0
      );
    }

    if (!response.ok) {
      const parsedError = await this.tryParseError(response);

      if (/token/i.test(parsedError)) {
        throw new ApiError("TOKEN_INVALID", "Token inválido o vencido.", response.status);
      }

      if (response.status === 401 || response.status === 403) {
        throw new ApiError("TOKEN_INVALID", "Token inválido o vencido.", response.status);
      }

      throw new ApiError(
        "HTTP_ERROR",
        parsedError || `Error HTTP al consultar Banxico: ${response.status}`,
        response.status
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw new ApiError("PARSE_ERROR", "No fue posible interpretar la respuesta JSON.", response.status);
    }

    const maybeError = this.extractApiError(payload);
    if (maybeError) {
      throw maybeError;
    }

    return payload;
  }

  async fetchThroughProxy(endpoint) {
    const proxyUrl = `/api/banxico?endpoint=${encodeURIComponent(endpoint)}`;

    return fetch(proxyUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  }

  async tryParseError(response) {
    try {
      const payload = await response.json();
      return payload?.bmx?.mensaje || payload?.bmx?.message || payload?.error || "";
    } catch {
      return "";
    }
  }

  extractApiError(payload) {
    const bmxNode = payload?.bmx;
    const message = bmxNode?.mensaje || bmxNode?.message;

    if (message && /token/i.test(message)) {
      return new ApiError("TOKEN_INVALID", "Token inválido o vencido.", 401);
    }

    if (message) {
      return new ApiError("API_ERROR", message, 400);
    }

    return null;
  }
}

class ExchangeRateMapper {
  static mapSeriesResponse(payload) {
    const rawRecords = payload?.bmx?.series?.[0]?.datos;

    if (!Array.isArray(rawRecords)) {
      return [];
    }

    const mapped = rawRecords
      .map((record) => {
        const value = Number.parseFloat(String(record?.dato ?? "").replace(/,/g, ""));
        const date = parseBanxicoDate(record?.fecha);

        if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
          return null;
        }

        return {
          date,
          value,
          dateLabel: formatDateForDisplay(date)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);

    return mapped;
  }
}

class StatisticsService {
  static calculate(records) {
    if (!records.length) {
      return null;
    }

    const values = records.map((record) => Number(record.value));
    const lastValue = values[values.length - 1];
    const previousValue = values.length > 1 ? values[values.length - 2] : null;

    const variationPercent =
      previousValue && previousValue !== 0
        ? ((lastValue - previousValue) / previousValue) * 100
        : null;

    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const averageValue = values.reduce((sum, value) => sum + value, 0) / values.length;

    return {
      lastValue,
      previousValue,
      variationPercent,
      maxValue,
      minValue,
      averageValue
    };
  }
}

class UIRenderer {
  constructor(elements) {
    this.elements = elements;
    this.chartInstance = null;
  }

  setButtonDisabled(isDisabled) {
    this.elements.refreshButton.disabled = isDisabled;
  }

  showStatus(kind, message) {
    const status = this.elements.status;
    status.className = `status show ${kind}`;
    status.textContent = message;
  }

  hideStatus() {
    this.elements.status.className = "status";
    this.elements.status.textContent = "";
  }

  showContent() {
    this.elements.content.classList.remove("hidden");
  }

  hideContent() {
    this.elements.content.classList.add("hidden");
  }

  renderIndicator(record) {
    this.elements.indicatorName.textContent = SERIES_NAME;
    this.elements.indicatorValue.textContent = `$${formatNumber(record.value, 4)} MXN por USD`;
    this.elements.indicatorDate.textContent = `Dato correspondiente al ${record.dateLabel}`;
  }

  renderMetrics(metrics) {
    this.elements.metricLatest.textContent = formatCurrency(metrics.lastValue);

    const variationElement = this.elements.metricVariation;
    variationElement.textContent =
      metrics.variationPercent === null
        ? "N/D"
        : `${formatNumber(metrics.variationPercent, 4)} %`;
    variationElement.classList.remove("positive", "negative");

    if (typeof metrics.variationPercent === "number") {
      if (metrics.variationPercent > 0) {
        variationElement.classList.add("positive");
      } else if (metrics.variationPercent < 0) {
        variationElement.classList.add("negative");
      }
    }

    this.elements.metricMax.textContent = formatCurrency(metrics.maxValue);
    this.elements.metricMin.textContent = formatCurrency(metrics.minValue);
    this.elements.metricAverage.textContent = formatCurrency(metrics.averageValue);
  }

  renderChart(records) {
    const labels = records.map((record) => record.dateLabel);
    const values = records.map((record) => record.value);

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    this.chartInstance = new Chart(this.elements.chartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "FIX USD/MXN",
            data: values,
            borderColor: "#0f766e",
            borderWidth: 2,
            backgroundColor: "rgba(15, 118, 110, 0.18)",
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: `Histórico de ${SERIES_NAME} (${SERIES_UNIT})`
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: $${formatNumber(context.parsed.y, 4)} MXN`
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Fecha"
            }
          },
          y: {
            title: {
              display: true,
              text: "MXN por USD"
            }
          }
        }
      }
    });
  }
}

class ExchangeRateController {
  constructor(apiClient, renderer) {
    this.apiClient = apiClient;
    this.renderer = renderer;
  }

  async loadData() {
    this.renderer.setButtonDisabled(true);
    this.renderer.hideContent();
    this.renderer.showStatus("loading", "Cargando información del tipo de cambio...");

    try {
      const today = new Date();
      const [latestPayload, historicalRecords] = await Promise.all([
        this.apiClient.getLatest(),
        this.fetchHistoricalRecords(today)
      ]);

      const latestRecords = ExchangeRateMapper.mapSeriesResponse(latestPayload);

      if (!historicalRecords.length) {
        this.renderer.hideContent();
        this.renderer.showStatus("empty", "No se encontraron datos para el periodo consultado.");
        return;
      }

      const recentRecords = historicalRecords.slice(-DISPLAY_RECORDS);
      const currentRecord = latestRecords[latestRecords.length - 1] || recentRecords[recentRecords.length - 1];
      const metrics = StatisticsService.calculate(recentRecords);

      if (!currentRecord || !metrics) {
        this.renderer.hideContent();
        this.renderer.showStatus("empty", "No se encontraron datos válidos para mostrar.");
        return;
      }

      this.renderer.renderIndicator(currentRecord);
      this.renderer.renderMetrics(metrics);
      this.renderer.renderChart(recentRecords);
      this.renderer.showContent();
      this.renderer.showStatus("success", "Información obtenida correctamente.");
    } catch (error) {
      this.handleError(error);
    } finally {
      this.renderer.setButtonDisabled(false);
    }
  }

  async fetchHistoricalRecords(today) {
    const endDate = formatDateISO(today);
    let fallbackRecords = [];

    for (const days of LOOKBACK_WINDOWS) {
      const startDate = formatDateISO(addDays(today, -days));
      const payload = await this.apiClient.getRange(startDate, endDate);
      const records = ExchangeRateMapper.mapSeriesResponse(payload);

      if (!records.length) {
        continue;
      }

      fallbackRecords = records;

      if (records.length >= DISPLAY_RECORDS) {
        return records;
      }
    }

    return fallbackRecords;
  }

  handleError(error) {
    this.renderer.hideContent();

    if (error instanceof ApiError) {
      if (error.type === "TOKEN_INVALID") {
        this.renderer.showStatus("error", "Token inválido o vencido. Verifica e intenta nuevamente.");
        return;
      }

      if (error.type === "TOKEN_NOT_CONFIGURED") {
        this.renderer.showStatus("error", error.message);
        return;
      }

      if (error.type === "CONFIG_ERROR") {
        this.renderer.showStatus("error", error.message);
        return;
      }

      if (error.type === "NETWORK_ERROR") {
        this.renderer.showStatus("error", error.message);
        return;
      }

      this.renderer.showStatus("error", error.message);
      return;
    }

    this.renderer.showStatus("error", "Error inesperado al consumir la API. Intenta nuevamente.");
  }
}

function parseBanxicoDate(dateString) {
  if (typeof dateString !== "string") {
    return new Date("invalid");
  }

  const [day, month, year] = dateString.split("/").map(Number);

  if (!day || !month || !year) {
    return new Date("invalid");
  }

  return new Date(year, month - 1, day);
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateForDisplay(date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function formatCurrency(value) {
  return `$${formatNumber(value, 4)} MXN`;
}

function isNetlifyHost() {
  return window.location.hostname.includes("netlify.app");
}

function getEnvironmentSetupHint() {
  if (isNetlifyHost()) {
    return "En Netlify, verifica netlify/functions, netlify.toml y vuelve a desplegar.";
  }

  return "En local, ejecuta: python dev_server.py";
}

function getTokenSetupHint() {
  if (isNetlifyHost()) {
    return "Configura BANXICO_TOKEN en Site settings > Environment variables y redeploy.";
  }

  return "Define token=... o BANXICO_TOKEN=... en .env";
}

async function bootstrap() {
  const elements = {
    refreshButton: document.getElementById("refreshButton"),
    status: document.getElementById("status"),
    content: document.getElementById("content"),
    indicatorName: document.getElementById("indicatorName"),
    indicatorValue: document.getElementById("indicatorValue"),
    indicatorDate: document.getElementById("indicatorDate"),
    metricLatest: document.getElementById("metricLatest"),
    metricVariation: document.getElementById("metricVariation"),
    metricMax: document.getElementById("metricMax"),
    metricMin: document.getElementById("metricMin"),
    metricAverage: document.getElementById("metricAverage"),
    chartCanvas: document.getElementById("exchangeRateChart")
  };

  const configService = new RuntimeConfigService();
  const apiClient = new BanxicoApiClient();
  const renderer = new UIRenderer(elements);
  const controller = new ExchangeRateController(apiClient, renderer);

  elements.refreshButton.addEventListener("click", () => controller.loadData());

  try {
    await configService.ensureConfigured();
  } catch (error) {
    renderer.hideContent();
    renderer.setButtonDisabled(true);
    renderer.showStatus("error", error.message || "Error de configuracion.");
    return;
  }

  controller.loadData();
}

document.addEventListener("DOMContentLoaded", bootstrap);
