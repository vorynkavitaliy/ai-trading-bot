"""Main trading bot implementation."""

import time
from typing import List, Dict, Any
from loguru import logger

from .config import Config
from ..data.data_fetcher import DataFetcher
from ..models.predictor import PricePredictor
from ..strategies.base_strategy import BaseStrategy
from ..strategies.ml_strategy import MLStrategy
from ..utils.risk_manager import RiskManager


class TradingBot:
    """Main trading bot class that orchestrates all components."""
    
    def __init__(self, config: Config, mode: str = "paper"):
        """
        Initialize the trading bot.
        
        Args:
            config: Configuration object
            mode: Trading mode ('live', 'paper', 'backtest')
        """
        self.config = config
        self.mode = mode
        self.is_running = False
        
        # Initialize components
        self.data_fetcher = DataFetcher(config)
        self.predictor = PricePredictor(config)
        self.strategy = MLStrategy(config)
        self.risk_manager = RiskManager(config)
        
        # Portfolio state
        self.portfolio = {
            "balance": config.get("trading.initial_balance", 10000),
            "positions": {},
            "total_value": 0
        }
        
        logger.info(f"Trading bot initialized in {mode} mode")
    
    def run(self):
        """Main execution loop for the trading bot."""
        self.is_running = True
        
        logger.info("Starting trading bot main loop")
        
        try:
            while self.is_running:
                self._trading_cycle()
                
                # Sleep for the specified interval
                sleep_interval = self.config.get("trading.cycle_interval", 3600)  # 1 hour default
                logger.debug(f"Sleeping for {sleep_interval} seconds")
                time.sleep(sleep_interval)
                
        except Exception as e:
            logger.error(f"Error in trading loop: {e}")
            raise
        finally:
            self._cleanup()
    
    def stop(self):
        """Stop the trading bot."""
        logger.info("Stopping trading bot")
        self.is_running = False
    
    def _trading_cycle(self):
        """Execute one trading cycle."""
        logger.info("Starting trading cycle")
        
        try:
            # Get symbols to trade
            symbols = self.config.get("trading.symbols", [])
            
            for symbol in symbols:
                self._process_symbol(symbol)
            
            # Update portfolio value
            self._update_portfolio_value()
            
            # Log portfolio status
            self._log_portfolio_status()
            
        except Exception as e:
            logger.error(f"Error in trading cycle: {e}")
    
    def _process_symbol(self, symbol: str):
        """Process trading signals for a specific symbol."""
        logger.debug(f"Processing symbol: {symbol}")
        
        try:
            # Fetch latest data
            data = self.data_fetcher.get_historical_data(
                symbol=symbol,
                timeframe=self.config.get("data.timeframe", "1h"),
                limit=self.config.get("data.lookback_periods", 100)
            )
            
            if data is None or data.empty:
                logger.warning(f"No data available for {symbol}")
                return
            
            # Generate prediction
            prediction = self.predictor.predict(data)
            
            # Generate trading signal
            signal = self.strategy.generate_signal(data, prediction)
            
            # Apply risk management
            if signal and self.risk_manager.should_execute_trade(signal, self.portfolio):
                self._execute_trade(symbol, signal)
            
        except Exception as e:
            logger.error(f"Error processing symbol {symbol}: {e}")
    
    def _execute_trade(self, symbol: str, signal: Dict[str, Any]):
        """Execute a trading signal."""
        logger.info(f"Executing trade for {symbol}: {signal}")
        
        if self.mode == "paper":
            self._execute_paper_trade(symbol, signal)
        elif self.mode == "live":
            self._execute_live_trade(symbol, signal)
        elif self.mode == "backtest":
            self._execute_backtest_trade(symbol, signal)
    
    def _execute_paper_trade(self, symbol: str, signal: Dict[str, Any]):
        """Execute a paper trade (simulation)."""
        action = signal.get("action")  # "buy" or "sell"
        quantity = signal.get("quantity", 0)
        price = signal.get("price", 0)
        
        if action == "buy":
            cost = quantity * price
            if cost <= self.portfolio["balance"]:
                self.portfolio["balance"] -= cost
                if symbol not in self.portfolio["positions"]:
                    self.portfolio["positions"][symbol] = 0
                self.portfolio["positions"][symbol] += quantity
                logger.info(f"Paper trade executed: Bought {quantity} {symbol} at {price}")
            else:
                logger.warning(f"Insufficient balance for buying {quantity} {symbol}")
        
        elif action == "sell":
            current_position = self.portfolio["positions"].get(symbol, 0)
            if quantity <= current_position:
                self.portfolio["balance"] += quantity * price
                self.portfolio["positions"][symbol] -= quantity
                if self.portfolio["positions"][symbol] == 0:
                    del self.portfolio["positions"][symbol]
                logger.info(f"Paper trade executed: Sold {quantity} {symbol} at {price}")
            else:
                logger.warning(f"Insufficient position for selling {quantity} {symbol}")
    
    def _execute_live_trade(self, symbol: str, signal: Dict[str, Any]):
        """Execute a live trade (placeholder for actual exchange integration)."""
        logger.warning("Live trading not implemented yet - use paper trading mode")
    
    def _execute_backtest_trade(self, symbol: str, signal: Dict[str, Any]):
        """Execute a backtest trade (placeholder for backtesting engine)."""
        logger.info("Backtest trade execution - placeholder")
    
    def _update_portfolio_value(self):
        """Update the total portfolio value."""
        total_value = self.portfolio["balance"]
        
        for symbol, quantity in self.portfolio["positions"].items():
            # For simplicity, using a mock price - in real implementation,
            # fetch current market price
            mock_price = 100  # This should be replaced with actual price fetching
            total_value += quantity * mock_price
        
        self.portfolio["total_value"] = total_value
    
    def _log_portfolio_status(self):
        """Log current portfolio status."""
        logger.info(f"Portfolio Status:")
        logger.info(f"  Balance: ${self.portfolio['balance']:.2f}")
        logger.info(f"  Total Value: ${self.portfolio['total_value']:.2f}")
        logger.info(f"  Positions: {self.portfolio['positions']}")
    
    def _cleanup(self):
        """Cleanup resources before shutdown."""
        logger.info("Cleaning up trading bot resources")
        # Close any open connections, save state, etc.