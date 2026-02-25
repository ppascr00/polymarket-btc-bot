# 📈 Polymarket BTC 5-Minute Up/Down Trading Bot

Bot de trading automatizado que opera el mercado "Bitcoin arriba o abajo" de Polymarket en ventanas de 5 minutos. Analiza datos de BTC en tiempo real para decidir si comprar YES (sube) o NO (baja).

> ⚠️ **DISCLAIMER**: Este bot **NO garantiza rentabilidad**. El trading de mercados de predicción conlleva riesgo de pérdida total. Las configuraciones por defecto son conservadoras, pero el usuario es responsable de cualquier pérdida. Código proporcionado con fines educativos y experimentales.

## 🏗 Arquitectura

```
Exchange (Binance WS) → Aggregator → Feature Engine → Strategy → Risk Manager → Executor → Polymarket
                                                                                              ↓
                                              Dashboard ← SQLite DB ← Trade Logger ←─────────┘
```

**Stack**: TypeScript/Node.js + Next.js + SQLite + Docker

## 📁 Estructura

```
├── src/
│   ├── config/          # Configuración desde .env
│   ├── types/           # Interfaces TypeScript
│   ├── db/              # SQLite schema + repository
│   ├── data/            # Exchange WS, OHLCV aggregator, features
│   ├── polymarket/      # Cliente CLOB (real + mock)
│   ├── strategy/        # 2 estrategias + registry
│   ├── risk/            # Gestión de riesgo
│   ├── execution/       # Engine + scheduler 5m
│   ├── backtest/        # Motor offline + walk-forward
│   ├── utils/           # Logger, time, math
│   └── index.ts         # Entry point
├── dashboard/           # Next.js dashboard
├── tests/               # Vitest test suite
├── fixtures/            # Datos de ejemplo
└── docker-compose.yml
```

## 🚀 Inicio Rápido

### Requisitos
- Node.js >= 20
- npm

### Instalación

```powershell
cd polymarket-btc-bot

# Instalar dependencias del bot
npm install

# Instalar dependencias del dashboard
cd dashboard && npm install && cd ..

# Copiar configuración
copy .env.example .env
```

### Modo PAPER (Simulación) — Recomendado para empezar

```powershell
# Editar .env:
# TRADING_MODE=PAPER  (ya es el default)
# No necesitas credenciales de Polymarket

# Ejecutar bot
npm run dev

# En otra terminal, ejecutar dashboard
npm run dashboard
# Abrir http://localhost:3000
```

### Modo LIVE (Trading Real)

> ⚠️ **PELIGRO**: Dinero real en juego. Asegúrate de entender los riesgos.

```powershell
# Editar .env:
# TRADING_MODE=LIVE
# POLYMARKET_PRIVATE_KEY=<tu_clave_privada>
# POLYMARKET_API_KEY=<tu_api_key>
# POLYMARKET_API_SECRET=<tu_secret>
# POLYMARKET_API_PASSPHRASE=<tu_passphrase>
# MAX_STAKE_PER_TRADE=2  (mantener bajo al inicio)

npm run dev
```

### Backtesting

```powershell
# Backtest con datos de los últimos 7 días
npm run backtest

# Especificar estrategia y días
npx tsx src/backtest/run.ts ema-crossover 14
```

Los resultados se exportan a `backtest-results/` en CSV y JSON.

## 🧠 Estrategias

### 1. Probabilistic (default)
- **Modelo**: Regresión logística entrenada en datos históricos
- **Features**: retornos 1m/5m, EMA(3), EMA(8), RSI(14), volatilidad, rango, volumen
- **Decisión**: Compara P(UP) estimada vs probabilidad implícita del mercado Polymarket
- **Opera solo si**: edge esperado > threshold (default 2%)

### 2. EMA Crossover (fallback)
- **Señal**: EMA(3) cruza por encima/debajo de EMA(8)
- **Filtros**: RSI (no operar en extremos), volatilidad (banda), expansión de rango
- **NO opera si**: señales contradictorias entre indicadores

