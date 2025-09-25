# AI Trading Bot

An intelligent trading bot that uses machine learning to make trading decisions in financial markets.

## Features

- **AI-Powered Predictions**: Uses machine learning models (Random Forest, LSTM) to predict price movements
- **Multiple Data Sources**: Supports Yahoo Finance and Binance for market data
- **Risk Management**: Built-in risk management with position sizing, stop-loss, and take-profit
- **Paper Trading**: Safe paper trading mode for testing strategies
- **Configurable**: Highly configurable through YAML files
- **Docker Support**: Easy deployment with Docker containers
- **Extensible**: Modular architecture for easy extension and customization

## Project Structure

```
ai-trading-bot/
├── src/ai_trading_bot/
│   ├── core/           # Core bot functionality
│   ├── data/           # Data fetching and processing
│   ├── models/         # AI/ML models
│   ├── strategies/     # Trading strategies
│   └── utils/          # Utility functions
├── config/             # Configuration files
├── tests/              # Unit tests
├── docs/               # Documentation
├── main.py             # Main entry point
├── requirements.txt    # Python dependencies
└── Dockerfile          # Docker configuration
```

## Quick Start

### Prerequisites

- Python 3.9+
- pip or conda for package management

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vorynkavitaliy/ai-trading-bot.git
cd ai-trading-bot
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure the bot:
```bash
cp config/config.yaml config/my_config.yaml
# Edit my_config.yaml with your preferences
```

4. Run the bot in paper trading mode:
```bash
python main.py --mode paper --config config/my_config.yaml
```

### Using Docker

1. Build and run with Docker Compose:
```bash
docker-compose up --build
```

## Configuration

The bot is configured through YAML files. Key configuration sections:

- **trading**: Trading parameters (symbols, balance, position sizes)
- **data**: Data source configuration (provider, timeframes)
- **ai**: Machine learning model settings
- **strategy**: Trading strategy parameters
- **risk_management**: Risk control settings

## Trading Modes

- **Paper Trading** (`--mode paper`): Simulated trading with virtual money
- **Live Trading** (`--mode live`): Real trading (requires API keys)
- **Backtesting** (`--mode backtest`): Historical strategy testing

## API Keys

For live trading or real-time data, set environment variables:

```bash
export BINANCE_API_KEY="your_api_key"
export BINANCE_API_SECRET="your_api_secret"
```

Or create a `.env` file:
```
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
```

## Development

### Running Tests

```bash
pytest tests/
```

### Code Formatting

```bash
black src/ tests/
isort src/ tests/
flake8 src/ tests/
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run tests and ensure they pass
6. Submit a pull request

## Disclaimer

This software is for educational and research purposes only. Trading financial instruments involves substantial risk of loss and is not suitable for all investors. The developers are not responsible for any financial losses incurred through the use of this software.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For questions, issues, or contributions, please open an issue on GitHub.