"""Risk management utilities for the trading bot."""

from typing import Dict, Any, List
from loguru import logger

from ..core.config import Config


class RiskManager:
    """Risk management class for controlling trading risks."""
    
    def __init__(self, config: Config):
        """
        Initialize the risk manager.
        
        Args:
            config: Configuration object
        """
        self.config = config
        self.max_drawdown = config.get("risk_management.max_drawdown", 0.1)
        self.max_position_size = config.get("trading.max_position_size", 0.1)
        self.stop_loss_pct = config.get("trading.stop_loss_percentage", 0.02)
        self.take_profit_pct = config.get("trading.take_profit_percentage", 0.05)
        
        logger.info(f"Risk manager initialized with max_drawdown={self.max_drawdown}, "
                   f"max_position_size={self.max_position_size}")
    
    def should_execute_trade(
        self, 
        signal: Dict[str, Any], 
        portfolio: Dict[str, Any]
    ) -> bool:
        """
        Determine if a trade should be executed based on risk parameters.
        
        Args:
            signal: Trading signal
            portfolio: Current portfolio state
            
        Returns:
            True if trade should be executed, False otherwise
        """
        try:
            # Check position size limits
            if not self._check_position_size(signal, portfolio):
                logger.warning("Trade rejected: Position size exceeds limits")
                return False
            
            # Check portfolio drawdown
            if not self._check_drawdown(portfolio):
                logger.warning("Trade rejected: Portfolio drawdown exceeds limits")
                return False
            
            # Check minimum confidence
            min_confidence = self.config.get("strategy.min_confidence", 0.6)
            if signal.get("confidence", 0) < min_confidence:
                logger.warning(f"Trade rejected: Confidence {signal.get('confidence')} "
                             f"below minimum {min_confidence}")
                return False
            
            # Check available balance for buy orders
            if signal["action"] == "buy":
                if not self._check_available_balance(signal, portfolio):
                    logger.warning("Trade rejected: Insufficient balance")
                    return False
            
            # Check existing position for sell orders
            if signal["action"] == "sell":
                if not self._check_existing_position(signal, portfolio):
                    logger.warning("Trade rejected: Insufficient position")
                    return False
            
            logger.debug("Trade approved by risk manager")
            return True
            
        except Exception as e:
            logger.error(f"Error in risk check: {e}")
            return False
    
    def _check_position_size(self, signal: Dict[str, Any], portfolio: Dict[str, Any]) -> bool:
        """Check if position size is within limits."""
        position_value = signal["quantity"] * signal["price"]
        total_portfolio_value = portfolio.get("total_value", portfolio.get("balance", 0))
        
        if total_portfolio_value == 0:
            return False
        
        position_ratio = position_value / total_portfolio_value
        
        return position_ratio <= self.max_position_size
    
    def _check_drawdown(self, portfolio: Dict[str, Any]) -> bool:
        """Check if portfolio drawdown is within limits."""
        # For simplicity, assuming we track initial balance
        initial_balance = self.config.get("trading.initial_balance", 10000)
        current_value = portfolio.get("total_value", portfolio.get("balance", 0))
        
        if initial_balance == 0:
            return True
        
        drawdown = (initial_balance - current_value) / initial_balance
        
        return drawdown <= self.max_drawdown
    
    def _check_available_balance(self, signal: Dict[str, Any], portfolio: Dict[str, Any]) -> bool:
        """Check if there's sufficient balance for a buy order."""
        required_amount = signal["quantity"] * signal["price"]
        available_balance = portfolio.get("balance", 0)
        
        return available_balance >= required_amount
    
    def _check_existing_position(self, signal: Dict[str, Any], portfolio: Dict[str, Any]) -> bool:
        """Check if there's sufficient position for a sell order."""
        # This would need the symbol information in the signal
        # For now, assuming the check is done elsewhere
        return True
    
    def calculate_stop_loss_price(self, entry_price: float, action: str) -> float:
        """
        Calculate stop-loss price.
        
        Args:
            entry_price: Entry price of the position
            action: Trade action ('buy' or 'sell')
            
        Returns:
            Stop-loss price
        """
        if action == "buy":
            return entry_price * (1 - self.stop_loss_pct)
        else:  # sell
            return entry_price * (1 + self.stop_loss_pct)
    
    def calculate_take_profit_price(self, entry_price: float, action: str) -> float:
        """
        Calculate take-profit price.
        
        Args:
            entry_price: Entry price of the position
            action: Trade action ('buy' or 'sell')
            
        Returns:
            Take-profit price
        """
        if action == "buy":
            return entry_price * (1 + self.take_profit_pct)
        else:  # sell
            return entry_price * (1 - self.take_profit_pct)
    
    def get_position_size_recommendation(
        self, 
        signal_confidence: float, 
        portfolio_value: float,
        volatility: float = 0.02
    ) -> float:
        """
        Recommend position size based on confidence and volatility.
        
        Args:
            signal_confidence: Confidence of the trading signal (0-1)
            portfolio_value: Total portfolio value
            volatility: Asset volatility (default 0.02)
            
        Returns:
            Recommended position size as ratio of portfolio
        """
        # Kelly Criterion inspired position sizing
        base_size = self.max_position_size
        
        # Adjust based on confidence
        confidence_adjusted = base_size * signal_confidence
        
        # Adjust based on volatility (lower volatility = larger position)
        volatility_adjusted = confidence_adjusted * (0.02 / max(volatility, 0.01))
        
        # Cap at maximum position size
        recommended_size = min(volatility_adjusted, self.max_position_size)
        
        return max(recommended_size, 0.01)  # Minimum 1% position
    
    def check_correlation_risk(self, symbols: List[str]) -> Dict[str, float]:
        """
        Check correlation risk between trading symbols.
        
        Args:
            symbols: List of trading symbols
            
        Returns:
            Dictionary with correlation risk scores
        """
        # Placeholder for correlation analysis
        # In real implementation, this would calculate correlation between assets
        risk_scores = {}
        
        for symbol in symbols:
            # Simple risk score based on symbol type
            if "BTC" in symbol or "ETH" in symbol:
                risk_scores[symbol] = 0.8  # High risk
            else:
                risk_scores[symbol] = 0.5  # Medium risk
        
        return risk_scores