### Añadir nueva estrategia
1. Crear archivo en `src/strategy/`
2. Implementar interface `Strategy` (método `compute()`)
3. Registrar en `src/strategy/registry.ts`

## 🛡 Gestión de Riesgo

| Parámetro | Default | Descripción |
|---|---|---|
| `MAX_STAKE_PER_TRADE` | $2 | Máximo por operación |
| `MAX_DAILY_LOSS` | $10 | Pérdida máxima diaria → auto-stop |
| `MAX_OPEN_POSITIONS` | 1 | Solo 1 posición simultánea |
| `COOLDOWN_AFTER_LOSSES` | 3 | Pausa tras 3 pérdidas seguidas |
| `MIN_EDGE_THRESHOLD` | 2% | Edge mínimo para operar |
| `SLIPPAGE_TOLERANCE` | 3% | Tolerancia de slippage |
| `SPREAD_MAX_TOLERANCE` | 10% | No operar si spread > 10% |

**Reglas inquebrantables:**
- ❌ Sin martingala ni promediar a la baja
- ❌ Máximo 1 operación por ventana de 5 min
- ❌ No opera si datos están stale (> 10s)
- ❌ Auto-pausa tras 3 errores consecutivos

## 🎯 Selección de Mercado

El bot busca automáticamente el mercado BTC 5m Up/Down por slug configurable:

```env
POLYMARKET_MARKET_SLUG=bitcoin-5min-up-or-down
```

Si el mercado no existe o no está activo, el bot **no opera** y espera.

## 📊 Dashboard

Panel web en `http://localhost:3000` con:
- **Modo actual** (PAPER/LIVE) con indicador visual
- **P&L** diario y total
- **Win rate** y racha de pérdidas
- **Último señal** con explicación detallada de features
- **Tabla de trades** recientes
- **Salud del sistema** (WebSocket, DB, latencia, uptime)
- **Curva de equity** visual

## 🧪 Tests

```powershell
# Ejecutar toda la suite
npm test

# Modo watch
npm run test:watch

# Type check
npm run lint
```

## 🐳 Docker

```powershell
# Construir y ejecutar
docker-compose up -d

# Ver logs
docker-compose logs -f bot

# Detener
docker-compose down
```

## ⚙️ Configuración Completa

Ver [`.env.example`](.env.example) para todas las variables disponibles.

## 🔐 Seguridad

- ✅ Secrets en `.env` (nunca en código)
- ✅ `.env` en `.gitignore`
- ✅ Polymarket credentials solo requeridas en modo LIVE
- ✅ Dashboard de solo lectura (acceso a DB read-only)
- ✅ No expone claves en frontend

## ⚠️ Limitaciones y Riesgos

1. **No garantiza rentabilidad** — Los mercados de predicción a 5 minutos son extremadamente competitivos
2. **Latencia** — La ventaja puede eliminarse por latencia de red
3. **Modelo simple** — La regresión logística tiene limitaciones vs modelos más sofisticados
4. **Liquidez** — Los orderbooks de mercados 5m pueden tener poca liquidez
5. **Costes** — Las comisiones de Polymarket (~2%) reducen significativamente el edge
6. **API changes** — Polymarket puede cambiar su API sin previo aviso
7. **Datos de entrenamiento** — Rendimiento pasado no predice resultados futuros

## 📄 Notas sobre Polymarket API

El cliente real (`src/polymarket/client.ts`) usa endpoints públicos documentados para:
- ✅ Buscar mercados
- ✅ Obtener orderbooks
- ✅ Obtener precios mid

Para colocar órdenes reales se necesita:
1. Instalar `@polymarket/clob-client`: `npm install @polymarket/clob-client`
2. Configurar signing EIP-712 (ver TODOs en el código)
3. Credenciales API L2 (HMAC-SHA256)

El modo PAPER usa un cliente mock que simula todos los endpoints sin conexión real.

## 📜 Licencia

Uso personal. No redistribuir sin consentimiento.
