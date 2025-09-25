#!/usr/bin/env python3
"""
Main entry point for the AI Trading Bot.
"""

import argparse
import sys
from pathlib import Path

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from ai_trading_bot.core.config import Config
from ai_trading_bot.core.bot import TradingBot
from ai_trading_bot.utils.logger import setup_logger


def main():
    """Main function to run the trading bot."""
    parser = argparse.ArgumentParser(description="AI Trading Bot")
    parser.add_argument(
        "--config", 
        type=str, 
        default="config/config.yaml",
        help="Path to configuration file"
    )
    parser.add_argument(
        "--mode",
        type=str,
        choices=["live", "paper", "backtest"],
        default="paper",
        help="Trading mode"
    )
    parser.add_argument(
        "--log-level",
        type=str,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging level"
    )
    
    args = parser.parse_args()
    
    # Setup logging
    logger = setup_logger(level=args.log_level)
    
    try:
        # Load configuration
        config = Config.from_path(args.config)
        
        # Initialize and run the trading bot
        bot = TradingBot(config, mode=args.mode)
        
        logger.info(f"Starting AI Trading Bot in {args.mode} mode")
        bot.run()
        
    except KeyboardInterrupt:
        logger.info("Trading bot stopped by user")
    except Exception as e:
        logger.error(f"Error running trading bot: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()