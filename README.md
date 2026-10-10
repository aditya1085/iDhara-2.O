# 🌊 iDhara 2.0
### Urban Flood Early Warning & Resilience Twin

**iDhara 2.0** is a flood-risk monitoring and disaster-preparedness dashboard designed to visualize potential urban flood risks and support informed decision-making through mapping, risk assessment, sensor data health, alerts, road routing, evacuation planning, and digital-twin workflows.

> **Project status:** Hackathon prototype. The current project uses a React + Vite frontend. Flood-related values and scenarios may be simulated. A dedicated backend or live-data connection has not yet been confirmed.

## 📌 Problem Statement

Urban flooding can disrupt transportation, damage infrastructure, and threaten public safety. Flood-related information may come from different sources, making it difficult to understand potential risks and coordinate preparedness.

iDhara 2.0 aims to bring relevant flood-risk visualization and disaster-planning workflows together in one dashboard.

## 🎯 Project Objectives

- Visualize potential flood risks across map cells.
- Present flood-related information through a unified dashboard.
- Provide interfaces for alerts and sensor data health.
- Support road-network and evacuation-planning workflows.
- Explore disaster scenarios through digital-twin concepts.
- Establish a foundation for future AI-based flood intelligence.

## ✨ Key Features

- **📊 Overview Dashboard** — Displays key flood-risk indicators and system information.
- **🗺️ Risk Map** — Visualizes risk information across grid cells.
- **🚨 Alerts** — Provides an interface for reviewing flood-related alerts.
- **🌐 Disaster Digital Twin** — Supports the exploration of flood scenarios.
- **✅ Validation** — Provides a workflow for reviewing data and model-related information.
- **🛣️ Roads & Routing** — Presents road-network and routing information relevant to flood response.
- **🏃 Evacuation Planning** — Supports evacuation-planning workflows.
- **⏪ Event Replay** — Provides an interface for exploring event timelines and replay scenarios.
- **📡 Data Health** — Displays sensor and data-quality status information.
- **🧪 Twin Stage** — Supports the digital-twin workflow.

*Actual functionality and data availability depend on the current implementation.*

## 🗺️ Map Grid

The dashboard is designed to display a grid of **64 cells arranged in an 8 × 8 layout**.

If the full pilot area is 5 km × 5 km and is divided into 64 equal square cells:

- Total pilot area: 25 km²
- Number of cells: 64
- Area per cell: 0.390625 km²
- Dimensions per cell: 625 m × 625 m

These figures are calculated from the stated area and equal-grid assumption. Actual map boundaries and cell dimensions should be verified against the implementation.

## 🛠️ Technology Stack

Based on the current `package.json`:

- **React 19** — Frontend UI
- **Vite 6** — Development server and build tooling
- **TypeScript** — Type checking
- **Tailwind CSS 4** — Styling
- **jsPDF** — PDF generation

A dedicated backend framework and database are not listed in the current package configuration.

## 🚀 Getting Started

### Prerequisites

- Node.js
- npm

### 1. Clone the repository

```bash
git clone https://github.com/aditya1085/iDhara-2.0.git
```

### 2. Navigate to the project folder

```bash
cd iDhara-2.0
```

### 3. Install dependencies

```bash
npm install
```

### 4. Start the development server

```bash
npm run dev
```

Open the local URL displayed in the terminal to view the application.

### 5. Build for production

```bash
npm run build
```

### 6. Run TypeScript checks

```bash
npm run lint
```

## 🤖 Future Scope of AI

Potential future enhancements include:

- **AI-Based Flood Forecasting:** Estimate flood risk using reliable rainfall, water-level, terrain, and historical flood data.
- **Sensor Anomaly Detection:** Identify unusual readings, stale data, and possible sensor faults.
- **Smart Evacuation Routing:** Evaluate feasible routes using verified road conditions, flood hazards, and shelter information.
- **AI-Enhanced Digital Twin:** Explore hypothetical flood scenarios and their potential impacts.
- **Computer Vision:** Investigate suitable satellite or camera imagery for waterlogging detection.
- **AI Disaster Copilot:** Generate data-grounded summaries and help users explore flood-related information.

These are proposed enhancements and should not be interpreted as currently implemented features unless confirmed in the codebase.

## 🔌 Future Backend & Data Integration

Future development may include:

- A backend API for managing flood-risk and sensor data.
- Integration with trusted weather and rainfall data sources.
- A database for historical flood records and event information.
- Data validation and timestamp tracking.
- Verified road-network and shelter information.
- Authentication and role-based access for operational users.

Any live-data integration should be tested and validated before being used for real-world emergency decisions.

## 🔒 Data & Safety Disclaimer

iDhara 2.0 is a prototype intended for demonstration, experimentation, and further development. Simulated data, unverified forecasts, and unconfirmed evacuation routes must not be treated as official emergency guidance.

Real-world deployment would require reliable data sources, validated risk models, verified road and shelter information, field testing, and coordination with authorized disaster-management agencies.

## 🔮 Future Improvements

- Connect reliable real-time data sources.
- Validate flood-risk calculations against observed events.
- Improve data-health monitoring and error handling.
- Test routing under road-closure scenarios.
- Improve report generation and visualization.
- Evaluate AI models using suitable datasets and performance metrics.

## 🤝 Contributions

Potential areas for contribution include:

- Flood-data integration
- Map visualization
- Data-quality validation
- Routing and evacuation workflows
- Digital-twin scenarios
- Documentation and testing

## 👨‍💻 Project Information

**Project Name:** iDhara 2.0  
**Category:** Urban Flood Risk & Disaster Preparedness  
**Repository:** [github.com/aditya1085/iDhara-2.0](https://github.com/aditya1085/iDhara-2.0)

Developed as a hackathon prototype focused on urban flood preparedness, resilience, and smarter disaster-management workflows.
