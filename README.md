# Claw Dashboard

A lightweight local dashboard for monitoring laptop system status and DeepSeek balance.

## Features

- CPU usage, refreshed every 1 second
- Memory usage, refreshed every 1 second
- CPU and memory trend charts for the last 60 seconds
- C: drive free space, refreshed every 10 seconds
- DeepSeek balance, refreshed every 1 minute
- Daily DeepSeek spend estimate based on the first successful balance snapshot of the day

## Requirements

- Node.js 18 or newer
- Windows is supported for C: drive monitoring

## Setup

Create a `.env` file in the project root:

```env
DEEPSEEK_API_KEY=sk-your-key-here
PORT=3000
LIBRE_HARDWARE_MONITOR_URL=http://192.168.18.154:8085/data.json
CPU_POWER_SENSOR_ID=/intelcpu/0/power/0
```

Install dependencies if needed. This project currently uses only Node.js built-in modules, so there is nothing to install.

## Start

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

## API

- `GET /api/system` - CPU and memory data
- `GET /api/drive` - C: drive free space data
- `GET /api/deepseek` - DeepSeek balance and daily usage estimate
- `GET /api/metrics` - all metrics in one response

## Notes

DeepSeek daily usage is calculated as:

```text
initial balance for today - current balance
```

If the account is topped up during the day, the value may become negative.

## CPU Power

CPU power is read from LibreHardwareMonitor's remote web server. The default sensor is:

```text
/intelcpu/0/power/0
```

If the sensor path changes, update `CPU_POWER_SENSOR_ID` in `.env`.
