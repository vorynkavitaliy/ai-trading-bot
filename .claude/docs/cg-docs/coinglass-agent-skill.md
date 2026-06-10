# 🤖 CoinGlass API Agent Skill

## CoinGlass API Skills Hub (AI Agent)

The CoinGlass API now supports **AI Agent integration** through the **CoinGlass Skills Hub**.

CoinGlass Skills Hub is an open skill marketplace that enables AI Agents to access CoinGlass’s professional-grade crypto market data and analytics through structured, reusable skill packages.

With Skills Hub, AI Agents can:

* Access unified real-time and historical data across derivatives, spot, options, ETF, and on-chain markets
* Retrieve advanced datasets such as funding rates, open interest, liquidation data, L2/L3 order book depth, order flow, whale activity, and macro indicators
* Automatically map natural language requests to the correct CoinGlass API endpoints
* Generate structured insights without manual API integration

### Quick Start

Visit the CoinGlass Skills Hub repository:

[https://github.com/coinglass-official/coinglass-api-skills](https://github.com/coinglass-official/coinglass-api-skills)

Install in your Agent environment:

```bash
npx skills add https://github.com/coinglass-official/coinglass-api-skills
```

***

### Install Skills (via GitHub ZIP)

1. Click the **Code** button in the top-right corner and select **Download ZIP**.

2. Upload the extracted files to your target platform or tool.

3. Follow the platform-specific instructions to complete setup and installation.

Cursor Skills guide:
[https://cursor.com/docs/skills](https://cursor.com/docs/skills)

Claude Skills guide:
[https://support.claude.com/en/articles/12512180-use-skills-in-claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)

***

### When to Use Skills Hub

Use CoinGlass Skills Hub in the following scenarios:

* Building AI Agents or copilots
* Integrating CoinGlass data into LLM-based workflows
* Developing trading assistants or analytics bots
* Accelerating integration without handling low-level API logic

If you prefer direct API integration, continue using the endpoint documentation below.

<br />

## Use with MCP

It is recommended to use this SKILL together with the CoinGlass MCP Service:

* SKILL: Handles data understanding, metric interpretation, and analysis logic
* MCP: Handles actual API execution, data retrieval, and structured responses

Together, they significantly improve AI performance in CoinGlass data workflows.

***

<br />

## Supported Data Types

### Derivatives

* Market data
* Open Interest
* Funding Rate
* Long/Short Ratio
* Liquidation data
* Liquidation heatmap
* Order Book (L2)
* Hyperliquid positions
* Taker Buy/Sell Volume
* CVD
* Capital flow

***

### Spot

* Market data
* Order Book
* Taker Buy/Sell Volume
* CVD
* Inflow/Outflow

***

### Options

* Max Pain
* Options-related data
* Exchange open interest history
* Exchange volume history

***

### On-chain

* Exchange transparency / Proof of Reserve
* Exchange balances
* On-chain transfers
* Large transfers
* Token unlocks

***

### ETF

* Bitcoin ETF
* Ethereum ETF
* Grayscale
* Solana ETF
* XRP ETF

***

### Indicators

* RSI
* MA
* EMA
* BOLL
* MACD
* ATR
* TD Sequential
* Coinbase Premium
* AHR999
* Puell Multiple
* Pi Cycle Top Indicator
* Rainbow Chart
* Fear & Greed Index
* Stablecoin Market Cap
* RHODL
* NUPL
* Altcoin Season Index
* BTC Dominance
* Futures vs Spot Volume Ratio

***

### Other Data

* Economic calendar
* Economic data
* Macro events
* Central bank updates
* News
* Flash news

***

### Account

* Account tier query

***

## Typical Use Cases

This SKILL is suitable for:

* Automatically selecting the correct API endpoints based on user queries
* Converting natural language into data queries
* Building market monitoring dashboards
* Generating quantitative analysis logic
* Combining multiple data sources for insights
* Creating AI agents with market intelligence

***

## Common Workflows

### 1. Derivatives Market Analysis

Combine:

* Open Interest
* Funding Rate
* Long/Short Ratio
* Liquidation data
* Liquidation heatmap

Use cases:

* Measuring market crowding
* Assessing leverage risk
* Identifying squeeze conditions
* Detecting liquidation clusters

***

### 2. Spot Flow Analysis

Combine:

* Taker Buy/Sell Volume
* Order Book
* CVD
* Price trends

Use cases:

* Identifying spot-driven trends
* Analyzing buy/sell pressure
* Monitoring liquidity changes

***

### 3. ETF Monitoring

Combine:

* ETF list
* Net assets history
* Flow history
* Premium/discount history
* AUM

Use cases:

* Tracking institutional flows
* Understanding ETF sentiment
* Building ETF dashboards

***

### 4. On-chain & Macro Analysis

Combine:

* Exchange reserves / transparency
* Large transfers
* Stablecoin market cap
* Fear & Greed Index
* BTC dominance

Use cases:

* Identifying market cycles
* Tracking liquidity conditions
* Monitoring on-chain capital movement

***

### 5. Indicator-Based Analysis

Combine:

* AHR999
* Puell Multiple
* NUPL
* RHODL
* Rainbow Chart
* Altcoin Season Index

Use cases:

* Market valuation analysis
* Long-term trend identification
* Cycle positioning

***

## Example Prompts

You can ask your Agent:

* "Analyze the current BTC liquidation pressure."
* "Compare ETH funding rate and open interest changes."
* "Is ETF flow currently influencing the market?"
* "Are BTC funding rate, open interest, and liquidation data showing divergence at the same time?"
* "Based on funding rate, CVD, and order flow, is the BTC market currently driven by aggressive buyers or sellers?"
* "How can I build a BTC market monitoring dashboard?"
* "Which CoinGlass indicators are suitable for identifying overheated altcoin markets?"
* "Is the liquidation distribution over the past 24 hours concentrated in a specific price range? Are there liquidation clusters?"
* "Which endpoints should be combined to analyze short-term market structure?"

***

## Target Users

* Enterprise and institutional users
* AI product developers
* Quantitative researchers
* Traders
* Data analysts
* Crypto market research teams
* Agent application developers
* Internal tool builders

***

## What’s Next

After integration, you can:

* Build full data pipelines with MCP
* Develop internal analytics tools
* Create market monitoring systems
* Build AI-powered research assistants
* Design reusable analysis workflows